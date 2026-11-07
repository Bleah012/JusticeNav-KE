"""Atomic metadata-only updates for saved records and demonstration progress."""

import hashlib
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StrictBool, StrictStr, model_validator

from .catalog import CatalogModel

Identifier = Annotated[StrictStr, Field(pattern=r"^[0-9]{20}-[a-f0-9]{64}$")]
RecordId = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{32}$")]
Kind = Literal[
    "assessment",
    "checklist",
    "referral",
    "referral-assigned",
    "referral-under-review",
    "referral-completed",
]
AssessmentStatus = Literal["draft", "needs-clarification", "awaiting-pathways"]
Revision = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]
REFERRAL_PROGRESS_REVISIONS = {
    "referral-assigned": 2,
    "referral-under-review": 3,
    "referral-completed": 4,
}


def event_id(kind, record_id, revision, stamp):
    delta = stamp.astimezone(UTC) - datetime(1970, 1, 1, tzinfo=UTC)
    micros = (delta.days * 86400 + delta.seconds) * 1000000 + delta.microseconds
    digest = hashlib.sha256(f"{kind}:{record_id}:{revision}".encode()).hexdigest()
    return f"{micros:020d}-{digest}"


class Notification(CatalogModel):
    id: Identifier
    kind: Kind
    record_id: RecordId
    record_revision: Revision
    assessment_status: AssessmentStatus | None
    created_at: AwareDatetime
    is_read: StrictBool
    read_at: AwareDatetime | None

    @model_validator(mode="after")
    def valid_event(self):
        if self.id != event_id(
            self.kind, self.record_id, self.record_revision, self.created_at
        ):
            raise ValueError("Invalid event reference")
        if (self.kind == "assessment") != (self.assessment_status is not None):
            raise ValueError("Invalid saved-record state")
        revision = REFERRAL_PROGRESS_REVISIONS.get(self.kind)
        if revision is not None and self.record_revision != revision:
            raise ValueError("Invalid demonstration progress revision")
        if (
            self.is_read != (self.read_at is not None)
            or self.read_at is not None
            and self.read_at < self.created_at
        ):
            raise ValueError("Invalid read state")
        return self


class StoredNotification(Notification):
    uid: StrictStr = Field(min_length=1, max_length=128)


def notification_collection(connection, uid):
    owner = hashlib.sha256(uid.encode("utf-8")).hexdigest()
    return (
        connection.collection("notificationOwners")
        .document(owner)
        .collection("notifications")
    )


def saved_update(uid, kind, record):
    if record.uid != uid:
        raise ValueError("Foreign saved-record owner")
    return StoredNotification(
        id=event_id(kind, record.id, record.revision, record.updated_at),
        uid=uid,
        kind=kind,
        recordId=record.id,
        recordRevision=record.revision,
        assessmentStatus=record.status if kind == "assessment" else None,
        createdAt=record.updated_at,
        isRead=False,
        readAt=None,
    )


def queue_saved_update(connection, transaction, uid, kind, record):
    """Called inside an existing record-save transaction, after all reads."""
    _queue_notification(connection, transaction, saved_update(uid, kind, record))


def queue_referral_progress(connection, transaction, record):
    """Queue a progress update for the original seeker and referral."""
    kind = f"referral-{record.status}"
    if kind not in REFERRAL_PROGRESS_REVISIONS:
        return
    stamp = record.history[-1].at
    event = StoredNotification(
        id=event_id(kind, record.referral_id, record.revision, stamp),
        uid=record.owner_uid,
        kind=kind,
        recordId=record.referral_id,
        recordRevision=record.revision,
        assessmentStatus=None,
        createdAt=stamp,
        isRead=False,
        readAt=None,
    )
    _queue_notification(connection, transaction, event)


def _queue_notification(connection, transaction, event):
    reference = notification_collection(connection, event.uid).document(event.id)
    transaction.create(reference, event.model_dump(by_alias=True))
