"""Own-account notification reads and explicit monotonic mark-as-read writes."""

import os
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal, Protocol

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import Field, StrictStr, model_validator

from .assessments import STORAGE_ERRORS, UserDependency
from .auth import get_firebase_app
from .catalog import CatalogModel
from .notification_events import (
    Identifier,
    Notification,
    StoredNotification,
    notification_collection,
)


class NotificationMissing(Exception):
    """No notification belongs to this account and reference."""


class NotificationsUnavailable(Exception):
    """Notification storage failed or returned unsafe metadata."""


class NotificationPage(CatalogModel):
    uid: StrictStr = Field(min_length=1, max_length=128)
    notifications: list[Notification] = Field(max_length=50)
    next_cursor: Identifier | None = None


class MarkRead(CatalogModel):
    notification_ids: list[Identifier] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_ids(self):
        if len(self.notification_ids) != len(set(self.notification_ids)):
            raise ValueError("Duplicate notification references")
        return self


class ReadResponse(MarkRead):
    uid: StrictStr = Field(min_length=1, max_length=128)


def read_event(snapshot, uid, identifier):
    if not snapshot.exists:
        raise NotificationMissing
    event = StoredNotification.model_validate(snapshot.to_dict())
    if event.uid != uid or event.id != identifier:
        raise NotificationsUnavailable
    return event


def public_event(event):
    return Notification.model_validate(
        event.model_dump(include=set(Notification.model_fields), by_alias=True)
    )


class NotificationStore(Protocol):
    def list(
        self, uid: str, unread: bool, cursor: str | None, limit: int
    ) -> NotificationPage: ...
    def mark_read(self, uid: str, identifiers: list[str]) -> None: ...


class FirestoreNotificationStore:
    def __init__(self, settings):
        self.settings, self._client, self._lock = settings, None, Lock()

    def _collection(self, uid):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise NotificationsUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        return notification_collection(self._client, uid)

    def list(self, uid, unread, cursor, limit):
        try:
            collection = self._collection(uid)
            # Use the stored ID's descending single-field index for the unfiltered
            # list. A descending __name__-only query has no default index.
            # Both fields are validated equal, so paging/order remain identical.
            query = collection.order_by(
                "__name__" if unread else "id", direction="DESCENDING"
            )
            if unread:
                query = query.where(filter=FieldFilter("isRead", "==", False))
            if cursor:
                anchor = collection.document(cursor).get(retry=None, timeout=5)
                # An owned cursor stays usable after marking that row read.
                read_event(anchor, uid, cursor)
                query = query.start_after(anchor)
            rows = list(query.limit(limit + 1).stream(retry=None, timeout=5))
            events = [read_event(row, uid, row.id) for row in rows]
            if (
                len({row.id for row in events}) != len(events)
                or [row.id for row in events]
                != sorted((row.id for row in events), reverse=True)
                or any(
                    unread and row.is_read or cursor and row.id >= cursor
                    for row in events
                )
            ):
                raise NotificationsUnavailable
            return NotificationPage(
                uid=uid,
                notifications=[public_event(row) for row in events[:limit]],
                nextCursor=events[limit - 1].id if len(events) > limit else None,
            )
        except STORAGE_ERRORS as error:
            raise NotificationsUnavailable from error

    def mark_read(self, uid, identifiers):
        try:
            collection = self._collection(uid)
            references = {
                identifier: collection.document(identifier)
                for identifier in identifiers
            }

            @firestore.transactional
            def write(transaction):
                rows = list(
                    self._client.get_all(
                        list(references.values()),
                        transaction=transaction,
                        retry=None,
                        timeout=5,
                    )
                )
                if len(rows) != len(references) or len({row.id for row in rows}) != len(
                    rows
                ):
                    raise NotificationsUnavailable
                events = []
                for row in rows:
                    if row.id not in references or row.reference != references[row.id]:
                        raise NotificationsUnavailable
                    events.append(read_event(row, uid, row.id))
                now = datetime.now(UTC)
                # Validate every owned row before queuing any writes; do not overwrite an earlier readAt.
                if any(
                    not event.is_read and now < event.created_at for event in events
                ):
                    raise NotificationsUnavailable
                for event in events:
                    if not event.is_read:
                        transaction.update(
                            references[event.id], {"isRead": True, "readAt": now}
                        )

            write(self._client.transaction(max_attempts=3))
        except STORAGE_ERRORS as error:
            raise NotificationsUnavailable from error


router = APIRouter(prefix="/api/v1/notifications", tags=["In-app account updates"])


def get_store(request: Request) -> NotificationStore:
    return request.app.state.notification_store


StoreDependency = Annotated[NotificationStore, Depends(get_store)]


def http_error(error):
    return (
        HTTPException(404, "Notification not found.")
        if isinstance(error, NotificationMissing)
        else HTTPException(503, "Notification information is currently unavailable.")
    )


@router.get("", response_model=NotificationPage)
def list_my_notifications(
    user: UserDependency,
    store: StoreDependency,
    unread: Literal["true"] | None = None,
    after: Identifier | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    try:
        result = store.list(user.uid, unread == "true", after, limit)
        if result.uid != user.uid:
            raise NotificationsUnavailable
        return result
    except (NotificationMissing, NotificationsUnavailable) as error:
        raise http_error(error) from error


@router.put("/read", response_model=ReadResponse)
def mark_my_notifications_read(
    update: MarkRead, user: UserDependency, store: StoreDependency
):
    try:
        store.mark_read(user.uid, update.notification_ids)
        return ReadResponse(uid=user.uid, notificationIds=update.notification_ids)
    except (NotificationMissing, NotificationsUnavailable) as error:
        raise http_error(error) from error
