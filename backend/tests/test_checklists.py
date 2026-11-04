"""Checklist ownership, source snapshots, concurrency and storage failures; no live cloud."""

from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied
from google.cloud.firestore_v1._helpers import encode_dict
from pydantic import ValidationError

from app import checklists
from app.auth import InvalidToken, VerificationUnavailable
from app.checklists import (
    ChecklistConflict,
    ChecklistInvalid,
    ChecklistMissing,
    ChecklistPage,
    ChecklistRecord,
    ChecklistUnavailable,
    ChecklistUpdate,
    FirestoreChecklistStore,
    make_template,
    next_record,
    summary,
)
from app.config import Settings
from app.main import create_app
from app.pathways import PathwayStore, PathwayUnavailable

ID, OTHER = "a" * 32, "b" * 32
URL = "/api/v1/checklists"
PATHWAY = "cak-consumer-complaint"


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        if token == "unavailable":
            raise VerificationUnavailable
        return {"uid": token}


class MemoryStore:
    def __init__(self):
        self.records, self.calls, self.lock = {}, [], Lock()

    def get(self, uid, identifier):
        self.calls.append(("get", uid, identifier))
        try:
            return self.records[uid, identifier]
        except KeyError as error:
            raise ChecklistMissing from error

    def save(self, uid, identifier, update, template=None):
        with self.lock:
            self.calls.append(("save", uid, identifier))
            record = next_record(
                uid, identifier, self.records.get((uid, identifier)), update, template
            )
            self.records[uid, identifier] = record
            return record

    def list(self, uid, status, cursor, limit):
        self.calls.append(("list", uid, cursor))
        if cursor and (
            (uid, cursor) not in self.records
            or status
            and self.records[uid, cursor].status != status
        ):
            raise ChecklistMissing
        records = sorted(
            (
                record
                for (owner, identifier), record in self.records.items()
                if owner == uid
                and (not status or record.status == status)
                and (not cursor or identifier > cursor)
            ),
            key=lambda row: row.id,
        )
        return ChecklistPage(
            checklists=[summary(record) for record in records[:limit]],
            nextCursor=records[limit - 1].id if len(records) > limit else None,
        )


def client(store=None, pathways=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            checklist_store=store if store is not None else MemoryStore(),
            pathway_store=pathways,
        )
    )


def headers(uid="user-a"):
    return {"Authorization": "Bearer " + uid}


def template():
    return make_template(PathwayStore().load().pathways[0])


def body(revision=0, checked=None, **changes):
    source = template()
    return {
        "pathwayId": source.pathway_id,
        "templateVersion": source.template_version,
        "checkedIds": checked or [],
        "expectedRevision": revision,
        **changes,
    }


def saved():
    return next_record(
        "user-a",
        ID,
        None,
        ChecklistUpdate.model_validate(body(checked=[template().items[0].id])),
        template(),
    )


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", URL),
        ("get", URL + "/templates/" + PATHWAY),
        ("get", URL + "/" + ID),
        ("put", URL + "/" + ID),
    ],
)
@pytest.mark.parametrize(
    "token,expected", [(None, 401), ("invalid", 401), ("unavailable", 503)]
)
def test_authentication_is_required_before_storage(method, path, token, expected):
    store = MemoryStore()
    with client(store) as api:
        response = getattr(api, method)(
            path,
            headers=headers(token) if token else {},
            **({"json": body()} if method == "put" else {}),
        )
    assert response.status_code == expected and not store.calls


def test_loading_templates_lists_and_missing_records_never_creates_checklists():
    store = MemoryStore()
    with client(store) as api:
        source = api.get(URL + "/templates/" + PATHWAY, headers=headers())
        assert (
            source.status_code == 200
            and source.json()["templateVersion"] == template().template_version
        )
        assert api.get(URL, headers=headers()).json() == {
            "checklists": [],
            "nextCursor": None,
        }
        assert api.get(URL + "/" + ID, headers=headers()).status_code == 404
    assert not store.records and all(call[0] != "save" for call in store.calls)


