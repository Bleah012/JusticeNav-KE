"""Own-account summaries, exact counts and metadata privacy; no live Firebase."""

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import Client, DocumentSnapshot
from google.cloud.firestore_v1.aggregation import AggregationQuery
from google.cloud.firestore_v1.base_aggregation import AggregationResult
from google.cloud.firestore_v1.query import Query

from app import dashboard
from app.assessments import Answers, AssessmentRecord
from app.auth import InvalidToken, VerificationUnavailable
from app.catalog import CatalogStore
from app.checklists import ChecklistRecord, make_template
from app.config import Settings
from app.dashboard import (
    DashboardSnapshot,
    DashboardUnavailable,
    FirestoreDashboardStore,
    compose,
)
from app.main import create_app
from app.pathways import PathwayStore
from app.referrals import ReferralRecord, ReferralSelection, selection_hash

STAMP = datetime(2026, 1, 1, tzinfo=UTC)
ID, URL = "a" * 32, "/api/v1/dashboard"


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        if token == "unavailable":
            raise VerificationUnavailable
        return {"uid": token}


def headers(uid="owner"):
    return {"Authorization": "Bearer " + uid}


def client(store):
    return TestClient(
        create_app(Settings(_env_file=None), verifier=Verifier(), dashboard_store=store)
    )


def records(uid="owner"):
    assessment = AssessmentRecord(
        id=ID,
        uid=uid,
        description="PRIVATE description",
        answers=Answers(),
        status="draft",
        revision=1,
        createdAt=STAMP,
        updatedAt=STAMP,
    )
    pathway = PathwayStore().load().pathways[0]
    template = make_template(pathway)
    checklist = ChecklistRecord(
        **template.model_dump(by_alias=True),
        id="b" * 32,
        uid=uid,
        checkedIds=[template.items[0].id],
        status="in-progress",
        revision=1,
        createdAt=STAMP,
        updatedAt=STAMP + timedelta(seconds=1),
    )
    service = next(
        item for item in CatalogStore().load().services if item.id == pathway.service_id
    )
    source = {
        "pathway": {"id": pathway.id, "title": pathway.title},
        "service": {"id": service.id, "name": service.name},
        "sourceReview": pathway.source_review.model_dump(by_alias=True, mode="json"),
    }
    selection = ReferralSelection.model_validate(
        {**source, "selectionVersion": selection_hash(source)}
    )
    referral = ReferralRecord(
        id="c" * 32,
        uid=uid,
        selection=selection,
        fullName="PRIVATE name",
        email="private@example.test",
        phone=None,
        contactMethod="email",
        description="PRIVATE referral",
        scope="school-demonstration",
        status="saved",
        deliveryStatus="not-sent",
        revision=1,
        acknowledgementVersion="project-request-v1",
        savedAt=STAMP + timedelta(seconds=2),
        updatedAt=STAMP + timedelta(seconds=2),
        acknowledgedAt=STAMP + timedelta(seconds=2),
    )
    return assessment, checklist, referral


def snapshot(uid="owner", count=1):
    a, c, r = records(uid)
    return compose(uid, (count, [a]), (count, [c]), (count, [r]))


@pytest.mark.parametrize(
    "token,status", [(None, 401), ("invalid", 401), ("unavailable", 503)]
)
def test_authentication_precedes_any_summary_read(token, status):
    store = Mock()
    with client(store) as api:
        result = api.get(URL, headers=headers(token) if token else {})
    assert result.status_code == status and not store.get.called


def test_route_uses_verified_owner_and_returns_metadata_only():
    store = Mock()
    store.get.return_value = snapshot()
    with client(store) as api:
        result = api.get(URL + "?uid=foreign&role=admin", headers=headers())
        assert (
            result.status_code == 200 and result.headers["cache-control"] == "no-store"
        )
        data = result.json()
        assert data["uid"] == "owner" and data["counts"] == {
            "assessments": 1,
            "checklists": 1,
            "referrals": 1,
        }
        assert (
            data["latestReferral"]["status"] == "saved"
            and data["latestReferral"]["deliveryStatus"] == "not-sent"
        )
        assert data["latestChecklist"]["completedItems"] == 1
        assert (
            "PRIVATE" not in result.text and "private@example.test" not in result.text
        )
        assert (
            "description" not in result.text
            and "fullName" not in result.text
            and "answers" not in result.text
        )
        store.get.assert_called_once_with("owner")
        assert api.put(URL, headers=headers(), json={"counts": 99}).status_code == 405
        assert api.post(URL, headers=headers(), json={}).status_code == 405
        assert api.delete(URL, headers=headers()).status_code == 405


