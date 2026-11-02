"""Test own-profile boundaries and storage failure behavior without live Firebase."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Lock
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied, ServiceUnavailable

from app import profiles
from app.auth import InvalidToken, VerificationUnavailable
from app.config import Settings
from app.main import create_app
from app.profiles import (
    FirestoreProfileStore,
    ProfileConflict,
    ProfileRecord,
    ProfileUnavailable,
    ProfileUpdate,
    profile_document_id,
)

STAMP = datetime(2026, 1, 1, tzinfo=UTC)


def payload(**changes):
    return {
        "fullName": "Test Person",
        "phone": None,
        "preferredLanguage": "en",
        "expectedRevision": 0,
        **changes,
    }


def record(uid="user-a", revision=1):
    return ProfileRecord.model_validate(
        {
            **{k: v for k, v in payload().items() if k != "expectedRevision"},
            "uid": uid,
            "revision": revision,
            "createdAt": STAMP,
            "updatedAt": STAMP,
        }
    )


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        if token == "unavailable":
            raise VerificationUnavailable
        if token == "admin-a":
            return {"uid": "user-a", "role": "admin"}
        return {"uid": token}


class MemoryStore:
    def __init__(self):
        self.records = {}
        self.calls = []
        self.lock = Lock()

    def get(self, uid):
        self.calls.append(("get", uid))
        return self.records.get(uid)

    def save(self, uid, update):
        with self.lock:
            self.calls.append(("save", uid))
            previous = self.records.get(uid)
            revision = previous.revision if previous else 0
            if revision != update.expected_revision:
                raise ProfileConflict
            value = ProfileRecord.model_validate(
                {
                    **update.model_dump(by_alias=True, exclude={"expected_revision"}),
                    "uid": uid,
                    "revision": revision + 1,
                    "createdAt": previous.created_at if previous else STAMP,
                    "updatedAt": STAMP,
                }
            )
            self.records[uid] = value
            return value


def client(store=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            Verifier(),
            store if store is not None else MemoryStore(),
        )
    )


def headers(uid="user-a"):
    return {"Authorization": "Bearer " + uid}


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("authorization", [None, "Basic bad", "Bearer invalid"])
def test_profile_requires_authentication_before_storage(method, authorization):
    store = MemoryStore()
    with client(store) as api:
        response = api.request(
            method,
            "/api/v1/profile/me",
            headers={"Authorization": authorization} if authorization else {},
            **({"json": payload()} if method == "PUT" else {}),
        )
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert store.calls == []


def test_unavailable_authentication_does_not_contact_storage():
    store = MemoryStore()
    with client(store) as api:
        assert (
            api.get("/api/v1/profile/me", headers=headers("unavailable")).status_code
            == 503
        )
    assert not store.calls


def test_missing_profile_is_null_and_does_not_create_a_document():
    store = MemoryStore()
    with client(store) as api:
        response = api.get("/api/v1/profile/me", headers=headers())
        assert response.status_code == 200
        assert response.json() == {"profile": None}
        assert response.headers["cache-control"] == "no-store"
    assert not store.records
    assert store.calls == [("get", "user-a")]


def test_profile_creation_and_update_preserve_creation_date_and_increment_revision():
    store = MemoryStore()
    with client(store) as api:
        created = api.put(
            "/api/v1/profile/me",
            headers=headers(),
            json=payload(fullName="  Test Person  ", phone=" "),
        ).json()["profile"]
        assert created["fullName"] == "Test Person"
        assert created["phone"] is None
        assert created["revision"] == 1
        saved = api.put(
            "/api/v1/profile/me",
            headers=headers(),
            json=payload(
                fullName="Updated Test", preferredLanguage="sw", expectedRevision=1
            ),
        ).json()["profile"]
        assert saved["revision"] == 2
        assert saved["createdAt"] == created["createdAt"]
        assert saved["preferredLanguage"] == "sw"
        assert (
            api.get("/api/v1/profile/me", headers=headers()).json()["profile"] == saved
        )
        assert "email" not in saved and "role" not in saved


def test_query_header_and_path_cannot_select_another_users_profile():
    store = MemoryStore()
    store.records["user-b"] = record("user-b")
    with client(store) as api:
        response = api.get(
            "/api/v1/profile/me?uid=user-b&role=admin",
            headers={**headers(), "X-User-Id": "user-b", "X-Role": "admin"},
        )
        assert response.json() == {"profile": None}
        assert api.get("/api/v1/profile/user-b", headers=headers()).status_code == 404
        assert api.get("/api/v1/profile/me", headers=headers("admin-a")).json() == {
            "profile": None
        }
    assert all(uid == "user-a" for _, uid in store.calls)
    assert store.records["user-b"].full_name == "Test Person"


@pytest.mark.parametrize(
    "extra",
    [
        "uid",
        "role",
        "email",
        "emailVerified",
        "createdAt",
        "updatedAt",
        "revision",
        "password",
    ],
)
def test_input_cannot_set_identity_roles_credentials_or_server_metadata(extra):
    store = MemoryStore()
    with client(store) as api:
        response = api.put(
            "/api/v1/profile/me",
            headers=headers(),
            json=payload(**{extra: "private-rejected-value"}),
        )
        assert response.status_code == 422
        assert "private-rejected-value" not in response.text
        assert store.calls == []


@pytest.mark.parametrize(
    "change",
    [
        {"fullName": " "},
        {"fullName": "x" * 121},
        {"fullName": 12},
        {"fullName": "A\nB"},
        {"preferredLanguage": "xx"},
        {"preferredLanguage": None},
        {"phone": "0712345678"},
        {"phone": 123},
        {"phone": "+0" + "1" * 8},
        {"expectedRevision": True},
        {"expectedRevision": "0"},
        {"expectedRevision": -1},
    ],
)
def test_invalid_profile_input_is_rejected_without_storage_or_value_echo(change):
    store = MemoryStore()
    with client(store) as api:
        assert (
            api.put(
                "/api/v1/profile/me", headers=headers(), json=payload(**change)
            ).status_code
            == 422
        )
    assert store.calls == []


def test_optional_phone_is_saved_without_any_verification_claim():
    with client() as api:
        response = api.put(
            "/api/v1/profile/me", headers=headers(), json=payload(phone="+254700000000")
        )
        assert response.status_code == 200
        assert response.json()["profile"]["phone"] == "+254700000000"
        assert "verified" not in response.text.lower()


def test_stale_revision_is_conflict_and_cannot_overwrite():
    store = MemoryStore()
    store.records["user-a"] = record()
    with client(store) as api:
        response = api.put(
            "/api/v1/profile/me", headers=headers(), json=payload(fullName="Stale edit")
        )
        assert response.status_code == 409
    assert store.records["user-a"].full_name == "Test Person"
    assert store.records["user-a"].revision == 1


def test_concurrent_requests_with_same_revision_cannot_both_succeed():
    store = MemoryStore()
    store.records["user-a"] = record()
    with client(store) as api:

        def save(index):
            return api.put(
                "/api/v1/profile/me",
                headers=headers(),
                json=payload(fullName=f"Edit {index}", expectedRevision=1),
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as workers:
            statuses = list(workers.map(save, [1, 2]))
    assert sorted(statuses) == [200, 409]
    assert store.records["user-a"].revision == 2


@pytest.mark.parametrize("method", ["GET", "PUT"])
def test_storage_errors_are_generic_and_do_not_leak_details(method):
    store = Mock()
    store.get.side_effect = ProfileUnavailable("private server path and credentials")
    store.save.side_effect = ProfileUnavailable("private server path and credentials")
    with client(store) as api:
        response = api.request(
            method,
            "/api/v1/profile/me",
            headers=headers(),
            **({"json": payload()} if method == "PUT" else {}),
        )
        assert response.status_code == 503
        assert response.json() == {
            "detail": "Profile storage is currently unavailable."
        }
        assert "private" not in response.text


@pytest.mark.parametrize("method", ["GET", "PUT"])
def test_mismatched_stored_owner_never_returns_another_profile(method):
    store = Mock()
    store.get.return_value = record("user-b")
    store.save.return_value = record("user-b")
    with client(store) as api:
        response = api.request(
            method,
            "/api/v1/profile/me",
            headers=headers(),
            **({"json": payload()} if method == "PUT" else {}),
        )
        assert response.status_code == 503
        assert "user-b" not in response.text


def test_profile_cors_allows_put_only_from_the_configured_origin():
    with client() as api:
        for origin, expected in [
            ("http://localhost:5173", 200),
            ("http://untrusted.invalid", 400),
        ]:
            response = api.options(
                "/api/v1/profile/me",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "PUT",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            assert response.status_code == expected
            assert response.headers.get("access-control-allow-origin") == (
                origin if expected == 200 else None
            )


def test_document_key_is_stable_distinct_and_not_a_firestore_path():
    assert profile_document_id("a/b") == profile_document_id("a/b")
    assert profile_document_id("a/b") != profile_document_id("a")
    assert len(profile_document_id("a/b")) == 64
    assert "/" not in profile_document_id("a/b")


def test_store_rejects_firestore_emulator_and_health_does_not_initialize_it(
    monkeypatch,
):
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "localhost:8080")
    store = FirestoreProfileStore(Settings(_env_file=None))
    with pytest.raises(ProfileUnavailable):
        store.get("user-a")
    with client(store) as api:
        assert api.get("/api/v1/health").status_code == 200


@pytest.mark.parametrize(
    "error", [PermissionDenied("private"), ServiceUnavailable("private")]
)
def test_firestore_failures_are_unavailable_without_default_credentials(
    monkeypatch, error
):
    store = FirestoreProfileStore(Settings(_env_file=None))

    def fail():
        raise error

    monkeypatch.setattr(store, "_get_client", fail)
    with pytest.raises(ProfileUnavailable):
        store.get("user-a")
    with pytest.raises(ProfileUnavailable):
        store.save("user-a", ProfileUpdate.model_validate(payload()))


def transaction_fixture(monkeypatch, saved=None):
    reference = Mock()
    reference.get.return_value.exists = saved is not None
    reference.get.return_value.to_dict.return_value = (
        saved.model_dump(by_alias=True) if saved else None
    )
    client = Mock()
    client.collection.return_value.document.return_value = reference
    monkeypatch.setattr(profiles.firestore, "transactional", lambda function: function)
    store = FirestoreProfileStore(Settings(_env_file=None))
    monkeypatch.setattr(store, "_get_client", lambda: client)
    return store, client, reference, client.transaction.return_value


def test_firestore_adapter_uses_default_database_and_shared_backend_app(monkeypatch):
    sentinel = object()
    fake_client = object()
    calls = []
    monkeypatch.setattr(profiles, "get_firebase_app", lambda settings: sentinel)
    monkeypatch.setattr(
        profiles.firestore,
        "client",
        lambda **kwargs: calls.append(kwargs) or fake_client,
    )
    store = FirestoreProfileStore(Settings(_env_file=None))
    assert store._get_client() is fake_client
    assert store._get_client() is fake_client
    assert calls == [{"app": sentinel, "database_id": "(default)"}]


def test_firestore_adapter_creates_atomically_after_checking_revision(monkeypatch):
    store, client, reference, transaction = transaction_fixture(monkeypatch)
    result = store.save("user-a", ProfileUpdate.model_validate(payload()))
    client.collection.assert_called_once_with("profiles")
    client.collection.return_value.document.assert_called_once_with(
        profile_document_id("user-a")
    )
    client.transaction.assert_called_once_with(max_attempts=3)
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    assert result.revision == 1
    transaction.create.assert_called_once_with(
        reference, result.model_dump(by_alias=True)
    )
    transaction.set.assert_not_called()


def test_firestore_adapter_updates_without_changing_creation_time(monkeypatch):
    previous = record()
    store, _, reference, transaction = transaction_fixture(monkeypatch, previous)
    result = store.save(
        "user-a", ProfileUpdate.model_validate(payload(expectedRevision=1))
    )
    assert result.created_at == previous.created_at
    assert result.updated_at >= result.created_at
    assert result.revision == 2
    transaction.set.assert_called_once_with(reference, result.model_dump(by_alias=True))
    transaction.create.assert_not_called()


def test_firestore_adapter_does_not_write_on_conflict_or_corrupt_owner(monkeypatch):
    store, _, _, transaction = transaction_fixture(monkeypatch, record())
    with pytest.raises(ProfileConflict):
        store.save("user-a", ProfileUpdate.model_validate(payload()))
    transaction.set.assert_not_called()
    transaction.create.assert_not_called()
    store, _, _, transaction = transaction_fixture(monkeypatch, record("user-b"))
    with pytest.raises(ProfileUnavailable):
        store.save("user-a", ProfileUpdate.model_validate(payload()))
    transaction.set.assert_not_called()
    transaction.create.assert_not_called()
