"""Administrator pathway editing with revision checks and atomic Firestore persistence."""

import os
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from firebase_admin import firestore
from google.api_core.exceptions import GoogleAPICallError, RetryError
from google.auth.exceptions import GoogleAuthError
from pydantic import AwareDatetime, Field, StrictBool, model_validator

from .auth import CurrentUser, VerificationUnavailable, get_firebase_app, require_roles
from .catalog import CatalogModel, CatalogUnavailable, Identifier, review_today
from .pathways import CATEGORY_PATHWAYS, Pathway, PathwayStore, PathwayUnavailable

Publication = Literal["draft", "published", "archived"]
Revision = Annotated[int, Field(strict=True, ge=0)]
PROTECTED_PATHWAYS = frozenset(
    identifier for ids in CATEGORY_PATHWAYS.values() for identifier in ids
)


class PathwayProblem(Exception):
    def __init__(self, status):
        self.status = status


class PathwayRecord(CatalogModel):
    pathway: Pathway
    publication: Publication
    revision: int = Field(strict=True, ge=1)
    ever_published: StrictBool
    review_note: str = Field(max_length=1000)
    updated_at: AwareDatetime | None
    updated_by: str | None


class PathwayState(CatalogModel):
    records: list[PathwayRecord] = Field(max_length=30)
    deleted_ids: list[Identifier] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def valid_state(self):
        ids = [record.pathway.id for record in self.records]
        if len(set(ids)) != len(ids) or len(set(self.deleted_ids)) != len(
            self.deleted_ids
        ):
            raise ValueError("Duplicate pathway identifiers")
        if set(ids).intersection(self.deleted_ids):
            raise ValueError("Deleted identifiers cannot be reused")
        for record in self.records:
            if record.publication != "draft" and not record.ever_published:
                raise ValueError("Invalid publication history")
        return self


class PathwaySave(CatalogModel):
    pathway: Pathway
    expected_revision: Revision
    reviewed: StrictBool = False
    review_note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def valid_content(self):
        def check(value):
            if isinstance(value, str) and (not value.strip() or "\x00" in value):
                raise ValueError("Pathway text cannot be blank")
            if isinstance(value, dict):
                for item in value.values():
                    check(item)
            if isinstance(value, list):
                for item in value:
                    check(item)

        check(self.pathway.model_dump())
        if self.pathway.source_review.checked_on > review_today():
            raise ValueError("Source check cannot be in the future")
        return self


class PublicationChange(CatalogModel):
    expected_revision: Revision
    publication: Literal["published", "archived"]
    reviewed: StrictBool = False
    review_note: str = Field(default="", max_length=1000)


class DeletePathway(CatalogModel):
    expected_revision: Revision


def initial_state(seed):
    return PathwayState(
        records=[
            PathwayRecord(
                pathway=pathway,
                publication="published",
                revision=1,
                everPublished=True,
                reviewNote="",
                updatedAt=None,
                updatedBy=None,
            )
            for pathway in seed.load().pathways
        ]
    )


def find_record(state, identifier):
    return next((row for row in state.records if row.pathway.id == identifier), None)


def transition(state, identifier, change, uid, published_service_ids):
    """Apply one revision-checked change without mutating the caller's snapshot."""
    state = state.model_copy(deep=True)
    protected = PROTECTED_PATHWAYS
    previous = find_record(state, identifier)
    if change.expected_revision != (previous.revision if previous else 0):
        raise PathwayProblem(409)
    now = datetime.now(UTC)
    if isinstance(change, PathwaySave):
        if change.pathway.id != identifier:
            raise PathwayProblem(422)
        if change.pathway.service_id not in published_service_ids:
            raise PathwayProblem(409)
        if previous is None:
            if identifier in state.deleted_ids or len(state.records) >= 30:
                raise PathwayProblem(409)
            record = PathwayRecord(
                pathway=change.pathway,
                publication="draft",
                revision=1,
                everPublished=False,
                reviewNote="",
                updatedAt=now,
                updatedBy=uid,
            )
            state.records.append(record)
        else:
            if previous.publication == "published" and (
                not change.reviewed or not change.review_note.strip()
            ):
                raise PathwayProblem(422)
            record = previous.model_copy(
                update={
                    "pathway": change.pathway,
                    "revision": previous.revision + 1,
                    "review_note": change.review_note.strip(),
                    "updated_at": now,
                    "updated_by": uid,
                }
            )
            state.records[state.records.index(previous)] = record
        action = "create" if previous is None else "update"
    else:
        if previous is None:
            raise PathwayProblem(404)
        if isinstance(change, DeletePathway):
            if (
                previous.ever_published
                or previous.publication != "draft"
                or identifier in protected
            ):
                raise PathwayProblem(409)
            state.records.remove(previous)
            state.deleted_ids.append(identifier)
            record, action = None, "delete"
        else:
            if change.publication == previous.publication:
                raise PathwayProblem(409)
            if (
                change.publication == "published"
                and previous.pathway.service_id not in published_service_ids
            ):
                raise PathwayProblem(409)
            if change.publication == "archived" and (
                not previous.ever_published or identifier in protected
            ):
                raise PathwayProblem(409)
            if change.publication == "published" and (
                not change.reviewed
                or not change.review_note.strip()
                or previous.pathway.source_review.checked_on > review_today()
            ):
                raise PathwayProblem(422)
            record = previous.model_copy(
                update={
                    "publication": change.publication,
                    "ever_published": True,
                    "revision": previous.revision + 1,
                    "review_note": change.review_note.strip(),
                    "updated_at": now,
                    "updated_by": uid,
                }
            )
            state.records[state.records.index(previous)] = record
            action = "publish" if change.publication == "published" else "archive"
    # Bound the complete document below Firestore's document-size limit.
    state = PathwayState.model_validate(state.model_dump())
    if len(state.model_dump_json().encode("utf-8")) > 750_000:
        raise PathwayProblem(409)
    audit = {
        "action": f"pathway.{action}",
        "actorUid": uid,
        "pathwayId": identifier,
        "revision": (previous.revision if previous else 0) + 1,
        "occurredAt": now,
    }
    return state, record, audit