def test_no_records_is_successful_zero_and_not_missing_storage():
    store = Mock()
    store.get.return_value = compose("owner", (0, []), (0, []), (0, []))
    with client(store) as api:
        data = api.get(URL, headers=headers()).json()
    assert data["counts"] == {"assessments": 0, "checklists": 0, "referrals": 0}
    assert (
        data["activity"] == []
        and data["latestChecklist"] is None
        and data["latestReferral"] is None
    )


@pytest.mark.parametrize(
    "cause", [DashboardUnavailable("PRIVATE internal"), ValueError("PRIVATE invalid")]
)
def test_failures_do_not_return_fake_zero_or_raw_error(cause):
    store = Mock()
    store.get.side_effect = cause
    with client(store) as api:
        result = api.get(URL, headers=headers())
    assert (
        result.status_code == 503
        and "PRIVATE" not in result.text
        and "counts" not in result.text
    )


def test_foreign_snapshot_is_not_published():
    store = Mock()
    store.get.return_value = snapshot("foreign")
    with client(store) as api:
        result = api.get(URL, headers=headers())
    assert result.status_code == 503 and "foreign" not in result.text


def test_totals_exceed_list_page_sizes_and_recent_saves_are_bounded_sorted():
    a, c, r = records()
    assessments = [
        a.model_copy(
            update={"id": f"{i:032x}", "updated_at": STAMP + timedelta(seconds=30 + i)}
        )
        for i in range(6)
    ]
    checklists = [
        c.model_copy(
            update={
                "id": f"{i + 10:032x}",
                "updated_at": STAMP + timedelta(seconds=40 + i),
            }
        )
        for i in range(6)
    ]
    result = compose("owner", (101, assessments), (100, checklists), (75, [r]))
    assert (
        result.counts.assessments == 101
        and result.counts.checklists == 100
        and result.counts.referrals == 75
    )
    assert len(result.activity) == 6 and all(
        item.kind == "checklist" for item in result.activity
    )
    assert (
        result.latest_checklist.id == checklists[-1].id
        and result.latest_referral.id == r.id
    )
    assert result.activity[0].occurred_at > result.activity[-1].occurred_at


def test_latest_record_ties_are_deterministic():
    a, c, r = records()
    other = c.model_copy(update={"id": "f" * 32})
    result = compose("owner", (1, [a]), (2, [c, other]), (1, [r]))
    assert result.latest_checklist.id == other.id
    assert [item.id for item in result.activity if item.kind == "checklist"] == [
        other.id,
        c.id,
    ]


@pytest.mark.parametrize(
    "count,rows",
    [(True, []), (-1, []), (1.5, []), (0, ["a"]), (1, []), (9007199254740992, [])],
)
def test_malformed_or_partial_counts_fail_closed(count, rows):
    a, _, _ = records()
    with pytest.raises(DashboardUnavailable):
        compose("owner", (count, [a] if rows else []), (0, []), (0, []))


def test_duplicate_and_foreign_recent_rows_fail_closed():
    a, _, _ = records()
    for rows in [[a, a], [a.model_copy(update={"uid": "foreign"})]]:
        with pytest.raises(DashboardUnavailable):
            compose("owner", (2, rows), (0, []), (0, []))


@pytest.mark.parametrize(
    "change",
    [
        {"latestReferral": None},
        {"latestChecklist": None},
        {"activity": []},
        {"counts": {"assessments": -1, "referrals": 1, "checklists": 1}},
    ],
)
def test_snapshot_schema_rejects_contradictory_payloads(change):
    data = snapshot().model_dump(by_alias=True)
    with pytest.raises(ValueError):
        DashboardSnapshot.model_validate({**data, **change})