def test_save_reopen_restore_and_complete_use_confirmed_owner_records():
    store = MemoryStore()
    with client(store) as api:
        first = api.put(
            URL + "/" + ID,
            headers=headers(),
            json=body(checked=[template().items[0].id]),
        )
        assert first.status_code == 200
        record = first.json()["checklist"]
        assert (
            record["uid"] == "user-a"
            and record["revision"] == 1
            and record["status"] == "in-progress"
        )
        restored = api.get(URL + "/" + ID, headers=headers())
        assert (
            restored.json() == first.json()
            and restored.headers["Cache-Control"] == "no-store"
        )
        complete = api.put(
            URL + "/" + ID,
            headers=headers(),
            json=body(revision=1, checked=[item.id for item in template().items]),
        ).json()["checklist"]
        assert complete["status"] == "complete" and complete["revision"] == 2
        assert complete["createdAt"] == record["createdAt"]
        assert (
            complete["items"] == record["items"]
            and complete["sourceReview"] == record["sourceReview"]
        )


def test_another_account_cannot_read_update_list_or_use_a_foreign_cursor():
    store = MemoryStore()
    store.records["user-a", ID] = saved()
    with client(store) as api:
        assert api.get(URL + "/" + ID, headers=headers("user-b")).status_code == 404
        assert (
            api.put(
                URL + "/" + ID, headers=headers("user-b"), json=body(revision=1)
            ).status_code
            == 404
        )
        assert api.get(URL, headers=headers("user-b")).json()["checklists"] == []
        assert (
            api.get(URL + "?after=" + ID, headers=headers("user-b")).status_code == 404
        )
    assert store.records["user-a", ID].revision == 1


def test_repeated_creation_and_simultaneous_stale_saves_do_not_overwrite():
    store = MemoryStore()
    with client(store) as api:
        assert (
            api.put(URL + "/" + ID, headers=headers(), json=body()).status_code == 200
        )
        assert (
            api.put(URL + "/" + ID, headers=headers(), json=body()).status_code == 409
        )

        def save(index):
            return api.put(
                URL + "/" + ID,
                headers=headers(),
                json=body(revision=1, checked=[template().items[index].id]),
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(save, [0, 1])) == [200, 409]
    assert len(store.records) == 1 and store.records["user-a", ID].revision == 2


def test_changed_public_template_rejects_stale_create_without_reassigning_ticks():
    store, pathways = MemoryStore(), Mock()
    changed = PathwayStore().load()
    changed.pathways[0].preparation[0].label = "New item meaning"
    pathways.load.return_value = changed
    with client(store, pathways) as api:
        response = api.put(
            URL + "/" + ID,
            headers=headers(),
            json=body(checked=[template().items[0].id]),
        )
    assert response.status_code == 409 and not store.records


def test_existing_snapshots_reopen_and_save_even_when_public_catalogue_is_unavailable():
    store, pathways = MemoryStore(), Mock()
    store.records["user-a", ID] = saved()
    pathways.load.side_effect = PathwayUnavailable
    with client(store, pathways) as api:
        assert api.get(URL + "/" + ID, headers=headers()).status_code == 200
        result = api.put(URL + "/" + ID, headers=headers(), json=body(revision=1))
        assert (
            result.status_code == 200
            and result.json()["checklist"]["items"]
            == saved().model_dump(by_alias=True, mode="json")["items"]
        )
    pathways.load.assert_not_called()


@pytest.mark.parametrize(
    "change",
    [
        {"uid": "private-do-not-echo"},
        {"items": []},
        {"status": "complete"},
        {"sourceReview": {}},
        {"revision": 99},
        {"expectedRevision": True},
        {"checkedIds": ["invented-item"]},
        {"checkedIds": ["read-scope", "read-scope"]},
        {"expectedRevision": -1},
        {"templateVersion": "bad"},
    ],
)
def test_invalid_or_forged_progress_is_rejected_without_writes(change):
    store = MemoryStore()
    with client(store) as api:
        payload = body()
        payload.update(change)
        result = api.put(URL + "/" + ID, headers=headers(), json=payload)
    assert (
        result.status_code == 422
        and "private-do-not-echo" not in result.text
        and not store.records
    )


