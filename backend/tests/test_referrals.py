"""Own-account immutable requests and truthful no-delivery states; cloud is mocked."""

from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied
from google.cloud.firestore_v1._helpers import encode_dict

from app import referrals
from app.auth import InvalidToken, VerificationUnavailable
from app.config import Settings
from app.main import create_app
from app.referrals import (
    FirestoreReferralStore,
    ReferralConflict,
    ReferralCreate,
    ReferralMissing,
    ReferralPage,
    ReferralUnavailable,
    make_record,
    summary,
)

ID, OTHER, URL = "a" * 32, "b" * 32, "/api/v1/referrals"
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
            raise ReferralMissing from error

    def create(self, uid, identifier, update, selection):
        with self.lock:
            self.calls.append(("create", uid, identifier))
            if (uid, identifier) in self.records:
                raise ReferralConflict
            record = make_record(uid, identifier, update, selection)
            self.records[uid, identifier] = record
            return record

    def list(self, uid, cursor, limit):
        self.calls.append(("list", uid, cursor))
        if cursor and (uid, cursor) not in self.records:
            raise ReferralMissing
        rows = sorted(
            (
                row
                for (owner, identifier), row in self.records.items()
                if owner == uid and (not cursor or identifier > cursor)
            ),
            key=lambda row: row.id,
        )
        return ReferralPage(
            referrals=[summary(row) for row in rows[:limit]],
            nextCursor=rows[limit - 1].id if len(rows) > limit else None,
        )


def headers(uid="owner"):
    return {"Authorization": "Bearer " + uid}


def client(store=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            referral_store=store if store is not None else MemoryStore(),
        )
    )


def selection():
    with client() as api:
        return api.get(URL + "/selection/" + PATHWAY, headers=headers()).json()


def body(**changes):
    source = selection()
    return {
        "pathwayId": source["pathway"]["id"],
        "serviceId": source["service"]["id"],
        "selectionVersion": source["selectionVersion"],
        "fullName": "Test Person",
        "email": "test@example.test",
        "phone": None,
        "contactMethod": "email",
        "description": "Non-sensitive test request",
        "acknowledged": True,
        "expectedRevision": 0,
        **changes,
    }


@pytest.mark.parametrize(
    "endpoint,method",
    [
        ("", "get"),
        ("/" + ID, "get"),
        ("/" + ID, "put"),
        ("/selection/" + PATHWAY, "get"),
    ],
)
@pytest.mark.parametrize(
    "token,status", [(None, 401), ("invalid", 401), ("unavailable", 503)]
)
def test_unauthenticated_requests_do_not_reach_storage(endpoint, method, token, status):
    store = MemoryStore()
    with client(store) as api:
        response = getattr(api, method)(
            URL + endpoint,
            headers=headers(token) if token else {},
            **({"json": body()} if method == "put" else {}),
        )
    assert response.status_code == status and not store.calls


def test_resolve_save_reload_truthful_status_and_metadata_only_list():
    store = MemoryStore()
    with client(store) as api:
        source = api.get(URL + "/selection/" + PATHWAY, headers=headers())
        assert source.status_code == 200 and not store.calls
        response = api.put(URL + "/" + ID, headers=headers(), json=body())
        assert response.status_code == 200
        record = response.json()["referral"]
        assert (
            record["uid"] == "owner"
            and record["status"] == "saved"
            and record["deliveryStatus"] == "not-sent"
        )
        assert (
            record["revision"] == 1
            and record["acknowledgementVersion"] == "project-request-v1"
        )
        assert record["savedAt"] == record["updatedAt"] == record["acknowledgedAt"]
        assert api.get(URL + "/" + ID, headers=headers()).json()["referral"] == record
        assert api.get(URL + "/" + ID, headers=headers("other")).status_code == 404
        assert (
            api.get(URL + "?after=" + ID, headers=headers("other")).status_code == 404
        )
        page = api.get(URL, headers=headers()).json()
        assert set(page["referrals"][0]) == {
            "id",
            "pathwayTitle",
            "serviceName",
            "savedAt",
            "status",
            "deliveryStatus",
        }
        assert "description" not in str(page) and "test@example.test" not in str(page)
        assert response.headers["cache-control"] == "no-store"
        assert api.delete(URL + "/" + ID, headers=headers()).status_code == 405


