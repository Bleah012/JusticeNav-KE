"""Audit projection, authorization, bounded pagination and SDK query contracts."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import FailedPrecondition, PermissionDenied
from test_pathway_management import Verifier

from app import audit_logs as audit
from app.config import Settings
from app.main import create_app

BASE = "/api/v1/admin/audit-logs"
ADMIN = {"Authorization": "Bearer admin"}
STAMP = datetime(2026, 11, 19, 9, 0, 0, 123456, UTC)


def snapshot(kind="resource", number=1, stamp=STAMP, action="update", **extra):
    raw = {
        "action": f"{kind}.{action}",
        "actorUid": "test-administrator",
        f"{kind}Id": "development-item",
        "revision": number + 1,
        "occurredAt": stamp,
        **extra,
    }
    return SimpleNamespace(id=f"{number:032x}", to_dict=lambda: raw)


class MemoryAudit:
    def __init__(self, rows=None):
        self.rows = rows or {kind: [] for kind in audit.COLLECTIONS}
        self.calls = []

    def fetch(self, kind, filters, position, limit):
        self.calls.append((kind, filters, position, limit))
        rows = sorted(
            self.rows.get(kind, []),
            key=lambda row: (row.to_dict()["occurredAt"], row.id),
            reverse=True,
        )
        return [
            row
            for row in rows
            if (
                not position
                or (row.to_dict()["occurredAt"], row.id) < (position.time, position.id)
            )
            and (
                not filters.from_date
                or row.to_dict()["occurredAt"].astimezone(audit.KENYA).date()
                >= filters.from_date
            )
            and (
                not filters.to_date
                or row.to_dict()["occurredAt"].astimezone(audit.KENYA).date()
                <= filters.to_date
            )
        ][:limit]


def api(repository):
    return TestClient(
        create_app(
            Settings(_env_file=None), verifier=Verifier(), audit_repository=repository
        )
    )


@pytest.mark.parametrize(
    "role,status", [(None, 401), ("invalid", 401), ("seeker", 403), ("provider", 403)]
)
def test_authorization_before_reads_even_for_bad_cursor(role, status):
    repository = Mock()
    with api(repository) as client:
        response = client.get(
            BASE,
            params={"cursor": "invalid"},
            headers={"Authorization": f"Bearer {role}"} if role else {},
        )
    assert response.status_code == status
    repository.fetch.assert_not_called()


def test_projection_only_successful_metadata_no_writes_or_sensitive_fields():
    repository = MemoryAudit(
        {
            kind: [
                snapshot(
                    kind,
                    index + 1,
                    description="PRIVATE",
                    contact="PRIVATE",
                    reviewNote="PRIVATE",
                    token="PRIVATE",
                )
            ]
            for index, kind in enumerate(audit.COLLECTIONS)
        }
    )
    with api(repository) as client:
        first = client.get(BASE, headers=ADMIN)
        again = client.get(BASE, headers=ADMIN)
    assert first.status_code == 200 and first.json() == again.json()
    assert first.headers["cache-control"] == "no-store"
    body = first.json()
    assert body["uid"] == "test-administrator" and body["readOnly"] is True
    assert "PRIVATE" not in first.text and body["nextCursor"] is None
    assert len(body["events"]) == 3
    for row in body["events"]:
        assert set(row) == {
            "id",
            "occurredAt",
            "actorReference",
            "action",
            "targetKind",
            "targetReference",
            "revision",
            "outcome",
        }
        assert row["outcome"] == "succeeded" and row["occurredAt"].endswith("123456Z")
    assert len(repository.calls) == 6


def test_interleaved_same_microsecond_and_colliding_ids_paginate_without_loss():
    rows = {
        kind: [
            snapshot(kind, number, STAMP - timedelta(microseconds=number % 5))
            for number in range(1, 71)
        ]
        for kind in audit.COLLECTIONS
    }
    repository, found, cursors = MemoryAudit(rows), [], set()
    with api(repository) as client:
        cursor = None
        while True:
            response = client.get(
                BASE, headers=ADMIN, params={"cursor": cursor} if cursor else {}
            )
            assert response.status_code == 200, response.text
            page = response.json()
            assert len(page["events"]) <= 25
            found.extend(row["id"] for row in page["events"])
            cursor = page["nextCursor"]
            if cursor is None:
                break
            assert cursor not in cursors
            cursors.add(cursor)
    expected = sorted(
        [
            (row.to_dict()["occurredAt"], kind, row.id)
            for kind, group in rows.items()
            for row in group
        ],
        reverse=True,
    )
    assert found == [f"{kind}:{identifier}" for _, kind, identifier in expected]
    assert len(set(found)) == 210
    assert all(call[3] == 151 for call in repository.calls)


def test_newer_events_between_pages_do_not_duplicate_consumed_rows():
    repository = MemoryAudit(
        {
            "service": [
                snapshot("service", number, STAMP - timedelta(seconds=number))
                for number in range(1, 36)
            ]
        }
    )
    with api(repository) as client:
        first = client.get(BASE, headers=ADMIN).json()
        repository.rows["service"].append(snapshot("service", 99, STAMP))
        second = client.get(
            BASE, headers=ADMIN, params={"cursor": first["nextCursor"]}
        ).json()
        newest = client.get(BASE, headers=ADMIN).json()
    assert len(second["events"]) == 10
    assert not set(row["id"] for row in first["events"]) & set(
        row["id"] for row in second["events"]
    )
    assert newest["events"][0]["id"].endswith(f"{99:032x}")


def test_sparse_filter_makes_progress_with_empty_page_then_finds_match():
    repository = MemoryAudit(
        {
            "resource": [
                snapshot(
                    "resource",
                    n,
                    STAMP - timedelta(seconds=n),
                    action="delete" if n == 170 else "update",
                )
                for n in range(1, 181)
            ]
        }
    )
    with api(repository) as client:
        first = client.get(
            BASE,
            headers=ADMIN,
            params={"kind": "resource", "action": "delete", "query": "DEVELOPMENT"},
        ).json()
        assert first["events"] == [] and first["nextCursor"]
        second = client.get(
            BASE,
            headers=ADMIN,
            params={
                "kind": "resource",
                "action": "delete",
                "query": "development",
                "cursor": first["nextCursor"],
            },
        ).json()
    assert len(second["events"]) == 1 and second["events"][0]["revision"] == 171
    assert second["nextCursor"] is None and len(repository.calls) == 2


@pytest.mark.parametrize(
    "query", ["test-administrator", "development-item", "resource:"]
)
def test_reference_search_and_kind_filter(query):
    repository = MemoryAudit({kind: [snapshot(kind)] for kind in audit.COLLECTIONS})
    with api(repository) as client:
        result = client.get(
            BASE, headers=ADMIN, params={"kind": "resource", "query": query}
        ).json()
    assert len(result["events"]) == 1 and repository.calls[0][0] == "resource"
    assert len(repository.calls) == 1


def test_kenya_inclusive_dates_cross_utc_midnight():
    repository = MemoryAudit(
        {
            "resource": [
                snapshot("resource", index, datetime.fromisoformat(stamp))
                for index, stamp in enumerate(
                    [
                        "2026-11-18T20:59:59.999999+00:00",
                        "2026-11-18T21:00:00+00:00",
                        "2026-11-19T20:59:59.999999+00:00",
                        "2026-11-19T21:00:00+00:00",
                    ],
                    1,
                )
            ]
        }
    )
    with api(repository) as client:
        result = client.get(
            BASE,
            headers=ADMIN,
            params={"from_date": "2026-11-19", "to_date": "2026-11-19"},
        ).json()
    assert [row["revision"] for row in result["events"]] == [4, 3]


@pytest.mark.parametrize(
    "params",
    [
        {"kind": "users"},
        {"action": "access-denied"},
        {"query": "SECRET" * 41},
        {"query": "PRIVATE\x00"},
        {"from_date": "2026-02-30"},
        {"from_date": "2026-11-20", "to_date": "2026-11-19"},
        {"to_date": "9999-12-31"},
        {"cursor": "PRIVATE://bad"},
        {"cursor": "A" * 2049},
    ],
)
def test_invalid_filters_redacted_before_storage(params):
    repository = Mock()
    with api(repository) as client:
        result = client.get(BASE, headers=ADMIN, params=params)
    assert (
        result.status_code == 422
        and "SECRET" not in result.text
        and "PRIVATE" not in result.text
    )
    repository.fetch.assert_not_called()


def test_cursor_bound_to_filters_and_rejects_malformed_positions():
    filters = audit.AuditFilters()
    cursor = audit.encode_cursor(
        filters,
        {
            "service": audit.Position(time=STAMP, id="a" * 32),
            "pathway": None,
            "resource": None,
        },
    )
    assert audit.decode_cursor(cursor, filters)["service"].time == STAMP
    with api(Mock()) as client:
        assert (
            client.get(
                BASE, headers=ADMIN, params={"cursor": cursor, "kind": "service"}
            ).status_code
            == 422
        )
    for positions in [
        {},
        {"service": False, "resource": None, "pathway": None},
        {"service": {"time": "bad", "id": "a" * 32}, "resource": None, "pathway": None},
    ]:
        import base64
        import json

        broken = (
            base64.urlsafe_b64encode(
                json.dumps(
                    {"v": 1, "filter": filters.fingerprint(), "positions": positions}
                ).encode()
            )
            .decode()
            .rstrip("=")
        )
        with pytest.raises(Exception) as error:
            audit.decode_cursor(broken, filters)
        assert error.value.status_code == 422


@pytest.mark.parametrize(
    "change",
    [
        {"action": "service.update"},
        {"actorUid": ""},
        {"actorUid": "PRIVATE\x00"},
        {"revision": True},
        {"revision": 0},
        {"occurredAt": "2026-11-19"},
        {"resourceId": "../PRIVATE"},
    ],
)
def test_corrupt_metadata_fails_closed(change):
    repository = MemoryAudit({"resource": [snapshot(**change)]})
    with api(repository) as client:
        result = client.get(BASE, headers=ADMIN)
    assert result.status_code == 503 and "PRIVATE" not in result.text


@pytest.mark.parametrize(
    "error",
    [
        PermissionDenied("PRIVATE"),
        FailedPrecondition("PRIVATE"),
        audit.AuditUnavailable(),
        ValueError("PRIVATE"),
    ],
)
def test_storage_failure_is_not_empty_or_partial_history(error):
    repository = Mock()
    repository.fetch.side_effect = [[snapshot("service")], error]
    with api(repository) as client:
        result = client.get(BASE, headers=ADMIN)
    assert (
        result.status_code == 503
        and "events" not in result.json()
        and "PRIVATE" not in result.text
    )


def test_no_write_routes_and_empty_history_is_real_empty():
    repository = MemoryAudit()
    with api(repository) as client:
        assert client.get(BASE, headers=ADMIN).json()["events"] == []
        for method in ("PUT", "POST", "DELETE"):
            assert client.request(method, BASE, headers=ADMIN).status_code == 405


def test_firestore_query_uses_three_bounded_single_field_indexes_and_no_writes():
    repository = audit.FirestoreAuditRepository(Settings(_env_file=None))
    client, collection, query = Mock(), Mock(), Mock()
    repository._client = client
    client.collection.return_value = collection
    collection.order_by.return_value = query
    query.order_by.return_value = query
    query.where.return_value = query
    query.start_after.return_value = query
    query.limit.return_value = query
    query.stream.return_value = []
    filters = audit.AuditFilters(fromDate="2026-11-19", toDate="2026-11-19")
    position = audit.Position(time=STAMP, id="a" * 32)
    assert repository.fetch("resource", filters, position, 151) == []
    client.collection.assert_called_once_with("resourceCatalogueAudit")
    collection.order_by.assert_called_once_with("occurredAt", direction="DESCENDING")
    query.order_by.assert_called_once_with("__name__", direction="DESCENDING")
    assert query.where.call_args_list[0].kwargs["filter"].value == datetime(
        2026, 11, 18, 21, tzinfo=UTC
    )
    assert query.where.call_args_list[1].kwargs["filter"].value == datetime(
        2026, 11, 19, 21, tzinfo=UTC
    )
    assert query.start_after.call_args.args[0]["occurredAt"] == STAMP
    collection.document.assert_called_once_with("a" * 32)
    query.limit.assert_called_once_with(151)
    query.stream.assert_called_once_with(retry=None, timeout=10)
    client.transaction.assert_not_called()


def test_emulator_cannot_bypass_live_credentials(monkeypatch):
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "localhost:9999")
    with pytest.raises(audit.AuditUnavailable):
        audit.FirestoreAuditRepository(Settings(_env_file=None)).client()


def test_actual_sdk_encodes_timestamp_date_bounds_and_document_cursor(monkeypatch):
    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1 import Client
    from google.cloud.firestore_v1.query import Query

    captured = []

    def stream(query, **options):
        captured.append(query._to_protobuf())
        return iter([])

    monkeypatch.setattr(Query, "stream", stream)
    repository = audit.FirestoreAuditRepository(Settings(_env_file=None))
    repository._client = Client(
        project="audit-test", credentials=AnonymousCredentials()
    )
    filters = audit.AuditFilters(fromDate="2026-11-19", toDate="2026-11-19")
    repository.fetch("service", filters, audit.Position(time=STAMP, id="a" * 32), 151)
    query = captured[0]
    assert query.limit == 151
    assert [order.field.field_path for order in query.order_by] == [
        "occurredAt",
        "__name__",
    ]
    assert query.start_at.before is False
    assert query.start_at.values[0].timestamp_value == STAMP
    assert query.start_at.values[1].reference_value.endswith(
        "serviceCatalogueAudit/" + "a" * 32
    )
