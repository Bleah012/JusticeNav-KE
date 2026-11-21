"""Complete dashboard totals, membership isolation and truthful failure states."""

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from test_admin_users import account
from test_demo_referrals import SERVICE, MemoryStore, Verifier, source
from test_demo_referrals import account as auth_headers

from app import demo_referrals as demo
from app.admin_users import AccountsUnavailable, account_view
from app.catalog import CatalogStore
from app.config import Settings
from app.main import create_app
from app.pathways import PathwayStore
from app.workspace_dashboard import account_counts

ADMIN = auth_headers("admin", "admin-one")
PROVIDER = auth_headers("provider", "provider-one")


class Directory:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def list(self, cursor):
        self.calls.append(cursor)
        offset = int(cursor) if cursor else 0
        return self.rows[offset : offset + 50], str(offset + 50) if len(
            self.rows
        ) > offset + 50 else None


def row(number, role="seeker", disabled=False):
    return account_view(
        account(str(number), disabled=disabled, custom_claims={"role": role})
    )


def handoffs():
    store = MemoryStore()
    for number in range(26):
        record = demo.start_handoff(
            source(ref=f"{number:032x}"), "seeker-one", f"{number:032x}"
        )
        record = demo.advance(
            record, 1, "assigned", demo.scoped_key("provider-one", SERVICE)
        )
        if number < 3:
            record = demo.advance(record, 2, "under-review", record.provider_key)
            record = demo.advance(record, 3, "completed", record.provider_key)
        elif number < 5:
            record = demo.advance(record, 2, "under-review", record.provider_key)
        store.rows[record.id] = record
    return store


def client(directory=None, store=None, environment="test"):
    return TestClient(
        create_app(
            Settings(_env_file=None, app_env=environment),
            verifier=Verifier(),
            catalog_store=CatalogStore(),
            pathway_store=PathwayStore(),
            account_directory=directory if directory is not None else Directory([]),
            demo_referral_store=store if store is not None else MemoryStore(),
            demo_provider_directory=Mock(service_for=Mock(return_value=SERVICE)),
        )
    )


def test_account_totals_scan_every_page_and_keep_status_separate_from_role():
    directory = Directory(
        [row(n) for n in range(51)]
        + [row(52, "provider"), row(53, "admin", True), row(54, "unsupported")]
    )
    result = account_counts(directory)
    assert result.total == 54 and result.active == 53 and result.disabled == 1
    assert (
        result.seeker == 51
        and result.provider == result.admin == result.unsupported == 1
    )
    assert directory.calls == [None, "50"]


@pytest.mark.parametrize("problem", ["duplicate", "cursor", "too-many"])
def test_account_scan_never_publishes_a_partial_or_repeated_total(problem):
    directory = Mock()
    directory.list.return_value = (
        ([row(1)], "again")
        if problem == "cursor"
        else ([row(1), row(1)], None)
        if problem == "duplicate"
        else ([row(n) for n in range(51)], None)
    )
    with pytest.raises(AccountsUnavailable):
        account_counts(directory)


def test_admin_dashboard_has_real_catalogue_account_and_all_demonstration_counts():
    directory, store = Directory([row(n) for n in range(53)]), handoffs()
    with client(directory, store) as api:
        response = api.get("/api/v1/admin/dashboard", headers=ADMIN)
    assert (
        response.status_code == 200 and response.headers["cache-control"] == "no-store"
    )
    data = response.json()
    assert data["uid"] == "admin-one" and data["accounts"]["total"] == 53
    assert data["services"] == len(CatalogStore().load().services)
    assert data["demonstrations"] == {
        "shared": 0,
        "assigned": 21,
        "underReview": 2,
        "completed": 3,
        "withdrawn": 0,
    }
    assert "PRIVATE" not in response.text and "email" not in response.text


