"""Administrator service editing with revision checks and atomic Firestore persistence."""

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
from .catalog import (
    CatalogModel,
    CatalogStore,
    CatalogUnavailable,
    Identifier,
    ServiceProfile,
    review_today,
)
from .pathways import PathwayUnavailable

Publication = Literal["draft", "published", "archived"]
Revision = Annotated[int, Field(strict=True, ge=0)]


class ServiceProblem(Exception):
    def __init__(self, status):
        self.status = status


class ServiceRecord(CatalogModel):
    service: ServiceProfile
    publication: Publication
    revision: int = Field(strict=True, ge=1)
    ever_published: StrictBool
    review_note: str = Field(max_length=1000)
    updated_at: AwareDatetime | None
    updated_by: str | None


class ServiceState(CatalogModel):
    records: list[ServiceRecord] = Field(max_length=50)
    deleted_ids: list[Identifier] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def valid_state(self):
        ids = [record.service.id for record in self.records]
        if len(set(ids)) != len(ids) or len(set(self.deleted_ids)) != len(
            self.deleted_ids
        ):
            raise ValueError("Duplicate service identifiers")
        if set(ids).intersection(self.deleted_ids):
            raise ValueError("Deleted identifiers cannot be reused")
        for record in self.records:
            if record.publication != "draft" and not record.ever_published:
                raise ValueError("Invalid publication history")
        return self


class ServiceSave(CatalogModel):
    service: ServiceProfile
    expected_revision: Revision
    reviewed: StrictBool = False
    review_note: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def valid_content(self):
        def check(value):
            if isinstance(value, str) and (not value.strip() or "\x00" in value):
                raise ValueError("Service text cannot be blank")
            if isinstance(value, dict):
                for item in value.values():
                    check(item)
            if isinstance(value, list):
                for item in value:
                    check(item)

        check(self.service.model_dump())
        if self.service.source_review.checked_on > review_today():
            raise ValueError("Source check cannot be in the future")
        return self


class PublicationChange(CatalogModel):
    expected_revision: Revision
    publication: Literal["published", "archived"]
    reviewed: StrictBool = False
    review_note: str = Field(default="", max_length=1000)


class DeleteService(CatalogModel):
    expected_revision: Revision


def initial_state(seed):
    return ServiceState(
        records=[
            ServiceRecord(
                service=service,
                publication="published",
                revision=1,
                everPublished=True,
                reviewNote="",
                updatedAt=None,
                updatedBy=None,
            )
            for service in seed.load().services
        ]
    )


def find_record(state, identifier):
    return next((row for row in state.records if row.service.id == identifier), None)


