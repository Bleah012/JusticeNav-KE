"""Own-account checklist snapshots and explicit progress saves."""

import hashlib
import json
import os
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal, Protocol

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import AwareDatetime, Field, StrictStr, model_validator

from .assessments import STORAGE_ERRORS, UserDependency
from .auth import get_firebase_app
from .catalog import (
    CatalogModel,
    SourceReview,
    Text,
    get_catalog,
)
from .catalog import (
    Identifier as PublicId,
)
from .notification_events import queue_saved_update
from .pathways import Pathway, PreparationItem, find_pathway, load_pathways

Identifier = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{32}$")]
Version = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]
Status = Literal["in-progress", "complete", "empty"]


class ChecklistMissing(Exception):
    """No checklist exists within the authenticated owner scope."""


class ChecklistUnavailable(Exception):
    """Storage failed or returned malformed/foreign data."""


class ChecklistConflict(Exception):
    """Saved revision or the source template changed."""


class ChecklistInvalid(Exception):
    """Checked items do not belong to this template."""


def template_hash(data: dict) -> str:
    fields = {
        key: data[key] for key in ("pathwayId", "pathwayTitle", "sourceReview", "items")
    }
    return hashlib.sha256(
        json.dumps(
            fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
    ).hexdigest()


class ChecklistTemplate(CatalogModel):
    pathway_id: PublicId
    pathway_title: Text
    source_review: SourceReview
    items: list[PreparationItem] = Field(max_length=15)
    template_version: Version

    @model_validator(mode="after")
    def validate_snapshot(self):
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("Duplicate items")
        if (
            template_hash(self.model_dump(by_alias=True, mode="json"))
            != self.template_version
        ):
            raise ValueError("Invalid template fingerprint")
        return self


def make_template(pathway: Pathway) -> ChecklistTemplate:
    data = {
        "pathwayId": pathway.id,
        "pathwayTitle": pathway.title,
        "sourceReview": pathway.source_review.model_dump(by_alias=True, mode="json"),
        "items": [item.model_dump(by_alias=True) for item in pathway.preparation],
    }
    return ChecklistTemplate.model_validate(
        {**data, "templateVersion": template_hash(data)}
    )


class ChecklistUpdate(CatalogModel):
    pathway_id: PublicId
    template_version: Version
    checked_ids: list[PublicId] = Field(max_length=15)
    expected_revision: int = Field(strict=True, ge=0)

    @model_validator(mode="after")
    def unique_checked_ids(self):
        if len(set(self.checked_ids)) != len(self.checked_ids):
            raise ValueError("Duplicate checked identifiers")
        return self


def progress(items, checked):
    return (
        "empty"
        if not items
        else "complete"
        if len(items) == len(checked)
        else "in-progress"
    )


class ChecklistRecord(ChecklistTemplate):
    id: Identifier
    uid: StrictStr = Field(min_length=1, max_length=128)
    checked_ids: list[PublicId] = Field(max_length=15)
    status: Status
    revision: int = Field(strict=True, ge=1)
    created_at: AwareDatetime
    updated_at: AwareDatetime

    @model_validator(mode="after")
    def valid_progress(self):
        ids = {item.id for item in self.items}
        if (
            len(set(self.checked_ids)) != len(self.checked_ids)
            or not set(self.checked_ids) <= ids
        ):
            raise ValueError("Invalid progress")
        if (
            self.status != progress(self.items, self.checked_ids)
            or self.updated_at < self.created_at
        ):
            raise ValueError("Invalid saved state")
        return self


class ChecklistSummary(CatalogModel):
    id: Identifier
    pathway_title: Text
    completed_items: int = Field(strict=True, ge=0, le=15)
    total_items: int = Field(strict=True, ge=0, le=15)
    status: Status
    revision: int = Field(strict=True, ge=1)
    created_at: AwareDatetime
    updated_at: AwareDatetime


def summary(record):
    return ChecklistSummary(
        id=record.id,
        pathwayTitle=record.pathway_title,
        completedItems=len(record.checked_ids),
        totalItems=len(record.items),
        status=record.status,
        revision=record.revision,
        createdAt=record.created_at,
        updatedAt=record.updated_at,
    )


class ChecklistPage(CatalogModel):
    checklists: list[ChecklistSummary]
    next_cursor: Identifier | None = None


class ChecklistResponse(CatalogModel):
    checklist: ChecklistRecord


def next_record(uid, identifier, previous, update, template=None):
    """Keep source snapshots immutable and derive counts/status from validated ticks."""
    if previous is None and update.expected_revision != 0:
        raise ChecklistMissing
    if update.expected_revision != (previous.revision if previous else 0):
        raise ChecklistConflict
    source = previous if previous is not None else template
    if source is None:
        raise ChecklistMissing
    if (
        update.pathway_id != source.pathway_id
        or update.template_version != source.template_version
    ):
        raise ChecklistConflict
    available = [item.id for item in source.items]
    if not set(update.checked_ids) <= set(available):
        raise ChecklistInvalid
    checked = [item for item in available if item in update.checked_ids]
    now = datetime.now(UTC)
    fields = source.model_dump(
        include=set(ChecklistTemplate.model_fields), by_alias=True
    )
    return ChecklistRecord.model_validate(
        {
            **fields,
            "id": identifier,
            "uid": uid,
            "checkedIds": checked,
            "status": progress(source.items, checked),
            "revision": (previous.revision if previous else 0) + 1,
            "createdAt": previous.created_at if previous else now,
            "updatedAt": now,
        }
    )


def read_record(snapshot, uid, identifier):
    if not snapshot.exists:
        raise ChecklistMissing
    result = ChecklistRecord.model_validate(snapshot.to_dict())
    if result.uid != uid or result.id != identifier:
        raise ChecklistUnavailable
    return result


class ChecklistStore(Protocol):
    def get(self, uid: str, identifier: str) -> ChecklistRecord: ...
    def save(
        self,
        uid: str,
        identifier: str,
        update: ChecklistUpdate,
        template: ChecklistTemplate | None,
    ) -> ChecklistRecord: ...
    def list(
        self, uid: str, status: Status | None, cursor: str | None, limit: int
    ) -> ChecklistPage: ...


class FirestoreChecklistStore:
    def __init__(self, settings):
        self.settings, self._client, self._lock = settings, None, Lock()

    def _collection(self, uid):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise ChecklistUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        owner = hashlib.sha256(uid.encode("utf-8")).hexdigest()
        return (
            self._client.collection("checklistOwners")
            .document(owner)
            .collection("checklists")
        )

    def get(self, uid, identifier):
        try:
            return read_record(
                self._collection(uid).document(identifier).get(retry=None, timeout=10),
                uid,
                identifier,
            )
        except STORAGE_ERRORS as error:
            raise ChecklistUnavailable from error

    def save(self, uid, identifier, update, template=None):
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
                result = next_record(uid, identifier, previous, update, template)
                data = result.model_dump(by_alias=True)
                # Firestore stores timestamps but does not encode Python calendar dates.
                data["sourceReview"] = result.source_review.model_dump(
                    by_alias=True, mode="json"
                )
                if previous:
                    transaction.set(reference, data)
                else:
                    transaction.create(reference, data)
                queue_saved_update(self._client, transaction, uid, "checklist", result)
                return result

            return write(self._client.transaction(max_attempts=3))
        except STORAGE_ERRORS as error:
            raise ChecklistUnavailable from error

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
                    raise ChecklistMissing
                query = query.start_after(anchor)
            rows = list(query.limit(limit + 1).stream(retry=None, timeout=10))
            records = [read_record(row, uid, row.id) for row in rows]
            return ChecklistPage(
                checklists=[summary(record) for record in records[:limit]],
                nextCursor=records[limit - 1].id if len(records) > limit else None,
            )
        except STORAGE_ERRORS as error:
            raise ChecklistUnavailable from error


router = APIRouter(prefix="/api/v1/checklists", tags=["Saved checklists"])


def get_store(request: Request) -> ChecklistStore:
    return request.app.state.checklist_store


StoreDependency = Annotated[ChecklistStore, Depends(get_store)]


def http_error(error):
    if isinstance(error, ChecklistMissing):
        return HTTPException(404, "Checklist not found.")
    if isinstance(error, ChecklistConflict):
        return HTTPException(
            409, "Checklist or source template changed. Reload before saving again."
        )
    if isinstance(error, ChecklistInvalid):
        return HTTPException(422, "Check the selected preparation items.")
    return HTTPException(503, "Checklist storage is currently unavailable.")


def current_template(request, pathway_id):
    data = load_pathways(request, get_catalog(request))
    return make_template(find_pathway(data, pathway_id))


@router.get("/templates/{pathway_id}", response_model=ChecklistTemplate)
def get_template(pathway_id: str, request: Request, _user: UserDependency):
    """Read a versioned template without creating any private checklist."""
    return current_template(request, pathway_id)


@router.get("", response_model=ChecklistPage)
def list_my_checklists(
    user: UserDependency,
    store: StoreDependency,
    status: Status | None = None,
    after: Identifier | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    try:
        return store.list(user.uid, status, after, limit)
    except (ChecklistMissing, ChecklistUnavailable) as error:
        raise http_error(error) from error


@router.get("/{identifier}", response_model=ChecklistResponse)
def get_my_checklist(
    identifier: Identifier, user: UserDependency, store: StoreDependency
):
    try:
        result = store.get(user.uid, identifier)
        if result.uid != user.uid or result.id != identifier:
            raise ChecklistUnavailable
        return ChecklistResponse(checklist=result)
    except (ChecklistMissing, ChecklistUnavailable) as error:
        raise http_error(error) from error


@router.put("/{identifier}", response_model=ChecklistResponse)
def save_my_checklist(
    identifier: Identifier,
    update: ChecklistUpdate,
    user: UserDependency,
    store: StoreDependency,
    request: Request,
):
    try:
        template = (
            current_template(request, update.pathway_id)
            if update.expected_revision == 0
            else None
        )
        result = store.save(user.uid, identifier, update, template)
        if result.uid != user.uid or result.id != identifier:
            raise ChecklistUnavailable
        return ChecklistResponse(checklist=result)
    except (
        ChecklistMissing,
        ChecklistUnavailable,
        ChecklistConflict,
        ChecklistInvalid,
    ) as error:
        raise http_error(error) from error
