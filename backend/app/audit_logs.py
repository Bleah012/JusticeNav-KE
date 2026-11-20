"""Read-only, bounded, cursor-paginated catalogue audit metadata."""

import base64
import hashlib
import json
import os
import re
from datetime import UTC, date, datetime, timedelta, timezone
from threading import Lock
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from firebase_admin import firestore
from google.api_core.exceptions import GoogleAPICallError, RetryError
from google.auth.exceptions import GoogleAuthError
from google.cloud.firestore_v1 import FieldFilter
from google.cloud.firestore_v1 import Query as FirestoreQuery
from google.cloud.firestore_v1.field_path import FieldPath
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictInt, TypeAdapter

from .auth import CurrentUser, VerificationUnavailable, get_firebase_app, require_roles
from .catalog import CatalogModel, Identifier

COLLECTIONS = {
    "service": "serviceCatalogueAudit",
    "pathway": "pathwayCatalogueAudit",
    "resource": "resourceCatalogueAudit",
}
VERBS = ("create", "update", "publish", "archive", "delete")
PAGE_SIZE, SCAN_LIMIT = 25, 150
KENYA = timezone(timedelta(hours=3))
TARGET = TypeAdapter(Identifier)
Kind = Literal["all", "service", "pathway", "resource"]
Action = Literal["all", "create", "update", "publish", "archive", "delete"]


class AuditUnavailable(Exception):
    pass


class AuditFilters(CatalogModel):
    kind: Kind = "all"
    action: Action = "all"
    query: str = Field(default="", max_length=200)
    from_date: date | None = None
    to_date: date | None = None

    def fingerprint(self):
        return hashlib.sha256(self.model_dump_json().encode()).hexdigest()


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    time: AwareDatetime
    id: str = Field(pattern=r"^[a-f0-9]{32}$")


class StoredEvent(CatalogModel):
    action: str
    actor_uid: str = Field(min_length=1, max_length=128)
    revision: StrictInt = Field(ge=1)
    occurred_at: AwareDatetime


def encode_cursor(filters, positions):
    raw = {
        "v": 1,
        "filter": filters.fingerprint(),
        "positions": {
            kind: position.model_dump(mode="json") if position else None
            for kind, position in positions.items()
        },
    }
    return (
        base64.urlsafe_b64encode(json.dumps(raw, separators=(",", ":")).encode())
        .decode()
        .rstrip("=")
    )


def decode_cursor(value, filters):
    if value is None:
        return dict.fromkeys(COLLECTIONS)
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,2048}", value):
            raise ValueError
        raw = json.loads(
            base64.b64decode(
                value + "=" * (-len(value) % 4), altchars=b"-_", validate=True
            )
        )
        if (
            not isinstance(raw, dict)
            or set(raw) != {"v", "filter", "positions"}
            or type(raw["v"]) is not int
            or raw["v"] != 1
            or raw["filter"] != filters.fingerprint()
            or not isinstance(raw["positions"], dict)
            or set(raw["positions"]) != set(COLLECTIONS)
        ):
            raise ValueError
        positions = {
            kind: Position.model_validate(position) if position is not None else None
            for kind, position in raw["positions"].items()
        }
        if not any(positions.values()):
            raise ValueError
        return positions
    except (ValueError, TypeError, KeyError) as error:
        raise HTTPException(
            422, "Invalid audit cursor. Reload the first page."
        ) from error


def project_event(kind, snapshot):
    """Whitelist metadata; no payload, review notes or private narratives escape."""
    identifier = snapshot.id
    if not re.fullmatch(r"[a-f0-9]{32}", identifier):
        raise ValueError("Invalid audit event identifier")
    raw = snapshot.to_dict()
    # Existing catalogue writers include exactly these core fields plus their target ID.
    event = StoredEvent.model_validate(
        {key: raw[key] for key in ("action", "actorUid", "revision", "occurredAt")}
    )
    if event.action not in {f"{kind}.{verb}" for verb in VERBS}:
        raise ValueError("Audit action does not match collection")
    target = raw[f"{kind}Id"]
    # Reuse catalogue reference validation without accepting extra stored fields.
    target = TARGET.validate_python(target)
    if not event.actor_uid.strip() or any(ord(char) < 32 for char in event.actor_uid):
        raise ValueError("Invalid audit actor")
    stamp = event.occurred_at.astimezone(UTC)
    return {
        "id": f"{kind}:{identifier}",
        "occurredAt": stamp.isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "actorReference": event.actor_uid,
        "action": event.action,
        "targetKind": kind,
        "targetReference": target,
        "revision": event.revision,
        "outcome": "succeeded",
    }, Position(time=stamp, id=identifier)