class FirestorePathwayRepository:
    def __init__(self, settings, service_repository, seed=None):
        self.settings = settings
        self.service_repository = service_repository
        self.seed = seed if seed is not None else PathwayStore()
        self._client, self._lock = None, Lock()

    def client(self):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise PathwayUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        return self._client

    def decode(self, snapshot):
        return (
            PathwayState.model_validate(snapshot.to_dict())
            if snapshot.exists
            else initial_state(self.seed)
        )

    def read(self):
        try:
            snapshot = (
                self.client()
                .collection("publicCatalogue")
                .document("pathways-v1")
                .get(retry=None, timeout=10)
            )
            return self.decode(snapshot)
        except (
            GoogleAPICallError,
            RetryError,
            GoogleAuthError,
            VerificationUnavailable,
            ValueError,
            OSError,
        ) as error:
            raise PathwayUnavailable from error

    def read_in_transaction(self, client, transaction):
        reference = client.collection("publicCatalogue").document("pathways-v1")
        return self.decode(
            reference.get(transaction=transaction, retry=None, timeout=10)
        )

    def change(self, identifier, change, uid, published_service_ids):
        try:
            client = self.client()
            reference = client.collection("publicCatalogue").document("pathways-v1")
            audit_ref = client.collection("pathwayCatalogueAudit").document(uuid4().hex)

            @firestore.transactional
            def write(transaction):
                previous = self.decode(
                    reference.get(transaction=transaction, retry=None, timeout=10)
                )
                # Reading both documents makes publication and service archiving conflict safely.
                services = self.service_repository.read_in_transaction(
                    client, transaction
                )
                active_ids = {
                    row.service.id
                    for row in services.records
                    if row.publication == "published"
                }
                state, record, audit = transition(
                    previous, identifier, change, uid, active_ids
                )
                # Firestore accepts timestamps, but not Python calendar-date objects.
                transaction.set(reference, state.model_dump(mode="json", by_alias=True))
                transaction.create(audit_ref, audit)
                return record

            return write(client.transaction(max_attempts=3))
        except (
            GoogleAPICallError,
            RetryError,
            GoogleAuthError,
            VerificationUnavailable,
            ValueError,
            OSError,
        ) as error:
            raise PathwayUnavailable from error


class ManagedPathwayStore:
    """Expose published pathways only; stored private records never enter public responses."""

    def __init__(self, seed, repository):
        self.seed, self.repository = seed, repository

    def load(self):
        catalog = self.seed.load()
        records = self.repository.read().records
        pathways = [row.pathway for row in records if row.publication == "published"]
        checked = max(
            [catalog.checked_on, *(row.source_review.checked_on for row in pathways)]
        )
        return catalog.model_copy(update={"pathways": pathways, "checked_on": checked})


Admin = Annotated[CurrentUser, Depends(require_roles("admin"))]
router = APIRouter(prefix="/api/v1/admin/pathway-records", tags=["Pathway management"])


def envelope(user, **data):
    return {"schemaVersion": 1, "uid": user.uid, "role": "admin", **data}


def published_services(request):
    return request.app.state.catalog_store.load().services


def run(operation):
    try:
        return operation()
    except PathwayProblem as error:
        messages = {
            404: "Pathway not found.",
            409: "Pathway changed or this action is blocked. Reload; assessment links, published services and publication history are protected.",
            422: "Check pathway fields and confirm the source review before publishing changes.",
        }
        raise HTTPException(error.status, messages[error.status]) from error
    except (CatalogUnavailable, PathwayUnavailable, ValueError, OSError) as error:
        raise HTTPException(
            503, "Pathway catalogue storage is currently unavailable."
        ) from error


@router.get("")
def list_records(user: Admin, request: Request):
    def read():
        state = request.app.state.pathway_repository.read()
        return envelope(
            user,
            records=state.model_dump(mode="json", by_alias=True)["records"],
            protectedPathwayIds=sorted(PROTECTED_PATHWAYS),
            publishedServices=[
                {"id": row.id, "name": row.name} for row in published_services(request)
            ],
        )

    return run(read)


@router.get("/{identifier}")
def get_record(identifier: Identifier, user: Admin, request: Request):
    def read():
        record = find_record(request.app.state.pathway_repository.read(), identifier)
        if record is None:
            raise PathwayProblem(404)
        return envelope(user, record=record.model_dump(mode="json", by_alias=True))

    return run(read)


def apply_change(identifier, change, user, request):
    def write():
        record = request.app.state.pathway_repository.change(
            identifier,
            change,
            user.uid,
            {row.id for row in published_services(request)},
        )
        if record is None:
            return envelope(
                user, deletedId=identifier, revision=change.expected_revision + 1
            )
        return envelope(user, record=record.model_dump(mode="json", by_alias=True))

    return run(write)


@router.put("/{identifier}")
def save_record(
    identifier: Identifier, change: PathwaySave, user: Admin, request: Request
):
    return apply_change(identifier, change, user, request)


@router.put("/{identifier}/publication")
def publish_record(
    identifier: Identifier, change: PublicationChange, user: Admin, request: Request
):
    return apply_change(identifier, change, user, request)


@router.delete("/{identifier}")
def delete_record(
    identifier: Identifier, change: DeletePathway, user: Admin, request: Request
):
    return apply_change(identifier, change, user, request)