def test_real_sdk_queries_are_owner_scoped_read_only_and_bounded(monkeypatch):
    uid = "owner/with/slashes"
    a, c, r = records(uid)
    connection = Client(project="unit-dashboard", credentials=AnonymousCredentials())
    store = FirestoreDashboardStore(Settings(_env_file=None))
    store._client = connection
    counts, queries = [], []
    domain = {"assessments": a, "checklists": c, "referrals": r}
    parents = {
        "assessments": "assessmentOwners",
        "checklists": "checklistOwners",
        "referrals": "referralOwners",
    }

    def count_get(query, **kwargs):
        nested = query._nested_query
        assert nested._limit is None
        assert kwargs == {"retry": None, "timeout": 5}
        counts.append("/".join(nested._parent._path))
        return [[AggregationResult("total", 101)]]

    def stream(query, **kwargs):
        assert query._limit == 6 and kwargs == {"retry": None, "timeout": 5}
        assert (
            query._orders[0].field.field_path == "updatedAt"
            and query._orders[0].direction == 2
        )
        parent = query._parent
        child = parent.id
        assert (
            "/".join(parent._path)
            == f"{parents[child]}/{hashlib.sha256(uid.encode()).hexdigest()}/{child}"
        )
        row = domain[child]
        queries.append("/".join(parent._path))
        return iter(
            [
                DocumentSnapshot(
                    parent.document(row.id),
                    row.model_dump(by_alias=True),
                    True,
                    STAMP,
                    STAMP,
                    STAMP,
                )
            ]
        )

    monkeypatch.setattr(AggregationQuery, "get", count_get)
    monkeypatch.setattr(Query, "stream", stream)
    result = store.get(uid)
    assert result.uid == uid and result.counts.assessments == 101
    assert len(counts) == len(queries) == 3 and set(counts) == set(queries)


@pytest.mark.parametrize(
    "result",
    [
        [],
        [[]],
        [[AggregationResult("wrong", 1)]],
        [[AggregationResult("total", True)]],
        [[AggregationResult("total", -1)]],
        [[AggregationResult("total", 1), AggregationResult("extra", 1)]],
    ],
)
def test_unexpected_aggregation_results_are_unavailable(result):
    store = FirestoreDashboardStore(Settings(_env_file=None))
    connection = Mock()
    connection.collection.return_value.document.return_value.collection.return_value.count.return_value.get.return_value = result
    with pytest.raises(DashboardUnavailable):
        store._read(
            connection, "owner", "assessmentOwners", "assessments", lambda *_: None
        )


def test_unavailable_or_foreign_record_in_any_section_aborts_entire_dashboard(
    monkeypatch,
):
    store = FirestoreDashboardStore(Settings(_env_file=None))
    store._client = Mock()
    monkeypatch.setattr(store, "_read", Mock(side_effect=PermissionDenied("PRIVATE")))
    with pytest.raises(DashboardUnavailable):
        store.get("owner")
    collection = Mock()
    collection.count.return_value.get.return_value = [[AggregationResult("total", 1)]]
    row = Mock(exists=True, id=ID)
    a, _, _ = records("foreign")
    row.to_dict.return_value = a.model_dump(by_alias=True)
    collection.order_by.return_value.limit.return_value.stream.return_value = [row]
    connection = Mock()
    connection.collection.return_value.document.return_value.collection.return_value = (
        collection
    )
    monkeypatch.undo()
    store._client = connection
    with pytest.raises(DashboardUnavailable):
        store.get("owner")


def test_default_database_lazy_initialization_and_emulator_guard(monkeypatch):
    store = FirestoreDashboardStore(Settings(_env_file=None))
    sentinel = object()
    factory = Mock(return_value=Mock())
    monkeypatch.setattr(dashboard, "get_firebase_app", lambda _: sentinel)
    monkeypatch.setattr(dashboard.firestore, "client", factory)
    store._connection()
    store._connection()
    factory.assert_called_once_with(app=sentinel, database_id="(default)")
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "untrusted:1234")
    with pytest.raises(DashboardUnavailable):
        store._connection()


def test_real_sdk_zero_aggregation_decoding_is_a_confirmed_empty_account():
    from google.cloud.firestore_v1.base_aggregation import _query_response_to_result
    from google.cloud.firestore_v1.types import RunAggregationQueryResponse

    decoded = _query_response_to_result(
        RunAggregationQueryResponse(
            result={"aggregate_fields": {"total": {"integer_value": 0}}}
        )
    )
    connection, collection = Mock(), Mock()
    connection.collection.return_value.document.return_value.collection.return_value = (
        collection
    )
    collection.count.return_value.get.return_value = [decoded]
    collection.order_by.return_value.limit.return_value.stream.return_value = []
    store = FirestoreDashboardStore(Settings(_env_file=None))
    total, rows = store._read(
        connection, "owner", "assessmentOwners", "assessments", lambda *_: None
    )
    assert type(total) is int and total == 0 and rows == []
