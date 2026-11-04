"""Metadata-only update creation, owner isolation, pagination and read-state safety."""

from datetime import UTC, datetime, timedelta
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import Client, DocumentSnapshot
from google.cloud.firestore_v1._helpers import encode_dict
from google.cloud.firestore_v1.query import Query

from app import notifications
from app.assessments import (
    AssessmentUnavailable,
    DescriptionUpdate,
    FirestoreAssessmentStore,
)
from app.auth import InvalidToken, VerificationUnavailable
from app.catalog import CatalogStore
from app.checklists import (
    ChecklistUnavailable,
    ChecklistUpdate,
    FirestoreChecklistStore,
    make_template,
)
from app.config import Settings
from app.main import create_app
from app.notification_events import (
    StoredNotification,
    notification_collection,
    queue_saved_update,
    saved_update,
)
from app.notifications import (
    FirestoreNotificationStore,
    NotificationMissing,
    NotificationPage,
    NotificationsUnavailable,
    public_event,
)
from app.pathways import PathwayStore
from app.referrals import (
    FirestoreReferralStore,
    ReferralCreate,
    ReferralSelection,
    ReferralUnavailable,
    selection_hash,
)

STAMP = datetime(2026, 1, 1, tzinfo=UTC)
RECORD = "a" * 32
URL = "/api/v1/notifications"


def event(uid="owner", revision=1, kind="assessment", read=False):
    record = SimpleNamespace(
        id=RECORD,
        uid=uid,
        revision=revision,
        status="draft",
        updated_at=STAMP + timedelta(seconds=revision),
    )
    value = saved_update(uid, kind, record)
    if read:
        value = StoredNotification.model_validate(
            {
                **value.model_dump(by_alias=True),
                "isRead": True,
                "readAt": STAMP + timedelta(days=1),
            }
        )
    return value


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        if token == "unavailable":
            raise VerificationUnavailable
        return {"uid": token}


class MemoryStore:
    def __init__(self):
        self.rows, self.calls, self.lock = {}, [], Lock()

    def add(self, row):
        self.rows[row.uid, row.id] = row

    def list(self, uid, unread, cursor, limit):
        self.calls.append(("list", uid))
        if cursor and (uid, cursor) not in self.rows:
            raise NotificationMissing
        rows = sorted(
            (
                row
                for (owner, identifier), row in self.rows.items()
                if owner == uid
                and (not unread or not row.is_read)
                and (not cursor or identifier < cursor)
            ),
            key=lambda row: row.id,
            reverse=True,
        )
        return NotificationPage(
            uid=uid,
            notifications=[public_event(row) for row in rows[:limit]],
            nextCursor=rows[limit - 1].id if len(rows) > limit else None,
        )

    def mark_read(self, uid, identifiers):
        with self.lock:
            self.calls.append(("read", uid))
            if any((uid, identifier) not in self.rows for identifier in identifiers):
                raise NotificationMissing
            for identifier in identifiers:
                row = self.rows[uid, identifier]
                if not row.is_read:
                    self.rows[uid, identifier] = StoredNotification.model_validate(
                        {
                            **row.model_dump(by_alias=True),
                            "isRead": True,
                            "readAt": datetime.now(UTC),
                        }
                    )


def headers(uid="owner"):
    return {"Authorization": "Bearer " + uid}


def client(store=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            notification_store=store if store is not None else MemoryStore(),
        )
    )


@pytest.mark.parametrize("method", ["get", "put"])
@pytest.mark.parametrize(
    "token,status", [(None, 401), ("invalid", 401), ("unavailable", 503)]
)
def test_authentication_precedes_notification_access(method, token, status):
    store = MemoryStore()
    with client(store) as api:
        result = getattr(api, method)(
            URL + ("/read" if method == "put" else ""),
            headers=headers(token) if token else {},
            **({"json": {"notificationIds": [event().id]}} if method == "put" else {}),
        )
    assert result.status_code == status and not store.calls


def test_get_is_read_only_then_explicit_read_persists_without_new_updates():
    store = MemoryStore()
    a, b = event(), event(revision=2)
    store.add(a)
    store.add(b)
    with client(store) as api:
        result = api.get(URL, headers=headers())
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        rows = result.json()["notifications"]
        assert [row["id"] for row in rows] == [b.id, a.id] and not store.rows[
            "owner", a.id
        ].is_read
        assert (
            "uid" not in rows[0]
            and "description" not in rows[0]
            and "email" not in rows[0]
        )
        response = api.put(
            URL + "/read", headers=headers(), json={"notificationIds": [a.id]}
        )
        assert response.status_code == 200 and response.json()["notificationIds"] == [
            a.id
        ]
        stamp = store.rows["owner", a.id].read_at
        assert (
            api.put(
                URL + "/read", headers=headers(), json={"notificationIds": [a.id]}
            ).status_code
            == 200
        )
        assert store.rows["owner", a.id].read_at == stamp and len(store.rows) == 2
        assert [
            row["id"]
            for row in api.get(URL + "?unread=true", headers=headers()).json()[
                "notifications"
            ]
        ] == [b.id]
        assert api.delete(URL + "/" + a.id, headers=headers()).status_code == 404


