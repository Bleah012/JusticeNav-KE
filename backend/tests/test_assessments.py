"""Assessment ownership, saved progress and concurrency checks; no live services."""

from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied
from pydantic import TypeAdapter, ValidationError

from app import assessments
from app.assessments import (
    Answers,
    AssessmentConflict,
    AssessmentMissing,
    AssessmentPage,
    AssessmentSummary,
    AssessmentUnavailable,
    AssessmentUpdate,
    ClarificationUpdate,
    DescriptionUpdate,
    FirestoreAssessmentStore,
    next_record,
)
from app.auth import InvalidToken, VerificationUnavailable
from app.config import Settings
from app.main import create_app

ID = "a" * 32
OTHER = "b" * 32
URL = "/api/v1/assessments"
ADAPTER = TypeAdapter(AssessmentUpdate)


def description(**changes):
    return {
        "step": "describe",
        "description": "A non-sensitive test description.",
        "proceed": False,
        "expectedRevision": 0,
        **changes,
    }


def clarification(**changes):
    return {
        "step": "clarify",
        "answers": {"issue": "consumer", "timeframe": "recent", "contact": "no"},
        "proceed": True,
        "expectedRevision": 1,
        **changes,
    }


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
            raise AssessmentMissing from error

    def save(self, uid, identifier, update):
        with self.lock:
            self.calls.append(("save", uid, identifier))
            value = next_record(
                uid, identifier, self.records.get((uid, identifier)), update
            )
            self.records[uid, identifier] = value
            return value

    def list(self, uid, status, cursor, limit):
        self.calls.append(("list", uid, status, cursor, limit))
        if cursor and (uid, cursor) not in self.records:
            raise AssessmentMissing
        values = sorted(
            (
                value
                for (owner, identifier), value in self.records.items()
                if owner == uid
                and (not status or value.status == status)
                and (not cursor or identifier > cursor)
            ),
            key=lambda row: row.id,
        )
        return AssessmentPage(
            assessments=[
                AssessmentSummary.model_validate(value.model_dump(by_alias=True))
                for value in values[:limit]
            ],
            nextCursor=values[limit - 1].id if len(values) > limit else None,
        )


def client(store=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            Verifier(),
            assessment_store=store if store is not None else MemoryStore(),
        )
    )


def headers(uid="user-a"):
    return {"Authorization": "Bearer " + uid}


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", URL, None),
        ("GET", URL + "/" + ID, None),
        ("PUT", URL + "/" + ID, description()),
    ],
)
@pytest.mark.parametrize("bearer", [None, "Basic fake", "Bearer invalid"])
def test_authentication_precedes_storage(method, path, body, bearer):
    store = MemoryStore()
    with client(store) as api:
        response = api.request(
            method,
            path,
            headers={"Authorization": bearer} if bearer else {},
            **({"json": body} if body else {}),
        )
    assert response.status_code == 401
    assert store.calls == []


def test_unavailable_authentication_does_not_load_assessments():
    store = MemoryStore()
    with client(store) as api:
        assert api.get(URL, headers=headers("unavailable")).status_code == 503
    assert store.calls == []


def test_missing_assessment_and_empty_list_do_not_create_records():
    store = MemoryStore()
    with client(store) as api:
        assert api.get(URL + "/" + ID, headers=headers()).status_code == 404
        assert api.get(URL, headers=headers()).json() == {
            "assessments": [],
            "nextCursor": None,
        }
    assert store.records == {}


def test_save_resume_partial_and_complete_progress_with_server_metadata():
    with client() as api:
        first = api.put(URL + "/" + ID, headers=headers(), json=description())
        assert first.status_code == 200
        saved = first.json()["assessment"]
        assert saved["status"] == "draft" and saved["revision"] == 1
        assert saved["uid"] == "user-a" and saved["answers"] == {
            "issue": None,
            "timeframe": None,
            "contact": None,
        }
        assert saved["createdAt"] == saved["updatedAt"]
        partial = api.put(
            URL + "/" + ID,
            headers=headers(),
            json=clarification(proceed=False, answers={"issue": "consumer"}),
        ).json()["assessment"]
        assert partial["status"] == "needs-clarification" and partial["revision"] == 2
        assert partial["answers"]["timeframe"] is None
        final = api.put(
            URL + "/" + ID, headers=headers(), json=clarification(expectedRevision=2)
        ).json()["assessment"]
        assert final["status"] == "awaiting-pathways" and final["revision"] == 3
        assert final["createdAt"] == saved["createdAt"]
        assert api.get(URL + "/" + ID, headers=headers()).json()["assessment"] == final
        assert not any(
            key in final for key in ("pathways", "classification", "results")
        )


