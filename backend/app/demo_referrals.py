"""Consent, assignment and progress for metadata-only development referrals."""

import os
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from firebase_admin import auth, exceptions, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import AwareDatetime, Field, StrictStr, TypeAdapter, model_validator

from .assessments import STORAGE_ERRORS
from .auth import CurrentUser, get_firebase_app, require_roles
from .catalog import CatalogModel, Text
from .catalog import Identifier as PublicId
from .notification_events import queue_referral_progress
from .referrals import Identifier as ReferralId
from .referrals import (
    ReferralMissing,
    ReferralUnavailable,
    referral_collection,
    scoped_key,
)
from .referrals import read_record as read_private_referral

Key = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]
Uid = Annotated[StrictStr, Field(min_length=1, max_length=128, pattern=r"^\S+$")]
Status = Literal["shared", "assigned", "under-review", "completed", "withdrawn"]
Revision = Annotated[int, Field(strict=True, ge=1, le=5)]
CONSENT_VERSION = "demo-metadata-v1"
TRANSITIONS = {
    "shared": {"assigned", "withdrawn"},
    "assigned": {"under-review", "withdrawn"},
    "under-review": {"completed", "withdrawn"},
    "completed": {"withdrawn"},
    "withdrawn": set(),
}


class Missing(Exception):
    pass


class Conflict(Exception):
    pass


class Unavailable(Exception):
    pass


class MembershipDenied(Exception):
    pass


class Event(CatalogModel):
    status: Status
    at: AwareDatetime


class Handoff(CatalogModel):
    id: Key
    service_id: PublicId
    service_name: Text
    pathway_title: Text
    status: Status
    revision: Revision
    history: list[Event] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def validate_history(self):
        if (
            self.revision != len(self.history)
            or self.history[0].status != "shared"
            or self.history[-1].status != self.status
        ):
            raise ValueError("Inconsistent demonstration history")
        for previous, following in zip(self.history, self.history[1:]):
            if (
                following.status not in TRANSITIONS[previous.status]
                or following.at < previous.at
            ):
                raise ValueError("Invalid demonstration transition")
        return self


class StoredHandoff(Handoff):
    owner_uid: Uid
    referral_id: ReferralId
    provider_key: Key | None
    consent_version: Literal["demo-metadata-v1"]

    @model_validator(mode="after")
    def validate_scope(self):
        assigned = self.status in {"assigned", "under-review", "completed"}
        if self.id != scoped_key(self.owner_uid, self.referral_id) or assigned != (
            self.provider_key is not None
        ):
            raise ValueError("Invalid stored demonstration scope")
        return self


class HandoffResponse(CatalogModel):
    uid: Uid
    referral: Handoff | None


class OwnerResponse(HandoffResponse):
    referral_id: ReferralId


class HandoffList(CatalogModel):
    uid: Uid
    referrals: list[Handoff] = Field(max_length=20)
    next_cursor: Key | None


class DemoCounts(CatalogModel):
    shared: int = Field(strict=True, ge=0, le=1000)
    assigned: int = Field(strict=True, ge=0, le=1000)
    under_review: int = Field(strict=True, ge=0, le=1000)
    completed: int = Field(strict=True, ge=0, le=1000)
    withdrawn: int = Field(strict=True, ge=0, le=1000)

    @model_validator(mode="after")
    def bounded_total(self):
        if sum(self.model_dump().values()) > 1000:
            raise ValueError("Summary limit exceeded")
        return self


def count_demonstrations(records, provider_key=None, service_id=None):
    counts = dict.fromkeys(
        ("shared", "assigned", "under-review", "completed", "withdrawn"), 0
    )
    seen = set()
    for record in records:
        if record is None or record.id in seen or len(seen) >= 1000:
            raise Unavailable
        seen.add(record.id)
        if provider_key is not None and (
            record.provider_key != provider_key
            or record.service_id != service_id
            or record.status not in {"assigned", "under-review", "completed"}
        ):
            raise Unavailable
        counts[record.status] += 1
    return DemoCounts(**{key.replace("-", "_"): value for key, value in counts.items()})


class ProviderSummary(CatalogModel):
    uid: Uid
    service_id: PublicId
    counts: DemoCounts
    refreshed_at: AwareDatetime


