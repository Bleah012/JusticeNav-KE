"""Own-profile API and a lazily initialized Firestore repository."""

import hashlib
import os
import re
import unicodedata
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal, Protocol

from fastapi import APIRouter, Depends, HTTPException, Request
from firebase_admin import firestore
from google.api_core.exceptions import GoogleAPICallError, RetryError
from google.auth.exceptions import GoogleAuthError
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictStr,
    field_validator,
)

from .auth import (
    CurrentUser,
    VerificationUnavailable,
    get_current_user,
    get_firebase_app,
)
from .config import Settings


class ProfileUnavailable(Exception):
    """Storage is missing, unreachable, denied, or contains an invalid record."""


class ProfileConflict(Exception):
    """The draft is based on a stale saved revision."""


class ProfileFields(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False)

    full_name: StrictStr = Field(alias="fullName", min_length=1, max_length=120)
    phone: StrictStr | None = Field(default=None, max_length=16)
    preferred_language: Literal["en", "sw"] = Field(alias="preferredLanguage")

    @field_validator("full_name", mode="before")
    @classmethod
    def clean_name(cls, value: object) -> object:
        """Normalize surrounding spaces without allowing embedded control characters."""
        if isinstance(value, str):
            value = value.strip()
            if any(unicodedata.category(char) == "Cc" for char in value):
                raise ValueError("Names must not contain control characters")
        return value

    @field_validator("phone", mode="before")
    @classmethod
    def clean_phone(cls, value: object) -> object:
        """Store an optional international-format number without claiming verification."""
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            if not re.fullmatch(r"\+[1-9][0-9]{7,14}", value):
                raise ValueError("Use international format starting with +")
        return value


class ProfileUpdate(ProfileFields):
    expected_revision: int = Field(alias="expectedRevision", strict=True, ge=0)


class ProfileRecord(ProfileFields):
    uid: StrictStr = Field(min_length=1, max_length=128)
    revision: int = Field(strict=True, ge=1)
    created_at: AwareDatetime = Field(alias="createdAt")
    updated_at: AwareDatetime = Field(alias="updatedAt")


class ProfileResponse(BaseModel):
    profile: ProfileRecord | None


class ProfileStore(Protocol):
    def get(self, uid: str) -> ProfileRecord | None: ...

    def save(self, uid: str, update: ProfileUpdate) -> ProfileRecord: ...


def profile_document_id(uid: str) -> str:
    """Use one stable document per verified UID, without interpreting UID path characters."""
    return hashlib.sha256(uid.encode("utf-8")).hexdigest()


def read_record(snapshot, uid: str) -> ProfileRecord | None:
    if not snapshot.exists:
        return None
    record = ProfileRecord.model_validate(snapshot.to_dict())
    if record.uid != uid:
        raise ProfileUnavailable
    return record


class FirestoreProfileStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._client = None
        self._lock = Lock()

    def _get_client(self):
        """Use the backend Admin SDK and default database, never browser credentials."""
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise ProfileUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
            return self._client

    def get(self, uid: str) -> ProfileRecord | None:
        """Read only; opening the profile page must not create a document."""
        try:
            reference = (
                self._get_client()
                .collection("profiles")
                .document(profile_document_id(uid))
            )
            return read_record(reference.get(retry=None, timeout=10), uid)
        except (
            VerificationUnavailable,
            GoogleAPICallError,
            RetryError,
            GoogleAuthError,
            OSError,
            ValueError,
            TypeError,
        ) as error:
            raise ProfileUnavailable from error

    def save(self, uid: str, update: ProfileUpdate) -> ProfileRecord:
        """Check the draft revision and write atomically; never silently overwrite a newer edit."""
        try:
            client = self._get_client()
            reference = client.collection("profiles").document(profile_document_id(uid))

            @firestore.transactional
            def write(transaction):
                previous = read_record(
                    reference.get(transaction=transaction, retry=None, timeout=10), uid
                )
                revision = previous.revision if previous else 0
                if update.expected_revision != revision:
                    raise ProfileConflict
                now = datetime.now(UTC)
                record = ProfileRecord.model_validate(
                    {
                        **update.model_dump(
                            by_alias=True, exclude={"expected_revision"}
                        ),
                        "uid": uid,
                        "revision": revision + 1,
                        "createdAt": previous.created_at if previous else now,
                        "updatedAt": now,
                    }
                )
                data = record.model_dump(by_alias=True)
                if previous:
                    transaction.set(reference, data)
                else:
                    transaction.create(reference, data)
                return record

            return write(client.transaction(max_attempts=3))
        except (
            VerificationUnavailable,
            GoogleAPICallError,
            RetryError,
            GoogleAuthError,
            OSError,
            ValueError,
            TypeError,
        ) as error:
            raise ProfileUnavailable from error


def get_profile_store(request: Request) -> ProfileStore:
    return request.app.state.profile_store


router = APIRouter(prefix="/api/v1/profile", tags=["Profile"])
UserDependency = Annotated[CurrentUser, Depends(get_current_user)]
StoreDependency = Annotated[ProfileStore, Depends(get_profile_store)]


@router.get("/me", response_model=ProfileResponse)
def get_my_profile(user: UserDependency, store: StoreDependency) -> ProfileResponse:
    """The verified identity selects the document; query parameters cannot select another user."""
    try:
        record = store.get(user.uid)
        if record and record.uid != user.uid:
            raise ProfileUnavailable
        return ProfileResponse(profile=record)
    except ProfileUnavailable as error:
        raise HTTPException(503, "Profile storage is currently unavailable.") from error


@router.put("/me", response_model=ProfileResponse)
def save_my_profile(
    update: ProfileUpdate, user: UserDependency, store: StoreDependency
) -> ProfileResponse:
    """Only profile fields are writable; email, UID, roles and timestamps are not input fields."""
    try:
        record = store.save(user.uid, update)
        if record.uid != user.uid:
            raise ProfileUnavailable
        return ProfileResponse(profile=record)
    except ProfileConflict as error:
        raise HTTPException(
            409, "Your profile changed. Reload its latest saved version before saving."
        ) from error
    except ProfileUnavailable as error:
        raise HTTPException(503, "Profile storage is currently unavailable.") from error