def test_description_continue_then_changed_description_clears_answers():
    original = next_record(
        "user-a", ID, None, DescriptionUpdate.model_validate(description(proceed=True))
    )
    assert original.status == "needs-clarification"
    answered = next_record(
        "user-a", ID, original, ClarificationUpdate.model_validate(clarification())
    )
    unchanged = next_record(
        "user-a",
        ID,
        answered,
        DescriptionUpdate.model_validate(description(expectedRevision=2)),
    )
    assert unchanged.answers.complete() and unchanged.status == "awaiting-pathways"
    changed = next_record(
        "user-a",
        ID,
        unchanged,
        DescriptionUpdate.model_validate(
            description(
                description="Changed test input", expectedRevision=3, proceed=True
            )
        ),
    )
    assert changed.answers == Answers() and changed.status == "needs-clarification"


def test_same_identifier_is_scoped_to_owner_and_query_headers_cannot_select_other_user():
    with client() as api:
        api.put(URL + "/" + ID, headers=headers(), json=description())
        for path in [URL + "?uid=user-a", URL + "/" + ID + "?uid=user-a"]:
            response = api.get(
                path,
                headers={**headers("user-b"), "X-User-Id": "user-a", "X-Role": "admin"},
            )
            assert response.status_code == (200 if path.startswith(URL + "?") else 404)
            assert "user-a" not in response.text
        second = api.put(
            URL + "/" + ID,
            headers=headers("user-b"),
            json=description(description="Second account"),
        )
        assert second.json()["assessment"]["uid"] == "user-b"
        assert (
            api.get(URL + "/" + ID, headers=headers()).json()["assessment"][
                "description"
            ]
            != "Second account"
        )


@pytest.mark.parametrize(
    "extra",
    [
        "uid",
        "status",
        "role",
        "createdAt",
        "updatedAt",
        "revision",
        "classification",
        "pathways",
        "password",
    ],
)
def test_client_cannot_supply_ownership_results_or_server_metadata(extra):
    store = MemoryStore()
    with client(store) as api:
        response = api.put(
            URL + "/" + ID,
            headers=headers(),
            json=description(**{extra: "private-do-not-echo"}),
        )
    assert response.status_code == 422 and "private-do-not-echo" not in response.text
    assert store.calls == []


@pytest.mark.parametrize(
    "body",
    [
        description(description=" "),
        description(description="x" * 1501),
        description(description=123),
        description(description="x\x00y"),
        description(expectedRevision=True),
        description(expectedRevision=-1),
        description(proceed="true"),
        clarification(expectedRevision=0, answers={}),
        clarification(answers={"issue": "made-up"}),
        clarification(answers={"issue": "other", "unknown": "private-do-not-echo"}),
    ],
)
def test_invalid_fields_are_rejected_without_storage_or_echo(body):
    store = MemoryStore()
    with client(store) as api:
        response = api.put(URL + "/" + ID, headers=headers(), json=body)
    assert response.status_code == 422 and "private-do-not-echo" not in response.text
    assert store.calls == []


def test_missing_clarification_does_not_create_an_assessment():
    store = MemoryStore()
    with client(store) as api:
        response = api.put(
            URL + "/" + ID, headers=headers(), json=clarification(expectedRevision=0)
        )
    assert response.status_code == 404 and not store.records


def test_stale_revision_and_repeated_create_do_not_duplicate_or_overwrite():
    store = MemoryStore()
    with client(store) as api:
        assert (
            api.put(URL + "/" + ID, headers=headers(), json=description()).status_code
            == 200
        )
        assert (
            api.put(URL + "/" + ID, headers=headers(), json=description()).status_code
            == 409
        )
        assert len(store.records) == 1
        assert store.records["user-a", ID].revision == 1

        def save(index):
            return api.put(
                URL + "/" + ID,
                headers=headers(),
                json=description(expectedRevision=1, description=f"Edit {index}"),
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(save, [1, 2])) == [200, 409]


def test_list_is_bounded_owner_scoped_and_does_not_include_descriptions_or_answers():
    with client() as api:
        for identifier in [ID, OTHER]:
            api.put(URL + "/" + identifier, headers=headers(), json=description())
        api.put(URL + "/" + "c" * 32, headers=headers("user-b"), json=description())
        first = api.get(URL + "?limit=1", headers=headers()).json()
        assert len(first["assessments"]) == 1 and first["nextCursor"] == ID
        assert set(first["assessments"][0]) == {
            "id",
            "status",
            "revision",
            "createdAt",
            "updatedAt",
        }
        second = api.get(URL + "?after=" + ID, headers=headers()).json()
        assert [value["id"] for value in second["assessments"]] == [OTHER]
        assert second["nextCursor"] is None
        assert (
            api.get(URL + "?status=awaiting-pathways", headers=headers()).json()[
                "assessments"
            ]
            == []
        )


@pytest.mark.parametrize(
    "query", ["limit=0", "limit=51", "status=results-ready", "after=../bad"]
)
def test_invalid_list_options_are_rejected(query):
    with client() as api:
        assert api.get(URL + "?" + query, headers=headers()).status_code == 422


def test_missing_foreign_cursor_and_invalid_identifier_do_not_query_other_owners():
    with client() as api:
        assert api.get(URL + "?after=" + ID, headers=headers()).status_code == 404
        assert api.get(URL + "/invalid-reference", headers=headers()).status_code == 422