def test_unknown_foreign_ids_and_mixed_batches_do_not_change_owned_state():
    store = MemoryStore()
    own, foreign = event(), event("foreign", revision=2)
    store.add(own)
    store.add(foreign)
    with client(store) as api:
        for ids in [[foreign.id], [own.id, foreign.id], [event(revision=3).id]]:
            response = api.put(
                URL + "/read", headers=headers(), json={"notificationIds": ids}
            )
            assert (
                response.status_code == 404
                and not store.rows["owner", own.id].is_read
                and not store.rows["foreign", foreign.id].is_read
            )
        assert (
            api.get(URL + "?after=" + foreign.id, headers=headers()).status_code == 404
        )


def test_pagination_unread_filter_and_marked_cursor_remain_owner_scoped():
    store = MemoryStore()
    rows = [event(revision=i) for i in range(1, 5)]
    for row in rows:
        store.add(row)
    store.add(event("foreign", revision=9))
    with client(store) as api:
        page = api.get(URL + "?unread=true&limit=2", headers=headers()).json()
        assert [row["id"] for row in page["notifications"]] == [
            rows[3].id,
            rows[2].id,
        ] and page["nextCursor"] == rows[2].id
        assert (
            api.put(
                URL + "/read",
                headers=headers(),
                json={"notificationIds": [rows[3].id, rows[2].id]},
            ).status_code
            == 200
        )
        next_page = api.get(
            URL + "?unread=true&after=" + page["nextCursor"], headers=headers()
        ).json()
        assert [row["id"] for row in next_page["notifications"]] == [
            rows[1].id,
            rows[0].id,
        ]
        store.add(event(revision=5))
        assert (
            api.get(URL + "?unread=true", headers=headers()).json()["notifications"][0][
                "recordRevision"
            ]
            == 5
        )


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"notificationIds": []},
        {"notificationIds": ["bad"]},
        {"notificationIds": [event().id, event().id]},
        {"notificationIds": [event().id], "uid": "PRIVATE-other-owner"},
        {"notificationIds": [event().id], "isRead": False},
        {"notificationIds": [event(revision=i).id for i in range(1, 52)]},
    ],
)
def test_invalid_write_fields_are_redacted_and_never_reach_storage(body):
    store = MemoryStore()
    with client(store) as api:
        result = api.put(URL + "/read", headers=headers(), json=body)
    assert (
        result.status_code == 422 and "PRIVATE" not in result.text and not store.calls
    )


@pytest.mark.parametrize(
    "query", ["limit=0", "limit=51", "after=bad", "unread=false", "unread=maybe"]
)
def test_invalid_filters_never_query_storage(query):
    store = MemoryStore()
    with client(store) as api:
        result = api.get(URL + "?" + query, headers=headers())
    assert result.status_code == 422 and not store.calls


@pytest.mark.parametrize("operation", ["list", "mark_read"])
def test_unavailable_storage_never_fakes_empty_or_saved_read_status(operation):
    store = Mock()
    getattr(store, operation).side_effect = NotificationsUnavailable("PRIVATE-internal")
    with client(store) as api:
        result = (
            api.get(URL, headers=headers())
            if operation == "list"
            else api.put(
                URL + "/read", headers=headers(), json={"notificationIds": [event().id]}
            )
        )
    assert result.status_code == 503 and "PRIVATE" not in result.text


@pytest.mark.parametrize(
    "change",
    [
        {"isRead": 1},
        {"isRead": True},
        {"readAt": STAMP},
        {"recordId": "../other"},
        {"recordRevision": 2},
        {"kind": "referral"},
        {"assessmentStatus": "completed"},
        {"description": "PRIVATE"},
    ],
)
def test_stored_event_schema_rejects_tampering_or_private_fields(change):
    with pytest.raises(ValueError):
        StoredNotification.model_validate(
            {**event().model_dump(by_alias=True), **change}
        )


def test_event_identity_is_stable_per_save_and_changes_with_record_revision():
    a = event()
    assert event().id == a.id and event(revision=2).id > a.id
    assert set(a.model_dump(by_alias=True)) == {
        "id",
        "uid",
        "kind",
        "recordId",
        "recordRevision",
        "assessmentStatus",
        "createdAt",
        "isRead",
        "readAt",
    }
    encode_dict(a.model_dump(by_alias=True))
    record = SimpleNamespace(
        id=RECORD, uid="foreign", revision=1, status="draft", updated_at=STAMP
    )
    with pytest.raises(ValueError):
        saved_update("owner", "assessment", record)