@pytest.mark.parametrize(
    "query", ["limit=0", "limit=51", "status=eligible", "after=bad"]
)
def test_invalid_list_options_never_query_storage(query):
    store = MemoryStore()
    with client(store) as api:
        assert api.get(URL + "?" + query, headers=headers()).status_code == 422
    assert not store.calls


def test_owner_metadata_pagination_filters_and_counts_are_consistent():
    store = MemoryStore()
    with client(store) as api:
        api.put(URL + "/" + ID, headers=headers(), json=body())
        api.put(
            URL + "/" + OTHER,
            headers=headers(),
            json=body(checked=[item.id for item in template().items]),
        )
        api.put(URL + "/" + "c" * 32, headers=headers("user-b"), json=body())
        page = api.get(URL + "?limit=1", headers=headers()).json()
        assert page["nextCursor"] == ID and len(page["checklists"]) == 1
        assert set(page["checklists"][0]) == {
            "id",
            "pathwayTitle",
            "completedItems",
            "totalItems",
            "status",
            "revision",
            "createdAt",
            "updatedAt",
        }
        assert (
            api.get(URL + "?after=" + ID, headers=headers()).json()["checklists"][0][
                "id"
            ]
            == OTHER
        )
        filtered = api.get(URL + "?status=complete", headers=headers()).json()[
            "checklists"
        ]
        assert (
            len(filtered) == 1
            and filtered[0]["completedItems"] == filtered[0]["totalItems"] == 3
        )
        assert (
            api.get(URL + "?status=complete&after=" + ID, headers=headers()).status_code
            == 404
        )


@pytest.mark.parametrize("operation", ["get", "save", "list"])
def test_storage_failures_return_generic_errors_without_fake_empty_or_success(
    operation,
):
    store = Mock()
    getattr(store, operation).side_effect = ChecklistUnavailable(
        "private-storage-details"
    )
    with client(store) as api:
        result = (
            api.put(URL + "/" + ID, headers=headers(), json=body())
            if operation == "save"
            else api.get(
                URL + ("/" + ID if operation == "get" else ""), headers=headers()
            )
        )
    assert result.status_code == 503 and "private-storage-details" not in result.text


@pytest.mark.parametrize("operation", ["get", "save"])
def test_foreign_storage_records_are_not_returned(operation):
    store = Mock()
    foreign = saved().model_copy(update={"uid": "foreign-owner"})
    getattr(store, operation).return_value = foreign
    with client(store) as api:
        result = (
            api.put(URL + "/" + ID, headers=headers(), json=body())
            if operation == "save"
            else api.get(URL + "/" + ID, headers=headers())
        )
    assert result.status_code == 503 and "foreign-owner" not in result.text


def transaction_fixture(monkeypatch, record=None):
    reference, connection, transaction = Mock(), Mock(), Mock()
    reference.get.return_value.exists = record is not None
    reference.get.return_value.to_dict.return_value = (
        record.model_dump(by_alias=True) if record else None
    )
    connection.transaction.return_value = transaction
    monkeypatch.setattr(
        checklists.firestore, "transactional", lambda function: function
    )
    store = FirestoreChecklistStore(Settings(_env_file=None))
    store._client = connection
    monkeypatch.setattr(
        store, "_collection", lambda uid: Mock(document=Mock(return_value=reference))
    )
    return store, reference, transaction