def read_page(repository, filters, positions):
    """Merge bounded ordered streams; cursors track consumed rows in each collection."""
    candidates = []
    for kind in COLLECTIONS:
        if filters.kind not in ("all", kind):
            continue
        rows = repository.fetch(kind, filters, positions[kind], SCAN_LIMIT + 1)
        if len(rows) > SCAN_LIMIT + 1:
            raise ValueError("Unbounded audit response")
        previous = None
        for snapshot in rows:
            event, position = project_event(kind, snapshot)
            key = (position.time, position.id)
            if previous is not None and key >= previous:
                raise ValueError("Invalid audit ordering")
            if positions[kind] and key >= (positions[kind].time, positions[kind].id):
                raise ValueError("Cursor did not advance")
            day = position.time.astimezone(KENYA).date()
            if (filters.from_date and day < filters.from_date) or (
                filters.to_date and day > filters.to_date
            ):
                raise ValueError("Audit date bounds were not respected")
            previous = key
            candidates.append((position.time, kind, position.id, event, position))
    candidates.sort(key=lambda row: row[:3], reverse=True)
    events, scanned = [], 0
    positions = positions.copy()
    needle = filters.query.lower()
    for _, kind, _, event, position in candidates:
        positions[kind] = position
        scanned += 1
        if (
            filters.action == "all" or event["action"] == f"{kind}.{filters.action}"
        ) and (
            not needle
            or needle
            in f"{event['id']} {event['actorReference']} {event['targetReference']}".lower()
        ):
            events.append(event)
        if len(events) == PAGE_SIZE or scanned == SCAN_LIMIT:
            break
    has_more = scanned < len(candidates)
    return {
        "events": events,
        "nextCursor": encode_cursor(filters, positions) if has_more else None,
    }


class FirestoreAuditRepository:
    def __init__(self, settings):
        self.settings = settings
        self._client, self._lock = None, Lock()

    def client(self):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise AuditUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        return self._client

    def fetch(self, kind, filters, position, limit):
        collection = self.client().collection(COLLECTIONS[kind])
        query = collection.order_by(
            "occurredAt", direction=FirestoreQuery.DESCENDING
        ).order_by(FieldPath.document_id(), direction=FirestoreQuery.DESCENDING)
        if filters.from_date:
            query = query.where(
                filter=FieldFilter(
                    "occurredAt",
                    ">=",
                    datetime.combine(filters.from_date, datetime.min.time(), KENYA),
                )
            )
        if filters.to_date:
            query = query.where(
                filter=FieldFilter(
                    "occurredAt",
                    "<",
                    datetime.combine(
                        filters.to_date + timedelta(days=1), datetime.min.time(), KENYA
                    ),
                )
            )
        if position:
            query = query.start_after(
                {
                    "occurredAt": position.time,
                    FieldPath.document_id(): collection.document(position.id),
                }
            )
        return list(query.limit(limit).stream(retry=None, timeout=10))


Admin = Annotated[CurrentUser, Depends(require_roles("admin"))]
router = APIRouter(prefix="/api/v1/admin/audit-logs", tags=["Catalogue audit reads"])


@router.get("")
def audit_logs(
    user: Admin,
    request: Request,
    kind: Kind = "all",
    action: Action = "all",
    query: Annotated[str, Query(max_length=200)] = "",
    from_date: date | None = None,
    to_date: date | None = None,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
):
    if (
        (from_date and to_date and from_date > to_date)
        or (to_date == date.max)
        or any(ord(char) < 32 for char in query)
    ):
        raise HTTPException(
            422, "Invalid audit filters. Check the date range and search."
        )
    filters = AuditFilters(
        kind=kind,
        action=action,
        query=query.strip().lower(),
        fromDate=from_date,
        toDate=to_date,
    )
    positions = decode_cursor(cursor, filters)
    try:
        page = read_page(request.app.state.audit_repository, filters, positions)
    except (
        AuditUnavailable,
        GoogleAPICallError,
        RetryError,
        GoogleAuthError,
        VerificationUnavailable,
        ValueError,
        TypeError,
        KeyError,
        OSError,
    ) as error:
        raise HTTPException(
            503, "Audit information is currently unavailable. Reload to retry."
        ) from error
    return {
        "schemaVersion": 1,
        "uid": user.uid,
        "role": "admin",
        "readOnly": True,
        **page,
    }