@pytest.mark.parametrize(
    "changes",
    [
        {"uid": "injected-owner"},
        {"status": "completed"},
        {"deliveryStatus": "sent"},
        {"savedAt": "2026-01-01"},
        {"acknowledged": False},
        {"acknowledged": 1},
        {"expectedRevision": True},
        {"expectedRevision": 1},
        {"description": " "},
        {"description": "x" * 1501},
        {"fullName": "\u0000bad"},
        {"email": "bad"},
        {"contactMethod": "sms"},
        {"phone": "0712345678"},
        {"contactMethod": "phone", "phone": None},
    ],
)
def test_invalid_private_values_are_redacted_and_never_saved(changes):
    store = MemoryStore()
    with client(store) as api:
        response = api.put(URL + "/" + ID, headers=headers(), json=body(**changes))
    assert (
        response.status_code == 422
        and "Invalid referral input" in response.text
        and not store.calls
    )
    assert (
        "test@example.test" not in response.text
        and "Non-sensitive" not in response.text
    )


@pytest.mark.parametrize(
    "changes", [{"serviceId": "nlas-legal-aid"}, {"selectionVersion": "0" * 64}]
)
def test_source_selection_mismatch_never_creates_request(changes):
    store = MemoryStore()
    with client(store) as api:
        assert (
            api.put(URL + "/" + ID, headers=headers(), json=body(**changes)).status_code
            == 409
        )
    assert not store.records


def test_duplicate_and_concurrent_saves_do_not_overwrite_or_duplicate():
    store, payload = MemoryStore(), body()
    with client(store) as api:

        def save(_):
            return api.put(URL + "/" + ID, headers=headers(), json=payload).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(save, range(2)))
        assert sorted(statuses) == [200, 409] and len(store.records) == 1
        assert (
            api.put(
                URL + "/" + ID,
                headers=headers(),
                json={**payload, "description": "changed"},
            ).status_code
            == 409
        )
        assert (
            api.get(URL + "/" + ID, headers=headers()).json()["referral"]["description"]
            == payload["description"]
        )


def test_private_list_is_bounded_and_cursors_are_owner_specific():
    store, payload = MemoryStore(), body()
    with client(store) as api:
        for identifier in [ID, OTHER]:
            api.put(URL + "/" + identifier, headers=headers(), json=payload)
        api.put(URL + "/" + "c" * 32, headers=headers("foreign"), json=payload)
        page = api.get(URL + "?limit=1", headers=headers()).json()
        assert page["nextCursor"] == ID and len(page["referrals"]) == 1
        assert (
            api.get(URL + "?after=" + ID, headers=headers()).json()["referrals"][0][
                "id"
            ]
            == OTHER
        )
        for query in ["limit=0", "limit=51", "after=bad"]:
            assert api.get(URL + "?" + query, headers=headers()).status_code == 422


@pytest.mark.parametrize("operation", ["get", "create", "list"])
def test_storage_errors_never_report_empty_or_saved(operation):
    store = Mock()
    getattr(store, operation).side_effect = ReferralUnavailable("private-storage-error")
    with client(store) as api:
        result = (
            api.put(URL + "/" + ID, headers=headers(), json=body())
            if operation == "create"
            else api.get(
                URL + ("/" + ID if operation == "get" else ""), headers=headers()
            )
        )
    assert result.status_code == 503 and "private-storage-error" not in result.text


def test_firestore_create_is_atomic_and_payload_is_sdk_encodable(monkeypatch):
    store = FirestoreReferralStore(Settings(_env_file=None))
    reference, connection, transaction = Mock(), Mock(), Mock()
    reference.get.return_value.exists = False
    store._client = connection
    connection.transaction.return_value = transaction
    monkeypatch.setattr(
        store, "_collection", lambda uid: Mock(document=Mock(return_value=reference))
    )
    monkeypatch.setattr(referrals.firestore, "transactional", lambda function: function)
    source = referrals.ReferralSelection.model_validate(selection())
    result = store.create("owner", ID, ReferralCreate.model_validate(body()), source)
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    data = transaction.create.call_args_list[0].args[1]
    assert isinstance(data["selection"]["sourceReview"]["checkedOn"], str)
    encode_dict(data)
    reference.get.return_value.exists = True
    reference.get.return_value.to_dict.return_value = data
    with pytest.raises(ReferralConflict):
        store.create("owner", ID, ReferralCreate.model_validate(body()), source)
    assert transaction.create.call_count == 2 and not transaction.set.called
    assert result.saved_at == result.updated_at