def test_real_sdk_groups_source_and_notification_writes_in_one_transaction():
    connection = Client(
        project="unit-notifications", credentials=AnonymousCredentials()
    )
    transaction = connection.transaction()
    record = SimpleNamespace(
        id=RECORD,
        uid="owner/with/slashes",
        revision=1,
        status="draft",
        updated_at=STAMP,
    )
    reference = connection.collection("source-fixture").document(RECORD)
    transaction.create(reference, {"fixture": True})
    queue_saved_update(connection, transaction, record.uid, "assessment", record)
    writes = transaction._write_pbs
    assert len(writes) == 2 and "/notificationOwners/" in writes[1].update.name
    assert "/owner/with/slashes/" not in writes[1].update.name
    assert set(writes[1].update.fields) == {
        "id",
        "uid",
        "kind",
        "recordId",
        "recordRevision",
        "assessmentStatus",
        "createdAt",
        "isRead",
        "readAt",
    }
    assert transaction.id is None


@pytest.mark.parametrize("kind", ["assessment", "checklist", "referral"])
def test_all_save_adapters_queue_a_notification_using_the_same_transaction(
    monkeypatch, kind
):
    from app import assessments, checklists, referrals

    reference, connection, transaction = Mock(), Mock(), Mock()
    reference.get.return_value.exists = False
    connection.transaction.return_value = transaction
    monkeypatch.setattr(
        notifications.firestore, "transactional", lambda function: function
    )
    source = PathwayStore().load().pathways[0]
    template = make_template(source)
    if kind == "assessment":
        module, store = assessments, FirestoreAssessmentStore(Settings(_env_file=None))

        def operation():
            return store.save(
                "owner",
                RECORD,
                DescriptionUpdate.model_validate(
                    {
                        "step": "describe",
                        "description": "PRIVATE description",
                        "expectedRevision": 0,
                        "proceed": False,
                    }
                ),
            )
    elif kind == "checklist":
        module, store = checklists, FirestoreChecklistStore(Settings(_env_file=None))

        def operation():
            return store.save(
                "owner",
                RECORD,
                ChecklistUpdate(
                    pathwayId=source.id,
                    templateVersion=template.template_version,
                    checkedIds=[],
                    expectedRevision=0,
                ),
                template,
            )
    else:
        module, store = referrals, FirestoreReferralStore(Settings(_env_file=None))
        service = next(
            row for row in CatalogStore().load().services if row.id == source.service_id
        )
        fields = {
            "pathway": {"id": source.id, "title": source.title},
            "service": {"id": service.id, "name": service.name},
            "sourceReview": source.source_review.model_dump(by_alias=True, mode="json"),
        }
        selection = ReferralSelection.model_validate(
            {**fields, "selectionVersion": selection_hash(fields)}
        )
        update = ReferralCreate(
            fullName="PRIVATE name",
            email="private@example.test",
            phone=None,
            contactMethod="email",
            description="PRIVATE request",
            acknowledged=True,
            pathwayId=source.id,
            serviceId=service.id,
            selectionVersion=selection.selection_version,
            expectedRevision=0,
        )

        def operation():
            return store.create("owner", RECORD, update, selection)

    store._client = connection
    monkeypatch.setattr(
        store, "_collection", lambda uid: Mock(document=Mock(return_value=reference))
    )
    record = operation()
    assert transaction.create.call_count == 2
    payload = transaction.create.call_args_list[1].args[1]
    saved_event = StoredNotification.model_validate(payload)
    assert (
        saved_event.uid == "owner"
        and saved_event.record_id == record.id
        and saved_event.record_revision == record.revision
        and saved_event.kind == kind
    )
    assert "PRIVATE" not in str(payload) and "private@example.test" not in str(payload)
    encode_dict(payload)
    monkeypatch.setattr(
        module, "queue_saved_update", Mock(side_effect=PermissionDenied("PRIVATE"))
    )
    with pytest.raises(
        {
            "assessment": AssessmentUnavailable,
            "checklist": ChecklistUnavailable,
            "referral": ReferralUnavailable,
        }[kind]
    ):
        operation()


def marker_fixture(monkeypatch, rows):
    store = FirestoreNotificationStore(Settings(_env_file=None))
    connection, collection, transaction = Mock(), Mock(), Mock()
    references = {row.id: Mock() for row in rows}
    snapshots = []
    for row in rows:
        snapshot = Mock(exists=True, id=row.id, reference=references[row.id])
        snapshot.to_dict.return_value = row.model_dump(by_alias=True)
        snapshots.append(snapshot)
    connection.get_all.return_value = list(reversed(snapshots))
    connection.transaction.return_value = transaction
    collection.document.side_effect = lambda identifier: references[identifier]
    store._client = connection
    monkeypatch.setattr(store, "_collection", lambda uid: collection)
    monkeypatch.setattr(
        notifications.firestore, "transactional", lambda function: function
    )
    return store, connection, transaction, snapshots, references