def test_provider_totals_cover_all_pages_and_exclude_other_memberships_and_withdrawal():
    store = handoffs()
    foreign = demo.start_handoff(source(ref="f" * 32), "seeker-one", "f" * 32)
    foreign = demo.advance(
        foreign, 1, "assigned", demo.scoped_key("other-provider", SERVICE)
    )
    store.rows[foreign.id] = foreign
    with client(store=store) as api:
        first = api.get("/api/v1/demo-referrals/provider", headers=PROVIDER).json()
        assert len(first["referrals"]) == 20 and first["nextCursor"] is not None
        result = api.get(
            "/api/v1/demo-referrals/provider/summary", headers=PROVIDER
        ).json()
        assert result["counts"] == {
            "shared": 0,
            "assigned": 21,
            "underReview": 2,
            "completed": 3,
            "withdrawn": 0,
        }
        key = next(
            key
            for key, value in store.rows.items()
            if value.provider_key == demo.scoped_key("provider-one", SERVICE)
        )
        record = store.rows[key]
        store.rows[key] = demo.advance(record, record.revision, "withdrawn", None)
        updated = api.get(
            "/api/v1/demo-referrals/provider/summary", headers=PROVIDER
        ).json()
        assert sum(updated["counts"].values()) == 25


@pytest.mark.parametrize(
    "path,role",
    [
        ("/api/v1/admin/dashboard", "seeker"),
        ("/api/v1/admin/dashboard", "provider"),
        ("/api/v1/demo-referrals/provider/summary", "seeker"),
        ("/api/v1/demo-referrals/provider/summary", "admin"),
    ],
)
def test_other_roles_cannot_load_dashboard_statistics(path, role):
    directory, store = Mock(), Mock()
    with client(directory, store) as api:
        assert api.get(path, headers=auth_headers(role, "someone")).status_code == 403
    directory.list.assert_not_called()
    store.summary.assert_not_called()


def test_failed_counts_are_not_zero_and_empty_counts_are_confirmed():
    directory = Mock(list=Mock(side_effect=AccountsUnavailable("PRIVATE")))
    with client(directory) as api:
        result = api.get("/api/v1/admin/dashboard", headers=ADMIN)
        assert result.status_code == 503 and "PRIVATE" not in result.text
    with client() as api:
        data = api.get("/api/v1/admin/dashboard", headers=ADMIN).json()
        assert (
            data["accounts"]["total"] == 0 and sum(data["demonstrations"].values()) == 0
        )


def test_production_does_not_invent_demo_counts():
    with client(environment="production") as api:
        assert (
            api.get("/api/v1/admin/dashboard", headers=ADMIN).json()["demonstrations"]
            is None
        )
        assert (
            api.get(
                "/api/v1/demo-referrals/provider/summary", headers=PROVIDER
            ).status_code
            == 404
        )


def test_firestore_summary_uses_membership_filter_and_rejects_truncation(monkeypatch):
    store = demo.FirestoreDemoReferrals(Settings(_env_file=None))
    collection, query = Mock(), Mock()
    collection.where.return_value = query
    query.limit.return_value.stream.return_value = []
    monkeypatch.setattr(store, "_collection", lambda: collection)
    key = demo.scoped_key("provider-one", SERVICE)
    assert store.summary(key, SERVICE).assigned == 0
    query.limit.assert_called_once_with(1001)
    assert collection.where.call_args.kwargs["filter"].field_path == "providerKey"
    record = next(iter(handoffs().rows.values()))
    with pytest.raises(demo.Unavailable):
        demo.count_demonstrations([record] * 1001)
    with pytest.raises(demo.Unavailable):
        demo.count_demonstrations([record], "0" * 64, SERVICE)


def test_provider_summary_rejects_revoked_membership():
    with client() as api:
        api.app.state.demo_provider_directory.service_for.side_effect = (
            demo.MembershipDenied
        )
        assert (
            api.get(
                "/api/v1/demo-referrals/provider/summary", headers=PROVIDER
            ).status_code
            == 403
        )
