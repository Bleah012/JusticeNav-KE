"""Authenticated assessment drafts; persistence does not generate pathway results."""

import hashlib
import os
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal, Protocol

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from firebase_admin import firestore
from google.api_core.exceptions import GoogleAPICallError, RetryError
from google.auth.exceptions import GoogleAuthError
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictStr,
    field_validator,
    model_validator,
)

from .auth import (
    CurrentUser,
    VerificationUnavailable,
    get_current_user,
    get_firebase_app,
)
from .config import Settings

Status = Literal["draft", "needs-clarification", "awaiting-pathways"]
Issue = Literal["consumer", "money-debt", "other"]
Timeframe = Literal["recent", "months", "older", "unsure"]
Contact = Literal["yes", "no", "unsure"]
Identifier = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]


class AssessmentUnavailable(Exception):
    """Storage is unavailable or returned an invalid or foreign record."""


class AssessmentMissing(Exception):
    """No record belongs to this account and identifier."""


class AssessmentConflict(Exception):
    """A newer saved revision must be loaded before another write."""


class Answers(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issue: Issue | None = None
    timeframe: Timeframe | None = None
    contact: Contact | None = None

    def complete(self) -> bool:
        return all((self.issue, self.timeframe, self.contact))


class UpdateBase(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False)
    expected_revision: int = Field(alias="expectedRevision", strict=True, ge=0)
    proceed: StrictBool


class DescriptionUpdate(UpdateBase):
    step: Literal["describe"]
    description: StrictStr = Field(min_length=1, max_length=1500)

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, value):
        if isinstance(value, str):
            if any(ord(char) < 32 and char not in "\n\r\t" for char in value):
                raise ValueError("Unsupported control character")
            if len(value) > 1500:
                raise ValueError("Description too long")
            return value.strip()
        return value


class ClarificationUpdate(UpdateBase):
    step: Literal["clarify"]
    answers: Answers

    @model_validator(mode="after")
    def require_complete_on_continue(self):
        if self.proceed and not self.answers.complete():
            raise ValueError("Answer every question before continuing")
        return self


AssessmentUpdate = Annotated[
    DescriptionUpdate | ClarificationUpdate, Field(discriminator="step")
]


class AssessmentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False)
    id: Identifier
    uid: StrictStr = Field(min_length=1, max_length=128)
    description: StrictStr = Field(min_length=1, max_length=1500)
    answers: Answers
    status: Status
    revision: int = Field(strict=True, ge=1)
    created_at: AwareDatetime = Field(alias="createdAt")
    updated_at: AwareDatetime = Field(alias="updatedAt")

    @model_validator(mode="after")
    def check_saved_state(self):
        if not self.description.strip() or self.updated_at < self.created_at:
            raise ValueError("Invalid saved assessment")
        if self.answers.complete() != (self.status == "awaiting-pathways"):
            raise ValueError("Invalid saved progress")
        return self


class AssessmentResponse(BaseModel):
    assessment: AssessmentRecord


class AssessmentSummary(BaseModel):
    id: Identifier
    status: Status
    revision: int
    updated_at: AwareDatetime = Field(alias="updatedAt")
    created_at: AwareDatetime = Field(alias="createdAt")


class AssessmentPage(BaseModel):
    assessments: list[AssessmentSummary]
    next_cursor: Identifier | None = Field(alias="nextCursor", default=None)


def next_record(
    uid: str,
    identifier: str,
    previous: AssessmentRecord | None,
    update: DescriptionUpdate | ClarificationUpdate,
) -> AssessmentRecord:
    """Derive saved progress on the server without creating classifications or results."""
    if update.expected_revision != (previous.revision if previous else 0):
        raise AssessmentConflict
    if isinstance(update, DescriptionUpdate):
        answers = (
            previous.answers
            if previous and previous.description == update.description
            else Answers()
        )
        description = update.description
        status = (
            "awaiting-pathways"
            if answers.complete()
            else ("needs-clarification" if update.proceed else "draft")
        )
    else:
        if previous is None:
            raise AssessmentMissing
        description, answers = previous.description, update.answers
        status = "awaiting-pathways" if answers.complete() else "needs-clarification"
    now = datetime.now(UTC)
    return AssessmentRecord.model_validate(
        {
            "id": identifier,
            "uid": uid,
            "description": description,
            "answers": answers.model_dump(),
            "status": status,
            "revision": (previous.revision if previous else 0) + 1,
            "createdAt": previous.created_at if previous else now,
            "updatedAt": now,
        }
    )


class AssessmentStore(Protocol):
    def get(self, uid: str, identifier: str) -> AssessmentRecord: ...
    def save(
        self, uid: str, identifier: str, update: DescriptionUpdate | ClarificationUpdate
    ) -> AssessmentRecord: ...
    def list(
        self, uid: str, status: Status | None, cursor: str | None, limit: int
    ) -> AssessmentPage: ...