def test_mark_read_batch_handles_unordered_sdk_results_and_is_idempotent(monkeypatch):
    a, b = event(), event(revision=2, read=True)
    store, connection, transaction, _, refs = marker_fixture(monkeypatch, [a, b])
    store.mark_read("owner", [a.id, b.id])
    connection.get_all.assert_called_once_with(
        list(refs.values()), transaction=transaction, retry=None, timeout=5
    )
    assert (
        transaction.update.call_count == 1
        and transaction.update.call_args.args[0] == refs[a.id]
    )
    patch = transaction.update.call_args.args[1]
    assert set(patch) == {"isRead", "readAt"} and patch["isRead"] is True
    encode_dict(patch)


@pytest.mark.parametrize(
    "corruption", ["missing", "foreign", "wrong-path", "duplicate"]
)
def test_all_batch_rows_are_validated_before_any_read_state_write(
    monkeypatch, corruption
):
    a, b = event(), event(revision=2)
    store, connection, transaction, rows, _ = marker_fixture(monkeypatch, [a, b])
    if corruption == "missing":
        rows[1].exists = False
    if corruption == "foreign":
        rows[1].to_dict.return_value = {**b.model_dump(by_alias=True), "uid": "foreign"}
    if corruption == "wrong-path":
        rows[1].reference = Mock()
    if corruption == "duplicate":
        connection.get_all.return_value = [rows[0], rows[0]]
    with pytest.raises((NotificationMissing, NotificationsUnavailable)):
        store.mark_read("owner", [a.id, b.id])
    assert not transaction.update.called and not transaction.create.called


@pytest.mark.parametrize("unread", [False, True])
def test_sdk_list_scopes_owner_limits_filters_and_allows_read_cursor(
    monkeypatch, unread
):
    connection = Client(
        project="unit-notifications", credentials=AnonymousCredentials()
    )
    store = FirestoreNotificationStore(Settings(_env_file=None))
    store._client = connection
    cursor = event(revision=3, read=True)
    item = event(revision=2, read=not unread)
    collection = notification_collection(connection, "owner")
    anchor = DocumentSnapshot(
        collection.document(cursor.id),
        cursor.model_dump(by_alias=True),
        True,
        STAMP,
        STAMP,
        STAMP,
    )
    row = DocumentSnapshot(
        collection.document(item.id),
        item.model_dump(by_alias=True),
        True,
        STAMP,
        STAMP,
        STAMP,
    )
    monkeypatch.setattr(
        type(collection.document(cursor.id)), "get", lambda *_, **__: anchor
    )

    def stream(query, **kwargs):
        assert query._parent._path == collection._path and query._limit == 21
        assert (
            query._orders[0].field.field_path == ("__name__" if unread else "id")
            and query._orders[0].direction == 2
        )
        if unread:
            assert (
                query._field_filters[0].field.field_path == "isRead"
                and query._field_filters[0].value.boolean_value is False
            )
        else:
            assert not query._field_filters
        # Snapshot cursors encode the indexed string ID for all-notifications,
        # and the document reference for the existing unread query.
        proto = query._to_protobuf()
        assert len(proto.order_by) == (1 if unread else 2)
        cursor_value = proto.start_at.values[0]
        if unread:
            assert cursor_value.reference_value.endswith("/" + cursor.id)
        else:
            assert cursor_value.string_value == cursor.id
            assert proto.order_by[1].field.field_path == "__name__"
            assert proto.order_by[1].direction == 2
            assert proto.start_at.values[1].reference_value.endswith("/" + cursor.id)
        assert not proto.start_at.before
        assert kwargs == {"retry": None, "timeout": 5}
        return iter([row])

    monkeypatch.setattr(Query, "stream", stream)
    page = store.list("owner", unread, cursor.id, 20)
    assert page.notifications[0].id == item.id and page.next_cursor is None
    assert page.notifications[0].is_read is (not unread)


def test_emulator_and_sdk_storage_failures_are_unavailable(monkeypatch):
    store = FirestoreNotificationStore(Settings(_env_file=None))
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "untrusted:1234")
    with pytest.raises(NotificationsUnavailable):
        store._collection("owner")
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST")
    collection = Mock()
    collection.order_by.side_effect = PermissionDenied("PRIVATE")
    monkeypatch.setattr(store, "_collection", lambda uid: collection)
    with pytest.raises(NotificationsUnavailable):
        store.list("owner", False, None, 20)