@pytest.mark.parametrize("operation", ["get", "save", "list"])
def test_unavailable_storage_returns_generic_errors(operation):
    store = Mock()
    getattr(store, operation).side_effect = AssessmentUnavailable(
        "private-storage-details"
    )
    with client(store) as api:
        response = (
            api.put(URL + "/" + ID, headers=headers(), json=description())
            if operation == "save"
            else api.get(
                URL + ("/" + ID if operation == "get" else ""), headers=headers()
            )
        )
    assert (
        response.status_code == 503 and "private-storage-details" not in response.text
    )


@pytest.mark.parametrize("operation", ["get", "save"])
def test_foreign_storage_result_is_never_returned(operation):
    store = Mock()
    getattr(store, operation).return_value = next_record(
        "user-b", ID, None, DescriptionUpdate.model_validate(description())
    )
    with client(store) as api:
        response = (
            api.put(URL + "/" + ID, headers=headers(), json=description())
            if operation == "save"
            else api.get(URL + "/" + ID, headers=headers())
        )
    assert response.status_code == 503 and "user-b" not in response.text


def transaction_fixture(monkeypatch, saved=None):
    reference, connection, transaction = Mock(), Mock(), Mock()
    reference.get.return_value.exists = saved is not None
    reference.get.return_value.to_dict.return_value = (
        saved.model_dump(by_alias=True) if saved else None
    )
    connection.transaction.return_value = transaction
    monkeypatch.setattr(
        assessments.firestore, "transactional", lambda function: function
    )
    store = FirestoreAssessmentStore(Settings(_env_file=None))
    store._client = connection
    monkeypatch.setattr(
        store, "_collection", lambda uid: Mock(document=Mock(return_value=reference))
    )
    return store, reference, transaction


def test_firestore_adapter_writes_after_read_and_preserves_revision_checks(monkeypatch):
    store, reference, transaction = transaction_fixture(monkeypatch)
    result = store.save("user-a", ID, DescriptionUpdate.model_validate(description()))
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    transaction.create.assert_called_once_with(
        reference, result.model_dump(by_alias=True)
    )
    transaction.set.assert_not_called()
    store, reference, transaction = transaction_fixture(monkeypatch, result)
    with pytest.raises(AssessmentConflict):
        store.save("user-a", ID, DescriptionUpdate.model_validate(description()))
    transaction.create.assert_not_called()
    transaction.set.assert_not_called()


def test_firestore_adapter_uses_default_database_and_owner_subcollection(monkeypatch):
    connection, sentinel = Mock(), object()
    monkeypatch.setattr(assessments, "get_firebase_app", lambda settings: sentinel)
    factory = Mock(return_value=connection)
    monkeypatch.setattr(assessments.firestore, "client", factory)
    store = FirestoreAssessmentStore(Settings(_env_file=None))
    store._collection("a/b")
    factory.assert_called_once_with(app=sentinel, database_id="(default)")
    owner = connection.collection.return_value.document.call_args.args[0]
    assert len(owner) == 64 and "/" not in owner
    connection.collection.assert_called_once_with("assessmentOwners")
    connection.collection.return_value.document.return_value.collection.assert_called_once_with(
        "assessments"
    )


def test_firestore_list_limits_and_uses_owner_scoped_cursor(monkeypatch):
    saved = next_record(
        "user-a", ID, None, DescriptionUpdate.model_validate(description())
    )
    anchor = Mock(exists=True, id=ID)
    anchor.to_dict.return_value = saved.model_dump(by_alias=True)
    collection, query = Mock(), Mock()
    collection.document.return_value.get.return_value = anchor
    collection.order_by.return_value = query
    query.where.return_value = query
    query.start_after.return_value = query
    query.limit.return_value.stream.return_value = [anchor]
    store = FirestoreAssessmentStore(Settings(_env_file=None))
    monkeypatch.setattr(store, "_collection", lambda uid: collection)
    result = store.list("user-a", "draft", ID, 20)
    query.start_after.assert_called_once_with(anchor)
    query.limit.assert_called_once_with(21)
    query.limit.return_value.stream.assert_called_once_with(retry=None, timeout=10)
    assert result.assessments[0].id == ID


def test_emulator_and_storage_permission_failures_do_not_bypass_auth(monkeypatch):
    store = FirestoreAssessmentStore(Settings(_env_file=None))
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "localhost:8080")
    with pytest.raises(AssessmentUnavailable):
        store.get("user-a", ID)
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST")
    monkeypatch.setattr(
        store, "_collection", Mock(side_effect=PermissionDenied("private-details"))
    )
    with pytest.raises(AssessmentUnavailable):
        store.list("user-a", None, None, 20)


def test_invalid_saved_progress_is_not_a_generated_result():
    saved = next_record(
        "user-a", ID, None, DescriptionUpdate.model_validate(description())
    )
    with pytest.raises(ValidationError):
        type(saved).model_validate(
            {**saved.model_dump(by_alias=True), "status": "awaiting-pathways"}
        )