def transition(state, identifier, change, uid, protected):
    """Apply one revision-checked change without mutating the caller's snapshot."""
    state = state.model_copy(deep=True)
    previous = find_record(state, identifier)
    if change.expected_revision != (previous.revision if previous else 0):
        raise ServiceProblem(409)
    now = datetime.now(UTC)
    if isinstance(change, ServiceSave):
        if change.service.id != identifier:
            raise ServiceProblem(422)
        if previous is None:
            if identifier in state.deleted_ids or len(state.records) >= 50:
                raise ServiceProblem(409)
            record = ServiceRecord(
                service=change.service,
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
                raise ServiceProblem(422)
            record = previous.model_copy(
                update={
                    "service": change.service,
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
            raise ServiceProblem(404)
        if isinstance(change, DeleteService):
            if (
                previous.ever_published
                or previous.publication != "draft"
                or identifier in protected
            ):
                raise ServiceProblem(409)
            state.records.remove(previous)
            state.deleted_ids.append(identifier)
            record, action = None, "delete"
        else:
            if change.publication == previous.publication:
                raise ServiceProblem(409)
            if change.publication == "archived" and (
                not previous.ever_published or identifier in protected
            ):
                raise ServiceProblem(409)
            if change.publication == "published" and (
                not change.reviewed
                or not change.review_note.strip()
                or previous.service.source_review.checked_on > review_today()
            ):
                raise ServiceProblem(422)
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
    state = ServiceState.model_validate(state.model_dump())
    if len(state.model_dump_json().encode("utf-8")) > 750_000:
        raise ServiceProblem(409)
    audit = {
        "action": f"service.{action}",
        "actorUid": uid,
        "serviceId": identifier,
        "revision": (previous.revision if previous else 0) + 1,
        "occurredAt": now,
    }
    return state, record, audit


class FirestoreServiceRepository:
    def __init__(self, settings, seed=None):
        self.settings = settings
        self.seed = seed if seed is not None else CatalogStore()
        self.pathway_repository = None
        self._client, self._lock = None, Lock()

    def client(self):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise CatalogUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        return self._client

    def decode(self, snapshot):
        return (
            ServiceState.model_validate(snapshot.to_dict())
            if snapshot.exists
            else initial_state(self.seed)
        )

    def read(self):
        try:
            snapshot = (
                self.client()
                .collection("publicCatalogue")
                .document("services-v1")
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
            raise CatalogUnavailable from error

    def read_in_transaction(self, client, transaction):
        reference = client.collection("publicCatalogue").document("services-v1")
        return self.decode(
            reference.get(transaction=transaction, retry=None, timeout=10)
        )

    def change(self, identifier, change, uid, protected):
        try:
            client = self.client()
            reference = client.collection("publicCatalogue").document("services-v1")
            audit_ref = client.collection("serviceCatalogueAudit").document(uuid4().hex)

            @firestore.transactional
            def write(transaction):
                previous = self.decode(
                    reference.get(transaction=transaction, retry=None, timeout=10)
                )
                protected_ids = protected
                if self.pathway_repository is not None:
                    pathways = self.pathway_repository.read_in_transaction(
                        client, transaction
                    )
                    protected_ids = {
                        row.pathway.service_id
                        for row in pathways.records
                        if row.publication == "published"
                    }
                state, record, audit = transition(
                    previous, identifier, change, uid, protected_ids
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
            raise CatalogUnavailable from error


class ManagedCatalogStore:
    """Expose published services only; stored private records never enter public responses."""

    def __init__(self, seed, repository):
        self.seed, self.repository = seed, repository

    def load(self):
        catalog = self.seed.load()
        records = self.repository.read().records
        services = [row.service for row in records if row.publication == "published"]
        checked = max(
            [catalog.checked_on, *(row.source_review.checked_on for row in services)]
        )
        return catalog.model_copy(update={"services": services, "checked_on": checked})


Admin = Annotated[CurrentUser, Depends(require_roles("admin"))]
router = APIRouter(prefix="/api/v1/admin/service-records", tags=["Service management"])


def envelope(user, **data):
    return {"schemaVersion": 1, "uid": user.uid, "role": "admin", **data}


def protected_services(request):
    store = request.app.state.pathway_store
    return {row.service_id for row in store.load().pathways}


def run(operation):
    try:
        return operation()
    except ServiceProblem as error:
        messages = {
            404: "Service not found.",
            409: "Service changed or this action is blocked. Reload; linked services and published history are protected.",
            422: "Check service fields and confirm the source review before publishing changes.",
        }
        raise HTTPException(error.status, messages[error.status]) from error
    except (CatalogUnavailable, PathwayUnavailable, ValueError, OSError) as error:
        raise HTTPException(
            503, "Service catalogue storage is currently unavailable."
        ) from error


@router.get("")
def list_records(user: Admin, request: Request):
    def read():
        state = request.app.state.service_repository.read()
        return envelope(
            user,
            records=state.model_dump(mode="json", by_alias=True)["records"],
            protectedServiceIds=sorted(protected_services(request)),
        )

    return run(read)


@router.get("/{identifier}")
def get_record(identifier: Identifier, user: Admin, request: Request):
    def read():
        record = find_record(request.app.state.service_repository.read(), identifier)
        if record is None:
            raise ServiceProblem(404)
        return envelope(user, record=record.model_dump(mode="json", by_alias=True))

    return run(read)


def apply_change(identifier, change, user, request):
    def write():
        record = request.app.state.service_repository.change(
            identifier, change, user.uid, protected_services(request)
        )
        if record is None:
            return envelope(
                user, deletedId=identifier, revision=change.expected_revision + 1
            )
        return envelope(user, record=record.model_dump(mode="json", by_alias=True))

    return run(write)


@router.put("/{identifier}")
def save_record(
    identifier: Identifier, change: ServiceSave, user: Admin, request: Request
):
    return apply_change(identifier, change, user, request)


@router.put("/{identifier}/publication")
def publish_record(
    identifier: Identifier, change: PublicationChange, user: Admin, request: Request
):
    return apply_change(identifier, change, user, request)


@router.delete("/{identifier}")
def delete_record(
    identifier: Identifier, change: DeleteService, user: Admin, request: Request
):
    return apply_change(identifier, change, user, request)
