"""Private, immutable project requests. No institutional delivery or status workflow."""

import hashlib
import json
import os
import re
import unicodedata
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal, Protocol

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from firebase_admin import firestore
from pydantic import AwareDatetime, Field, StrictStr, field_validator, model_validator

from .assessments import STORAGE_ERRORS, UserDependency
from .auth import get_firebase_app
from .catalog import CatalogModel, SourceReview, Text, get_catalog
from .catalog import Identifier as PublicId
from .notification_events import queue_saved_update
from .pathways import find_pathway, load_pathways

Identifier = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{32}$")]
Version = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]
ACKNOWLEDGEMENT = "project-request-v1"


class ReferralMissing(Exception):
    """No record exists in this owner namespace."""


class ReferralUnavailable(Exception):
    """Storage or stored data could not be used safely."""


class ReferralConflict(Exception):
    """The request already exists or the source selection changed."""


class NamedPathway(CatalogModel):
    id: PublicId
    title: Text


class NamedService(CatalogModel):
    id: PublicId
    name: Text


def selection_hash(data):
    fields = {key: data[key] for key in ("pathway", "service", "sourceReview")}
    return hashlib.sha256(
        json.dumps(
            fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()


class ReferralSelection(CatalogModel):
    pathway: NamedPathway
    service: NamedService
    source_review: SourceReview
    selection_version: Version

    @model_validator(mode="after")
    def fingerprint(self):
        if (
            selection_hash(self.model_dump(by_alias=True, mode="json"))
            != self.selection_version
        ):
            raise ValueError("Invalid selection fingerprint")
        return self


def current_selection(request, pathway_id):
    catalog = get_catalog(request)
    pathway = find_pathway(load_pathways(request, catalog), pathway_id)
    service = next(
        (item for item in catalog.services if item.id == pathway.service_id), None
    )
    if service is None:
        raise HTTPException(503, "Source information is currently unavailable.")
    data = {
        "pathway": {"id": pathway.id, "title": pathway.title},
        "service": {"id": service.id, "name": service.name},
        "sourceReview": pathway.source_review.model_dump(by_alias=True, mode="json"),
    }
    return ReferralSelection.model_validate(
        {**data, "selectionVersion": selection_hash(data)}
    )


class ContactDetails(CatalogModel):
    full_name: StrictStr = Field(min_length=1, max_length=120)
    email: StrictStr = Field(min_length=3, max_length=254)
    phone: StrictStr | None = Field(default=None, max_length=16)
    contact_method: Literal["email", "phone"]
    description: StrictStr = Field(min_length=1, max_length=1500)

    @field_validator("full_name", "email", "phone", "description", mode="before")
    @classmethod
    def clean_text(cls, value, info):
        if value is None and info.field_name == "phone":
            return None
        if not isinstance(value, str):
            raise ValueError("Text required")
        result = value.strip()
        if not result and info.field_name == "phone":
            return None
        allowed = "\n\r\t" if info.field_name == "description" else ""
        if any(
            unicodedata.category(char) == "Cc" and char not in allowed
            for char in result
        ):
            raise ValueError("Unsupported control character")
        return result

    @model_validator(mode="after")
    def contact(self):
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", self.email):
            raise ValueError("Invalid email")
        if self.phone is not None and not re.fullmatch(
            r"\+[1-9][0-9]{7,14}", self.phone
        ):
            raise ValueError("Invalid international phone")
        if self.contact_method == "phone" and not self.phone:
            raise ValueError("Phone required")
        return self


class ReferralCreate(ContactDetails):
    pathway_id: PublicId
    service_id: PublicId
    selection_version: Version
    acknowledged: bool = Field(strict=True)
    expected_revision: int = Field(strict=True, ge=0, le=0)

    @field_validator("acknowledged")
    @classmethod
    def accepted(cls, value):
        if value is not True:
            raise ValueError("Acknowledgement required")
        return value


class ReferralRecord(ContactDetails):
    id: Identifier
    uid: StrictStr = Field(min_length=1, max_length=128)
    selection: ReferralSelection
    scope: Literal["school-demonstration"]
    status: Literal["saved"]
    delivery_status: Literal["not-sent"]
    revision: int = Field(strict=True, ge=1, le=1)
    acknowledgement_version: Literal["project-request-v1"]
    saved_at: AwareDatetime
    acknowledged_at: AwareDatetime
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def immutable_dates(self):
        if self.saved_at != self.updated_at or self.saved_at != self.acknowledged_at:
            raise ValueError("Invalid immutable record timestamps")
        return self


class ReferralSummary(CatalogModel):
    id: Identifier
    service_name: Text
    pathway_title: Text
    saved_at: AwareDatetime
    status: Literal["saved"] = "saved"
    delivery_status: Literal["not-sent"] = "not-sent"


class ReferralPage(CatalogModel):
    referrals: list[ReferralSummary]
    next_cursor: Identifier | None = None


class ReferralResponse(CatalogModel):
    referral: ReferralRecord


def summary(record):
    return ReferralSummary(
        id=record.id,
        serviceName=record.selection.service.name,
        pathwayTitle=record.selection.pathway.title,
        savedAt=record.saved_at,
    )


def make_record(uid, identifier, update, selection):
    if (
        update.pathway_id != selection.pathway.id
        or update.service_id != selection.service.id
        or update.selection_version != selection.selection_version
    ):
        raise ReferralConflict
    now = datetime.now(UTC)
    return ReferralRecord.model_validate(
        {
            **update.model_dump(
                include=set(ContactDetails.model_fields), by_alias=True
            ),
            "id": identifier,
            "uid": uid,
            "selection": selection,
            "revision": 1,
            "acknowledgementVersion": ACKNOWLEDGEMENT,
            "scope": "school-demonstration",
            "status": "saved",
            "deliveryStatus": "not-sent",
            "savedAt": now,
            "updatedAt": now,
            "acknowledgedAt": now,
        }
    )


def read_record(snapshot, uid, identifier):
    if not snapshot.exists:
        raise ReferralMissing
    record = ReferralRecord.model_validate(snapshot.to_dict())
    if record.uid != uid or record.id != identifier:
        raise ReferralUnavailable
    return record


class ReferralStore(Protocol):
    def get(self, uid: str, identifier: str) -> ReferralRecord: ...
    def create(
        self,
        uid: str,
        identifier: str,
        update: ReferralCreate,
        selection: ReferralSelection,
    ) -> ReferralRecord: ...
    def list(self, uid: str, cursor: str | None, limit: int) -> ReferralPage: ...


class FirestoreReferralStore:
    def __init__(self, settings):
        self.settings, self._client, self._lock = settings, None, Lock()

    def _collection(self, uid):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise ReferralUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        owner = hashlib.sha256(uid.encode()).hexdigest()
        return (
            self._client.collection("referralOwners")
            .document(owner)
            .collection("referrals")
        )

    def get(self, uid, identifier):
        try:
            return read_record(
                self._collection(uid).document(identifier).get(retry=None, timeout=10),
                uid,
                identifier,
            )
        except STORAGE_ERRORS as error:
            raise ReferralUnavailable from error

    def create(self, uid, identifier, update, selection):
        try:
            reference = self._collection(uid).document(identifier)

            @firestore.transactional
            def write(transaction):
                snapshot = reference.get(
                    transaction=transaction, retry=None, timeout=10
                )
                if snapshot.exists:
                    read_record(snapshot, uid, identifier)
                    raise ReferralConflict
                result = make_record(uid, identifier, update, selection)
                data = result.model_dump(by_alias=True)
                data["selection"] = result.selection.model_dump(
                    by_alias=True, mode="json"
                )
                transaction.create(reference, data)
                queue_saved_update(self._client, transaction, uid, "referral", result)
                return result

            return write(self._client.transaction(max_attempts=3))
        except STORAGE_ERRORS as error:
            raise ReferralUnavailable from error

    def list(self, uid, cursor, limit):
        try:
            collection = self._collection(uid)
            query = collection.order_by("__name__")
            if cursor:
                anchor = collection.document(cursor).get(retry=None, timeout=10)
                read_record(anchor, uid, cursor)
                query = query.start_after(anchor)
            rows = list(query.limit(limit + 1).stream(retry=None, timeout=10))
            records = [read_record(row, uid, row.id) for row in rows]
            return ReferralPage(
                referrals=[summary(record) for record in records[:limit]],
                nextCursor=records[limit - 1].id if len(records) > limit else None,
            )
        except STORAGE_ERRORS as error:
            raise ReferralUnavailable from error


router = APIRouter(prefix="/api/v1/referrals", tags=["Private project referrals"])


def get_store(request: Request) -> ReferralStore:
    return request.app.state.referral_store


StoreDependency = Annotated[ReferralStore, Depends(get_store)]


def http_error(error):
    if isinstance(error, ReferralMissing):
        return HTTPException(404, "Referral not found.")
    if isinstance(error, ReferralConflict):
        return HTTPException(
            409,
            "Request already exists or source selection changed. Reload before continuing.",
        )
    return HTTPException(503, "Referral storage is currently unavailable.")


@router.get("/selection/{pathway_id}", response_model=ReferralSelection)
def get_selection(pathway_id: PublicId, request: Request, _user: UserDependency):
    """Resolve public context without creating a private request."""
    return current_selection(request, pathway_id)


@router.get("", response_model=ReferralPage)
def list_my_referrals(
    user: UserDependency,
    store: StoreDependency,
    after: Identifier | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    try:
        return store.list(user.uid, after, limit)
    except (ReferralMissing, ReferralUnavailable) as error:
        raise http_error(error) from error


@router.get("/{identifier}", response_model=ReferralResponse)
def get_my_referral(
    identifier: Identifier, user: UserDependency, store: StoreDependency
):
    try:
        result = store.get(user.uid, identifier)
        if result.uid != user.uid or result.id != identifier:
            raise ReferralUnavailable
        return ReferralResponse(referral=result)
    except (ReferralMissing, ReferralUnavailable) as error:
        raise http_error(error) from error


@router.put("/{identifier}", response_model=ReferralResponse)
def create_my_referral(
    identifier: Identifier,
    update: ReferralCreate,
    user: UserDependency,
    store: StoreDependency,
    request: Request,
):
    """Create once. Saving does not enqueue messages or contact an organisation."""
    try:
        selection = current_selection(request, update.pathway_id)
        result = store.create(user.uid, identifier, update, selection)
        if result.uid != user.uid or result.id != identifier:
            raise ReferralUnavailable
        return ReferralResponse(referral=result)
    except (ReferralMissing, ReferralUnavailable, ReferralConflict) as error:
        raise http_error(error) from error
