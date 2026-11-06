"""Demonstration consent and cross-role boundaries with no live services."""

from datetime import UTC, datetime
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import Client
from google.cloud.firestore_v1.query import Query
from pydantic import ValidationError

from app import demo_referrals as demo
from app.auth import InvalidToken
from app.config import Settings
from app.main import create_app
from app.referrals import ReferralMissing

BASE = "/api/v1/demo-referrals"
REFERRAL = "a" * 32
KEY = demo.scoped_key("seeker-one", REFERRAL)
SERVICE = "small-claims-courts"


class Verifier:
    def verify(self, token):
        role, _, uid = token.partition(":")
        if not uid:
            raise InvalidToken
        return {"uid": uid, "role": role}


class MemoryStore:
    def __init__(self):
        self.rows = {}
        self.lock = Lock()
        self.writes = 0

    def get(self, key):
        return self.rows.get(key)

    def change(self, key, transition):
        with self.lock:
            updated = transition(self.rows.get(key))
            self.rows[key] = updated
            self.writes += 1
            return updated

    def list(self, field, value, after):
        name = {"status": "status", "providerKey": "provider_key"}[field]
        return [
            self.rows[key]
            for key in sorted(self.rows)
            if (not after or key > after) and getattr(self.rows[key], name) == value
        ][:21]


def source(uid="seeker-one", ref=REFERRAL):
    return SimpleNamespace(
        uid=uid,
        id=ref,
        saved_at=datetime(2026, 1, 1, tzinfo=UTC),
        selection=SimpleNamespace(
            service=SimpleNamespace(id=SERVICE, name="Small Claims Courts"),
            pathway=SimpleNamespace(title="Public pathway"),
        ),
        description="PRIVATE DESCRIPTION",
        email="private@example.test",
        full_name="PRIVATE NAME",
        phone="+254700000000",
    )


def account(role, uid):
    return {"Authorization": f"Bearer {role}:{uid}"}


SEEKER = account("seeker", "seeker-one")
ADMIN = account("admin", "admin-one")
PROVIDER = account("provider", "provider-one")
OTHER = account("provider", "provider-two")


@pytest.fixture
def setup():
    def provider(uid):
        if uid in {"provider-one", "provider-two"}:
            return SERVICE
        if uid == "other-service":
            return "nlas-legal-aid"
        raise demo.MembershipDenied

    def own_source(uid, identifier):
        if uid != "seeker-one" or identifier != REFERRAL:
            raise ReferralMissing
        return source()

    store = MemoryStore()
    membership = Mock(service_for=Mock(side_effect=provider))
    private = Mock(get=Mock(side_effect=own_source))
    api = TestClient(
        create_app(
            Settings(_env_file=None, app_env="test"),
            verifier=Verifier(),
            referral_store=private,
            demo_referral_store=store,
            demo_provider_directory=membership,
        )
    )
    with api:
        yield api, store, private, membership


def share(api, headers=SEEKER, confirmed=True):
    return api.put(
        BASE + f"/mine/{REFERRAL}/share",
        headers=headers,
        json={"confirmed": confirmed, "consentVersion": "demo-metadata-v1"},
    )


def assign(api, uid="provider-one", revision=1, key=KEY):
    return api.put(
        BASE + f"/admin/{key}/assign",
        headers=ADMIN,
        json={"providerUid": uid, "expectedRevision": revision},
    )


def progress(api, status, revision, headers=PROVIDER):
    return api.put(
        BASE + f"/provider/{KEY}/status",
        headers=headers,
        json={"status": status, "expectedRevision": revision},
    )


def withdrawal(api, revision):
    return api.put(
        BASE + f"/mine/{REFERRAL}/withdraw",
        headers=SEEKER,
        json={"expectedRevision": revision},
    )


def test_complete_lifecycle_preserves_private_source_and_projects_only_metadata(setup):
    api, store, private, _ = setup
    before = api.get(BASE + f"/mine/{REFERRAL}", headers=SEEKER)
    assert before.status_code == 200 and before.json()["referral"] is None
    assert not private.get.called and store.writes == 0
    assert api.get(BASE + "/admin", headers=ADMIN).json()["referrals"] == []
    assert share(api).status_code == 200
    queued = api.get(BASE + "/admin", headers=ADMIN)
    assert queued.headers["cache-control"] == "no-store"
    assert queued.json()["referrals"][0]["status"] == "shared"
    assert api.get(BASE + "/provider", headers=PROVIDER).json()["referrals"] == []
    assert assign(api).status_code == 200
    assert api.get(BASE + "/admin", headers=ADMIN).json()["referrals"] == []
    assigned = api.get(BASE + "/provider", headers=PROVIDER)
    assert assigned.json()["referrals"][0]["status"] == "assigned"
    assert api.get(BASE + "/provider", headers=OTHER).json()["referrals"] == []
    assert progress(api, "under-review", 2).status_code == 200
    assert progress(api, "completed", 3).status_code == 200
    owner = api.get(BASE + f"/mine/{REFERRAL}", headers=SEEKER).json()
    assert owner["referralId"] == REFERRAL
    assert [row["status"] for row in owner["referral"]["history"]] == [
        "shared",
        "assigned",
        "under-review",
        "completed",
    ]
    assert set(assigned.json()["referrals"][0]) == {
        "id",
        "serviceId",
        "serviceName",
        "pathwayTitle",
        "status",
        "revision",
        "history",
    }
    for payload in (
        queued.text,
        assigned.text,
        str(owner),
        str(store.rows[KEY].model_dump()),
    ):
        assert "PRIVATE" not in payload and "private@example.test" not in payload
    assert store.writes == 4
    private.get.assert_called_once_with("seeker-one", REFERRAL)
    assert not private.create.called