def test_firestore_transaction_reads_before_creating_and_rejects_stale_revisions(
    monkeypatch,
):
    store, reference, transaction = transaction_fixture(monkeypatch)
    result = store.save(
        "user-a", ID, ChecklistUpdate.model_validate(body()), template()
    )
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    stored = result.model_dump(by_alias=True)
    stored["sourceReview"] = result.source_review.model_dump(by_alias=True, mode="json")
    transaction.create.assert_called_once_with(reference, stored)
    assert isinstance(stored["sourceReview"]["checkedOn"], str)
    encode_dict(stored)
    transaction.set.assert_not_called()
    store, reference, transaction = transaction_fixture(monkeypatch, result)
    with pytest.raises(ChecklistConflict):
        store.save("user-a", ID, ChecklistUpdate.model_validate(body()), template())
    assert not transaction.set.called and not transaction.create.called
    updated = store.save(
        "user-a",
        ID,
        ChecklistUpdate.model_validate(
            body(revision=1, checked=[template().items[0].id])
        ),
    )
    stored = updated.model_dump(by_alias=True)
    stored["sourceReview"] = updated.source_review.model_dump(
        by_alias=True, mode="json"
    )
    transaction.set.assert_called_once_with(reference, stored)
    encode_dict(stored)


def test_firestore_uses_default_database_and_hashes_owner_scope(monkeypatch):
    connection, sentinel = Mock(), object()
    monkeypatch.setattr(checklists, "get_firebase_app", lambda settings: sentinel)
    factory = Mock(return_value=connection)
    monkeypatch.setattr(checklists.firestore, "client", factory)
    store = FirestoreChecklistStore(Settings(_env_file=None))
    store._collection("owner/with/slashes")
    factory.assert_called_once_with(app=sentinel, database_id="(default)")
    connection.collection.assert_called_once_with("checklistOwners")
    owner = connection.collection.return_value.document.call_args.args[0]
    assert len(owner) == 64 and "/" not in owner
    connection.collection.return_value.document.return_value.collection.assert_called_once_with(
        "checklists"
    )


def test_firestore_list_is_bounded_and_validates_owned_cursor(monkeypatch):
    anchor = Mock(exists=True, id=ID)
    anchor.to_dict.return_value = saved().model_dump(by_alias=True)
    collection, query = Mock(), Mock()
    collection.document.return_value.get.return_value = anchor
    collection.order_by.return_value = query
    query.where.return_value = query
    query.start_after.return_value = query
    query.limit.return_value.stream.return_value = [anchor]
    store = FirestoreChecklistStore(Settings(_env_file=None))
    monkeypatch.setattr(store, "_collection", lambda uid: collection)
    assert store.list("user-a", "in-progress", ID, 20).checklists[0].id == ID
    query.limit.assert_called_once_with(21)
    query.start_after.assert_called_once_with(anchor)
    query.limit.return_value.stream.assert_called_once_with(retry=None, timeout=10)
    anchor.to_dict.return_value = (
        saved().model_copy(update={"uid": "foreign"}).model_dump(by_alias=True)
    )
    with pytest.raises(ChecklistUnavailable):
        store.list("user-a", None, ID, 20)


def test_emulator_permission_errors_and_corrupt_snapshots_fail_closed(monkeypatch):
    store = FirestoreChecklistStore(Settings(_env_file=None))
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "localhost:8080")
    with pytest.raises(ChecklistUnavailable):
        store.get("user-a", ID)
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST")
    monkeypatch.setattr(
        store, "_collection", Mock(side_effect=PermissionDenied("private"))
    )
    with pytest.raises(ChecklistUnavailable):
        store.list("user-a", None, None, 20)
    data = saved().model_dump(by_alias=True)
    data["items"][0]["label"] = "Tampered item"
    with pytest.raises(ValidationError):
        ChecklistRecord.model_validate(data)


def test_empty_template_is_empty_not_complete_and_snapshots_cannot_be_switched():
    pathway = PathwayStore().load().pathways[0].model_copy(update={"preparation": []})
    source = make_template(pathway)
    update = ChecklistUpdate.model_validate(
        body(templateVersion=source.template_version)
    )
    record = next_record("user-a", ID, None, update, source)
    assert record.status == "empty" and summary(record).total_items == 0
    with pytest.raises(ChecklistConflict):
        next_record(
            "user-a",
            ID,
            saved(),
            ChecklistUpdate.model_validate(
                body(revision=1, pathwayId="another-pathway")
            ),
        )
    with pytest.raises(ChecklistInvalid):
        next_record(
            "user-a",
            ID,
            None,
            ChecklistUpdate.model_validate(body(checked=["foreign-item"])),
            template(),
        )