class Consent(CatalogModel):
    consent_version: Literal["demo-metadata-v1"]
    confirmed: Literal[True]

    @model_validator(mode="before")
    @classmethod
    def require_boolean(cls, value):
        if not isinstance(value, dict) or value.get("confirmed") is not True:
            raise ValueError("Explicit consent required")
        return value


class RevisionUpdate(CatalogModel):
    expected_revision: Revision


class Assignment(RevisionUpdate):
    provider_uid: Uid


class ProviderChoice(CatalogModel):
    uid: Uid
    label: Annotated[StrictStr, Field(min_length=1, max_length=256)]


class ProviderChoices(CatalogModel):
    uid: Uid
    referral_id: Key
    service_id: PublicId
    providers: list[ProviderChoice] = Field(max_length=50)


class Progress(RevisionUpdate):
    status: Literal["under-review", "completed"]


def public_view(record):
    if record is None:
        return None
    return Handoff.model_validate(record.model_dump(include=set(Handoff.model_fields)))


def start_handoff(source, uid, referral_id):
    if source.uid != uid or source.id != referral_id:
        raise Missing
    selection = source.selection
    return StoredHandoff(
        id=scoped_key(uid, referral_id),
        owner_uid=uid,
        referral_id=referral_id,
        service_id=selection.service.id,
        service_name=selection.service.name,
        pathway_title=selection.pathway.title,
        status="shared",
        revision=1,
        history=[Event(status="shared", at=max(datetime.now(UTC), source.saved_at))],
        provider_key=None,
        consent_version=CONSENT_VERSION,
    )


def advance(record, revision, status, provider_key=None):
    if record.revision != revision or status not in TRANSITIONS[record.status]:
        raise Conflict
    event = Event(status=status, at=max(datetime.now(UTC), record.history[-1].at))
    return StoredHandoff.model_validate(
        {
            **record.model_dump(),
            "status": status,
            "revision": revision + 1,
            "history": [*record.history, event],
            "provider_key": provider_key,
        }
    )


class FirebaseProviderDirectory:
    """Read current role and single-service membership before granting access."""

    def __init__(self, settings):
        self.settings = settings

    def for_service(self, service_id):
        """One bounded account read is sufficient for the small school MVP."""
        try:
            page = auth.list_users(
                max_results=1000, app=get_firebase_app(self.settings)
            )
            if page.next_page_token:
                raise Unavailable
            users = sorted(page.users, key=lambda user: user.uid)
            providers = []
            for user in users:
                claims = user.custom_claims or {}
                if (
                    user.disabled
                    or not isinstance(claims, dict)
                    or claims.get("role") != "provider"
                    or claims.get("demoServiceId") != service_id
                ):
                    continue
                name = " ".join((user.display_name or "").split())
                email = " ".join((user.email or "").split())
                label = f"{name} ({email})" if name and email else name or email
                label = label or f"Development provider {len(providers) + 1}"
                label = "".join(char for char in label if ord(char) >= 32)[:256]
                providers.append(ProviderChoice(uid=user.uid, label=label))
            if len(providers) > 50:
                raise Unavailable
            return providers
        except (*STORAGE_ERRORS, exceptions.FirebaseError) as error:
            raise Unavailable from error

    def service_for(self, uid):
        try:
            user = auth.get_user(uid, app=get_firebase_app(self.settings))
        except auth.UserNotFoundError as error:
            raise MembershipDenied from error
        except (*STORAGE_ERRORS, exceptions.FirebaseError) as error:
            raise Unavailable from error
        claims = user.custom_claims or {}
        if user.uid != uid or user.disabled or claims.get("role") != "provider":
            raise MembershipDenied
        try:
            return TypeAdapter(PublicId).validate_python(claims.get("demoServiceId"))
        except ValueError as error:
            raise MembershipDenied from error