def test_no_consent_wrong_role_foreign_source_and_duplicate_share_are_denied(setup):
    api, store, private, _ = setup
    assert assign(api).status_code == 404
    assert share(api, confirmed=False).status_code == 422
    assert share(api, confirmed=1).status_code == 422
    assert share(api, headers=ADMIN).status_code == 403
    assert not private.get.called and store.writes == 0
    assert share(api, headers=account("seeker", "other-owner")).status_code == 404
    assert share(api).status_code == 200
    assert share(api).status_code == 409
    assert store.writes == 1


def test_wrong_service_inactive_and_other_provider_cannot_assign_or_update(setup):
    api, store, _, _ = setup
    assert share(api).status_code == 200
    assert assign(api, "inactive").status_code == 403
    assert assign(api, "other-service").status_code == 403
    assert assign(api).status_code == 200
    assert progress(api, "under-review", 2, OTHER).status_code == 404
    assert progress(api, "under-review", 2, ADMIN).status_code == 403
    assert progress(api, "completed", 2).status_code == 409
    assert assign(api, "provider-two", 2).status_code == 409
    assert store.writes == 2


def test_withdrawal_removes_provider_scope_and_keeps_owner_history(setup):
    api, store, _, _ = setup
    assert share(api).status_code == 200
    assert assign(api).status_code == 200
    assert progress(api, "under-review", 2).status_code == 200
    assert withdrawal(api, 2).status_code == 409
    result = withdrawal(api, 3)
    assert (
        result.status_code == 200 and result.json()["referral"]["status"] == "withdrawn"
    )
    assert store.rows[KEY].provider_key is None
    assert api.get(BASE + "/provider", headers=PROVIDER).json()["referrals"] == []
    assert progress(api, "completed", 3).status_code == 404
    assert api.get(BASE + "/admin", headers=ADMIN).json()["referrals"] == []
    assert share(api).status_code == 409
    assert store.writes == 4


def test_current_provider_membership_is_rechecked_on_every_read_and_write(setup):
    api, store, _, membership = setup
    assert share(api).status_code == 200 and assign(api).status_code == 200
    membership.service_for.side_effect = demo.MembershipDenied
    assert api.get(BASE + "/provider", headers=PROVIDER).status_code == 403
    assert progress(api, "under-review", 2).status_code == 403
    membership.service_for.side_effect = None
    membership.service_for.return_value = "nlas-legal-aid"
    assert api.get(BASE + "/provider", headers=PROVIDER).json()["referrals"] == []
    assert progress(api, "under-review", 2).status_code == 404
    assert store.writes == 2


def test_corrupt_or_foreign_list_rows_are_never_returned(setup, monkeypatch):
    api, store, _, _ = setup
    assert share(api).status_code == 200 and assign(api).status_code == 200
    monkeypatch.setattr(store, "list", lambda *_: [store.rows[KEY]])
    for path, headers in [("/admin", ADMIN), ("/provider", OTHER)]:
        result = api.get(BASE + path, headers=headers)
        assert result.status_code == 503 and KEY not in result.text


def test_pagination_stays_scoped_and_bounded(setup):
    api, store, _, _ = setup
    for index in range(25):
        referral = f"{index:032x}"
        row = demo.start_handoff(source(ref=referral), "seeker-one", referral)
        store.rows[row.id] = row
    first = api.get(BASE + "/admin", headers=ADMIN).json()
    second = api.get(
        BASE + "/admin", headers=ADMIN, params={"after": first["nextCursor"]}
    ).json()
    keys = [row["id"] for page in [first, second] for row in page["referrals"]]
    assert len(first["referrals"]) == 20 and second["nextCursor"] is None
    assert keys == sorted(store.rows) and store.writes == 0