def test_firestore_namespace_cursor_validation_and_permission_failure(monkeypatch):
    store, connection = FirestoreReferralStore(Settings(_env_file=None)), Mock()
    store._client = connection
    collection = store._collection("owner/with/slashes")
    connection.collection.assert_called_once_with("referralOwners")
    owner = connection.collection.return_value.document.call_args.args[0]
    assert len(owner) == 64 and "/" not in owner
    collection.document.return_value.get.side_effect = PermissionDenied("private")
    with pytest.raises(ReferralUnavailable):
        store.get("owner", ID)
    collection.document.return_value.get.side_effect = None
    collection.document.return_value.get.return_value.exists = False
    with pytest.raises(ReferralMissing):
        store.list("owner", ID, 20)
    assert not collection.order_by.return_value.start_after.called
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "untrusted:1234")
    with pytest.raises(ReferralUnavailable):
        store._collection("owner")


@pytest.mark.parametrize(
    "change",
    [
        {"uid": "foreign"},
        {"id": OTHER},
        {"deliveryStatus": "sent"},
        {"status": "completed"},
        {"updatedAt": "2030-01-01T00:00:00Z"},
    ],
)
def test_corrupt_or_foreign_firestore_records_fail_closed(change):
    store = FirestoreReferralStore(Settings(_env_file=None))
    record = make_record(
        "owner",
        ID,
        ReferralCreate.model_validate(body()),
        referrals.ReferralSelection.model_validate(selection()),
    )
    snapshot = Mock(exists=True)
    snapshot.to_dict.return_value = {**record.model_dump(by_alias=True), **change}
    store._collection = lambda uid: Mock(
        document=Mock(return_value=Mock(get=Mock(return_value=snapshot)))
    )
    with pytest.raises(ReferralUnavailable):
        store.get("owner", ID)


@pytest.mark.parametrize(
    "field", ["scope", "status", "deliveryStatus", "acknowledgementVersion", "savedAt"]
)
def test_incomplete_stored_record_never_becomes_a_confirmation(field):
    store = FirestoreReferralStore(Settings(_env_file=None))
    record = make_record(
        "owner",
        ID,
        ReferralCreate.model_validate(body()),
        referrals.ReferralSelection.model_validate(selection()),
    )
    data = record.model_dump(by_alias=True)
    del data[field]
    snapshot = Mock(exists=True)
    snapshot.to_dict.return_value = data
    store._collection = lambda uid: Mock(
        document=Mock(return_value=Mock(get=Mock(return_value=snapshot)))
    )
    with pytest.raises(ReferralUnavailable):
        store.get("owner", ID)


def test_firestore_list_bounds_rows_and_checks_cursor_owner(monkeypatch):
    record = make_record(
        "owner",
        ID,
        ReferralCreate.model_validate(body()),
        referrals.ReferralSelection.model_validate(selection()),
    )
    anchor = Mock(exists=True, id=ID)
    anchor.to_dict.return_value = record.model_dump(by_alias=True)
    collection, query = Mock(), Mock()
    collection.document.return_value.get.return_value = anchor
    collection.order_by.return_value = query
    query.start_after.return_value = query
    query.limit.return_value.stream.return_value = [anchor]
    store = FirestoreReferralStore(Settings(_env_file=None))
    monkeypatch.setattr(store, "_collection", lambda uid: collection)
    page = store.list("owner", ID, 20)
    assert page.referrals[0].id == ID
    query.limit.assert_called_once_with(21)
    query.start_after.assert_called_once_with(anchor)
    query.limit.return_value.stream.assert_called_once_with(retry=None, timeout=10)
    anchor.to_dict.return_value = {**record.model_dump(by_alias=True), "uid": "foreign"}
    with pytest.raises(ReferralUnavailable):
        store.list("owner", ID, 20)