class FirestoreDemoReferrals:
    def __init__(self, settings):
        self.settings = settings
        self._client = None
        self._lock = Lock()

    def _collection(self):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise Unavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        return self._client.collection("demoReferralWorkflows")

    @staticmethod
    def _read(snapshot):
        if not snapshot.exists:
            return None
        record = StoredHandoff.model_validate(snapshot.to_dict())
        if record.id != snapshot.id:
            raise Unavailable
        return record

    def get(self, key):
        try:
            return self._read(
                self._collection().document(key).get(retry=None, timeout=5)
            )
        except STORAGE_ERRORS as error:
            raise Unavailable from error

    def change(self, key, transition, source=None):
        try:
            reference = self._collection().document(key)

            @firestore.transactional
            def write(transaction):
                if source is not None:
                    # Sharing must read the private request in this transaction too.
                    private = referral_collection(self._client, source.uid).document(
                        source.id
                    )
                    current = read_private_referral(
                        private.get(transaction=transaction, retry=None, timeout=5),
                        source.uid,
                        source.id,
                    )
                    if current.revision != source.revision:
                        raise Conflict
                previous = self._read(
                    reference.get(transaction=transaction, retry=None, timeout=5)
                )
                updated = transition(previous)
                data = updated.model_dump(by_alias=True)
                if previous is None:
                    transaction.create(reference, data)
                else:
                    transaction.set(reference, data)
                    if previous.status != updated.status:
                        queue_referral_progress(self._client, transaction, updated)
                return updated

            return write(self._client.transaction(max_attempts=3))
        except STORAGE_ERRORS as error:
            raise Unavailable from error

    def list(self, field, value, after):
        try:
            collection = self._collection()
            query = collection.where(filter=FieldFilter(field, "==", value)).order_by(
                "__name__"
            )
            if after:
                query = query.start_after({"__name__": collection.document(after)})
            return [
                self._read(row) for row in query.limit(21).stream(retry=None, timeout=5)
            ]
        except STORAGE_ERRORS as error:
            raise Unavailable from error

    def summary(self, provider_key=None, service_id=None):
        try:
            query = self._collection()
            if provider_key is not None:
                query = query.where(
                    filter=FieldFilter("providerKey", "==", provider_key)
                )
            rows = [
                self._read(row)
                for row in query.limit(1001).stream(retry=None, timeout=10)
            ]
            return count_demonstrations(rows, provider_key, service_id)
        except STORAGE_ERRORS as error:
            raise Unavailable from error


def execute(operation):
    try:
        return operation()
    except (Missing, ReferralMissing) as error:
        raise HTTPException(404, "Demonstration referral not found.") from error
    except Conflict as error:
        raise HTTPException(
            409, "The saved progress changed. Refresh before trying again."
        ) from error
    except MembershipDenied as error:
        raise HTTPException(
            403, "An active matching demonstration provider membership is required."
        ) from error
    except (Unavailable, ReferralUnavailable) as error:
        raise HTTPException(
            503, "Demonstration referrals are currently unavailable."
        ) from error


def development_only(request: Request):
    if not request.app.state.demo_referrals_enabled:
        raise HTTPException(404, "Demonstration workflow is unavailable.")


router = APIRouter(
    prefix="/api/v1/demo-referrals",
    dependencies=[Depends(development_only)],
    tags=["Development referral workflow"],
)
Seeker = Annotated[CurrentUser, Depends(require_roles("seeker"))]
Admin = Annotated[CurrentUser, Depends(require_roles("admin"))]
Provider = Annotated[CurrentUser, Depends(require_roles("provider"))]
Cursor = Annotated[Key | None, Query()]


@router.get("/provider/summary", response_model=ProviderSummary)
def provider_summary(user: Provider, request: Request):
    def read():
        service = request.app.state.demo_provider_directory.service_for(user.uid)
        counts = request.app.state.demo_referral_store.summary(
            scoped_key(user.uid, service), service
        )
        return ProviderSummary(
            uid=user.uid,
            serviceId=service,
            counts=counts,
            refreshedAt=datetime.now(UTC),
        )

    return execute(read)


def response(user, record):
    return HandoffResponse(uid=user.uid, referral=public_view(record))


def owner_response(user, referral_id, record):
    return OwnerResponse(
        uid=user.uid, referral_id=referral_id, referral=public_view(record)
    )


def own(record, user, referral_id):
    if (
        record is None
        or record.owner_uid != user.uid
        or record.referral_id != referral_id
    ):
        raise Missing
    return record


def provider_scope(request, uid):
    service = request.app.state.demo_provider_directory.service_for(uid)
    return service, scoped_key(uid, service)