def test_authorization_precedes_private_or_membership_reads(setup):
    api, store, private, membership = setup
    assert api.get(BASE + "/admin").status_code == 401
    assert api.get(BASE + "/admin", headers=SEEKER).status_code == 403
    assert api.get(BASE + "/provider", headers=ADMIN).status_code == 403
    assert api.get(BASE + f"/mine/{REFERRAL}", headers=PROVIDER).status_code == 403
    assert (
        not private.get.called
        and not membership.service_for.called
        and store.writes == 0
    )


def test_production_rejects_demonstration_operations():
    store = Mock()
    with TestClient(
        create_app(
            Settings(_env_file=None, app_env="production"),
            verifier=Verifier(),
            demo_referral_store=store,
        )
    ) as api:
        assert api.get(BASE + "/admin", headers=ADMIN).status_code == 404
        assert share(api).status_code == 404
    assert not store.mock_calls


def test_invalid_input_does_not_echo_sensitive_values(setup):
    api, store, _, _ = setup
    result = api.put(
        BASE + f"/mine/{REFERRAL}/share",
        headers=SEEKER,
        json={
            "confirmed": True,
            "consentVersion": "demo-metadata-v1",
            "description": "PRIVATE",
        },
    )
    assert (
        result.status_code == 422 and "PRIVATE" not in result.text and store.writes == 0
    )


def test_invalid_history_and_assignment_scope_are_rejected():
    row = demo.start_handoff(source(), "seeker-one", REFERRAL)
    for changes in [
        {"provider_key": "b" * 64},
        {"revision": 2},
        {"owner_uid": "another"},
        {"status": "completed"},
    ]:
        with pytest.raises(ValidationError):
            demo.StoredHandoff.model_validate({**row.model_dump(), **changes})


def test_firestore_query_uses_scoped_index_and_exclusive_document_cursor(monkeypatch):
    client = Client(project="unit-demo-referrals", credentials=AnonymousCredentials())
    store = demo.FirestoreDemoReferrals(Settings(_env_file=None))
    store._client = client
    anchor = "a" * 64
    provider_key = demo.scoped_key("provider-one", SERVICE)

    def stream(query, **options):
        proto = query._to_protobuf()
        assert proto.limit == 21
        assert proto.where.field_filter.field.field_path == "providerKey"
        assert proto.where.field_filter.value.string_value == provider_key
        assert proto.order_by[0].field.field_path == "__name__"
        assert proto.order_by[0].direction == 1
        assert not proto.start_at.before
        assert proto.start_at.values[0].reference_value.endswith("/" + anchor)
        assert options == {"retry": None, "timeout": 5}
        return iter([])

    monkeypatch.setattr(Query, "stream", stream)
    assert store.list("providerKey", provider_key, anchor) == []


def test_firestore_transaction_rejects_stale_revision_before_write(monkeypatch):
    row = demo.start_handoff(source(), "seeker-one", REFERRAL)
    reference = Mock(
        get=Mock(
            return_value=Mock(
                exists=True,
                id=row.id,
                to_dict=Mock(return_value=row.model_dump(by_alias=True)),
            )
        )
    )
    transaction = Mock()
    store = demo.FirestoreDemoReferrals(Settings(_env_file=None))
    store._client = Mock(transaction=Mock(return_value=transaction))
    monkeypatch.setattr(
        store, "_collection", lambda: Mock(document=Mock(return_value=reference))
    )
    monkeypatch.setattr(demo.firestore, "transactional", lambda fn: fn)
    with pytest.raises(demo.Conflict):
        store.change(row.id, lambda old: demo.advance(old, 2, "withdrawn"))
    assert not transaction.set.called and not transaction.create.called
    store.change(row.id, lambda old: demo.advance(old, 1, "withdrawn"))
    assert transaction.set.call_count == 1
    updated = transaction.set.call_args.args[1]
    assert updated["status"] == "withdrawn" and updated["providerKey"] is None
    assert reference.get.call_args.kwargs["transaction"] is transaction


@pytest.mark.parametrize(
    "changes",
    [
        {"disabled": True},
        {"uid": "wrong"},
        {"custom_claims": {"role": "provider"}},
        {"custom_claims": {"role": "seeker", "demoServiceId": SERVICE}},
    ],
)
def test_firebase_membership_requires_current_active_user_role_and_service(
    monkeypatch, changes
):
    user = {
        "disabled": False,
        "uid": "provider-one",
        "custom_claims": {"role": "provider", "demoServiceId": SERVICE},
    }
    monkeypatch.setattr(demo, "get_firebase_app", lambda _: "test-app")
    get = Mock(return_value=SimpleNamespace(**{**user, **changes}))
    monkeypatch.setattr(demo.auth, "get_user", get)
    directory = demo.FirebaseProviderDirectory(Settings(_env_file=None))
    with pytest.raises(demo.MembershipDenied):
        directory.service_for("provider-one")
    get.return_value = SimpleNamespace(**user)
    assert directory.service_for("provider-one") == SERVICE