def read_record(snapshot, uid: str, identifier: str) -> AssessmentRecord:
    if not snapshot.exists:
        raise AssessmentMissing
    result = AssessmentRecord.model_validate(snapshot.to_dict())
    if result.uid != uid or result.id != identifier:
        raise AssessmentUnavailable
    return result


class FirestoreAssessmentStore:
    def __init__(self, settings: Settings):
        self.settings, self._client, self._lock = settings, None, Lock()

    def _collection(self, uid: str):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise AssessmentUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        owner = hashlib.sha256(uid.encode("utf-8")).hexdigest()
        return (
            self._client.collection("assessmentOwners")
            .document(owner)
            .collection("assessments")
        )

    def get(self, uid, identifier):
        try:
            return read_record(
                self._collection(uid).document(identifier).get(retry=None, timeout=10),
                uid,
                identifier,
            )
        except STORAGE_ERRORS as error:
            raise AssessmentUnavailable from error

    def save(self, uid, identifier, update):
        try:
            reference = self._collection(uid).document(identifier)

            @firestore.transactional
            def write(transaction):
                snapshot = reference.get(
                    transaction=transaction, retry=None, timeout=10
                )
                previous = (
                    read_record(snapshot, uid, identifier) if snapshot.exists else None
                )
                result = next_record(uid, identifier, previous, update)
                data = result.model_dump(by_alias=True)
                if previous:
                    transaction.set(reference, data)
                else:
                    transaction.create(reference, data)
                return result

            return write(self._client.transaction(max_attempts=3))
        except STORAGE_ERRORS as error:
            raise AssessmentUnavailable from error

    def list(self, uid, status, cursor, limit):
        try:
            collection = self._collection(uid)
            query = collection.order_by("__name__")
            if status:
                query = query.where(filter=FieldFilter("status", "==", status))
            if cursor:
                anchor = collection.document(cursor).get(retry=None, timeout=10)
                record = read_record(anchor, uid, cursor)
                if status and record.status != status:
                    raise AssessmentMissing
                query = query.start_after(anchor)
            rows = list(query.limit(limit + 1).stream(retry=None, timeout=10))
            records = [read_record(row, uid, row.id) for row in rows]
            summaries = [
                AssessmentSummary.model_validate(record.model_dump(by_alias=True))
                for record in records[:limit]
            ]
            return AssessmentPage(
                assessments=summaries,
                nextCursor=records[limit - 1].id if len(records) > limit else None,
            )
        except STORAGE_ERRORS as error:
            raise AssessmentUnavailable from error


STORAGE_ERRORS = (
    VerificationUnavailable,
    GoogleAPICallError,
    RetryError,
    GoogleAuthError,
    OSError,
    ValueError,
    TypeError,
)
router = APIRouter(prefix="/api/v1/assessments", tags=["Assessments"])
UserDependency = Annotated[CurrentUser, Depends(get_current_user)]


def get_store(request: Request) -> AssessmentStore:
    return request.app.state.assessment_store


StoreDependency = Annotated[AssessmentStore, Depends(get_store)]


def http_error(error):
    if isinstance(error, AssessmentMissing):
        return HTTPException(404, "Assessment not found.")
    if isinstance(error, AssessmentConflict):
        return HTTPException(
            409,
            "This assessment changed. Reload its saved version before saving again.",
        )
    return HTTPException(503, "Assessment storage is currently unavailable.")


@router.get("", response_model=AssessmentPage)
def list_my_assessments(
    user: UserDependency,
    store: StoreDependency,
    status: Status | None = None,
    after: Identifier | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    try:
        return store.list(user.uid, status, after, limit)
    except (AssessmentUnavailable, AssessmentMissing) as error:
        raise http_error(error) from error


@router.get("/{identifier}", response_model=AssessmentResponse)
def get_my_assessment(
    identifier: Identifier, user: UserDependency, store: StoreDependency
):
    try:
        result = store.get(user.uid, identifier)
        if result.uid != user.uid or result.id != identifier:
            raise AssessmentUnavailable
        return AssessmentResponse(assessment=result)
    except (AssessmentUnavailable, AssessmentMissing) as error:
        raise http_error(error) from error


@router.put("/{identifier}", response_model=AssessmentResponse)
def save_my_assessment(
    identifier: Identifier,
    update: AssessmentUpdate,
    user: UserDependency,
    store: StoreDependency,
):
    try:
        result = store.save(user.uid, identifier, update)
        if result.uid != user.uid or result.id != identifier:
            raise AssessmentUnavailable
        return AssessmentResponse(assessment=result)
    except (AssessmentUnavailable, AssessmentMissing, AssessmentConflict) as error:
        raise http_error(error) from error