def list_page(request, user, field, value, after, service=None):
    rows = request.app.state.demo_referral_store.list(field, value, after)
    if len(rows) > 21 or any(row is None for row in rows):
        raise Unavailable
    ids = [row.id for row in rows]
    if ids != sorted(set(ids)) or any(after and row.id <= after for row in rows):
        raise Unavailable
    for row in rows:
        if field == "status" and row.status != "shared":
            raise Unavailable
        if field == "providerKey" and (
            row.provider_key != value or row.service_id != service
        ):
            raise Unavailable
    return HandoffList(
        uid=user.uid,
        referrals=[public_view(row) for row in rows[:20]],
        next_cursor=ids[19] if len(ids) > 20 else None,
    )


@router.get("/mine/{referral_id}", response_model=OwnerResponse)
def get_mine(referral_id: ReferralId, request: Request, user: Seeker):
    def read():
        record = request.app.state.demo_referral_store.get(
            scoped_key(user.uid, referral_id)
        )
        return owner_response(
            user, referral_id, own(record, user, referral_id) if record else None
        )

    return execute(read)


@router.put("/mine/{referral_id}/share", response_model=OwnerResponse)
def share(referral_id: ReferralId, _consent: Consent, request: Request, user: Seeker):
    def save():
        source = request.app.state.referral_store.get(user.uid, referral_id)
        candidate = start_handoff(source, user.uid, referral_id)

        def create(previous):
            if previous is not None:
                own(previous, user, referral_id)
                raise Conflict
            return candidate

        return owner_response(
            user,
            referral_id,
            request.app.state.demo_referral_store.change(
                candidate.id, create, source=source
            ),
        )

    return execute(save)


@router.put("/mine/{referral_id}/withdraw", response_model=OwnerResponse)
def withdraw(
    referral_id: ReferralId, update: RevisionUpdate, request: Request, user: Seeker
):
    def change(record):
        return advance(
            own(record, user, referral_id), update.expected_revision, "withdrawn"
        )

    return execute(
        lambda: owner_response(
            user,
            referral_id,
            request.app.state.demo_referral_store.change(
                scoped_key(user.uid, referral_id), change
            ),
        )
    )


@router.get("/admin", response_model=HandoffList)
def admin_queue(request: Request, user: Admin, after: Cursor = None):
    return execute(lambda: list_page(request, user, "status", "shared", after))


@router.put("/admin/{key}/assign", response_model=HandoffResponse)
def assign(key: Key, update: Assignment, request: Request, user: Admin):
    def save():
        service, provider_key = provider_scope(request, update.provider_uid)

        def change(record):
            if record is None:
                raise Missing
            if record.service_id != service:
                raise MembershipDenied
            return advance(record, update.expected_revision, "assigned", provider_key)

        return response(user, request.app.state.demo_referral_store.change(key, change))

    return execute(save)


@router.get("/admin/{key}/providers", response_model=ProviderChoices)
def provider_choices(key: Key, request: Request, user: Admin):
    def read():
        record = request.app.state.demo_referral_store.get(key)
        if record is None:
            raise Missing
        if record.status != "shared":
            raise Conflict
        providers = request.app.state.demo_provider_directory.for_service(
            record.service_id
        )
        if len({provider.uid for provider in providers}) != len(providers):
            raise Unavailable
        return ProviderChoices(
            uid=user.uid,
            referralId=record.id,
            serviceId=record.service_id,
            providers=providers,
        )

    return execute(read)


@router.get("/provider", response_model=HandoffList)
def provider_queue(request: Request, user: Provider, after: Cursor = None):
    def read():
        service, provider_key = provider_scope(request, user.uid)
        return list_page(request, user, "providerKey", provider_key, after, service)

    return execute(read)


@router.put("/provider/{key}/status", response_model=HandoffResponse)
def progress(key: Key, update: Progress, request: Request, user: Provider):
    def save():
        service, provider_key = provider_scope(request, user.uid)

        def change(record):
            if (
                record is None
                or record.provider_key != provider_key
                or record.service_id != service
            ):
                raise Missing
            return advance(
                record, update.expected_revision, update.status, provider_key
            )

        return response(user, request.app.state.demo_referral_store.change(key, change))

    return execute(save)
