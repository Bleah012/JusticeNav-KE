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
        self.deleted = set()

    def get(self, uid, identifier):
        self.calls.append(("get", uid, identifier))
        try:
            return self.records[uid, identifier]
        except KeyError as error:
            raise AssessmentMissing from error

    def save(self, uid, identifier, update):
        with self.lock:
            self.calls.append(("save", uid, identifier))
            if (uid, identifier) in self.deleted:
                raise AssessmentMissing
            value = next_record(
                uid, identifier, self.records.get((uid, identifier)), update
            )
            self.records[uid, identifier] = value
            return value

    def delete(self, uid, identifier, revision):
        with self.lock:
            self.calls.append(("delete", uid, identifier))
            record = self.get(uid, identifier)
            if record.revision != revision:
                raise AssessmentConflict
            del self.records[uid, identifier]
            self.deleted.add((uid, identifier))
            return assessments.AssessmentDeleted(
                uid=uid, deletedId=identifier, revision=revision
            )

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


def test_suggestion_is_read_only_and_manual_answer_wins(monkeypatch):
    classifier = Mock(return_value="money-debt")
    monkeypatch.setattr(assessments, "suggest_issue", classifier)
    store = MemoryStore()
    saved = store.save("user-a", ID, ADAPTER.validate_python(description()))
    store.calls.clear()
    path = f"{URL}/{ID}/issue-suggestion"
    with client(store) as api:
        assert api.get(path, params={"revision": 1}).status_code == 401
        assert store.calls == []
        assert (
            api.get(path, params={"revision": 1}, headers=headers("user-b")).status_code
            == 404
        )
        assert (
            api.get(path, params={"revision": 2}, headers=headers()).status_code == 409
        )
        classifier.assert_not_called()
        response = api.get(path, params={"revision": 1}, headers=headers())
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json() == {
            "assessmentId": ID,
            "revision": 1,
            "issue": "money-debt",
        }
        classifier.assert_called_once_with(saved.description)
        assert store.records["user-a", ID] == saved
        assert all(call[0] == "get" for call in store.calls)

        response = api.put(f"{URL}/{ID}", json=clarification(), headers=headers())
        assert response.status_code == 200
        assert response.json()["assessment"]["answers"]["issue"] == "consumer"


def test_suggestion_abstains_or_fails_without_exposing_description(monkeypatch):
    classifier = Mock(side_effect=[None, assessments.SuggestionUnavailable("private")])
    monkeypatch.setattr(assessments, "suggest_issue", classifier)
    store = MemoryStore()
    store.save("user-a", ID, ADAPTER.validate_python(description()))
    path = f"{URL}/{ID}/issue-suggestion"
    with client(store) as api:
        rejected = api.get(path, params={"revision": "private"}, headers=headers())
        assert rejected.status_code == 422
        assert "private" not in rejected.text
        response = api.get(path, params={"revision": 1}, headers=headers())
        assert response.status_code == 200 and response.json()["issue"] is None
        failure = api.get(path, params={"revision": 1}, headers=headers())
        assert failure.status_code == 503
        assert "private" not in failure.text


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
    monkeypatch.setattr(
        store,
        "_deletion",
        Mock(return_value=Mock(get=Mock(return_value=Mock(exists=False)))),
    )
    return store, reference, transaction


def test_firestore_adapter_writes_after_read_and_preserves_revision_checks(monkeypatch):
    store, reference, transaction = transaction_fixture(monkeypatch)
    result = store.save("user-a", ID, DescriptionUpdate.model_validate(description()))
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    transaction.create.assert_any_call(reference, result.model_dump(by_alias=True))
    assert transaction.create.call_count == 2
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


@pytest.mark.parametrize(
    "token,expected", [(None, 401), ("invalid", 401), ("unavailable", 503)]
)
def test_delete_requires_authentication_before_storage(token, expected):
    store = MemoryStore()
    with client(store) as api:
        response = api.request(
            "DELETE",
            URL + "/" + ID,
            headers=headers(token) if token else {},
            json={"expectedRevision": 1},
        )
    assert response.status_code == expected and not store.calls


@pytest.mark.parametrize(
    "status", ["draft", "needs-clarification", "awaiting-pathways"]
)
def test_delete_supports_each_saved_state_and_never_restores_old_reference(status):
    store = MemoryStore()
    with client(store) as api:
        assert (
            api.put(
                URL + "/" + ID,
                headers=headers(),
                json=description(proceed=status != "draft"),
            ).status_code
            == 200
        )
        revision = 1
        if status == "awaiting-pathways":
            assert (
                api.put(
                    URL + "/" + ID, headers=headers(), json=clarification()
                ).status_code
                == 200
            )
            revision = 2
        assert (
            api.get(URL + "/" + ID, headers=headers()).json()["assessment"]["status"]
            == status
        )
        response = api.request(
            "DELETE",
            URL + "/" + ID,
            headers=headers(),
            json={"expectedRevision": revision},
        )
        assert (
            response.status_code == 200
            and response.headers["cache-control"] == "no-store"
        )
        assert response.json() == {
            "uid": "user-a",
            "deletedId": ID,
            "revision": revision,
        }
        assert api.get(URL + "/" + ID, headers=headers()).status_code == 404
        assert (
            api.get(
                URL + f"/{ID}/issue-suggestion?revision={revision}", headers=headers()
            ).status_code
            == 404
        )
        assert api.get(URL, headers=headers()).json()["assessments"] == []
        assert (
            api.put(URL + "/" + ID, headers=headers(), json=description()).status_code
            == 404
        )
        assert (
            api.put(
                URL + "/" + ID,
                headers=headers(),
                json=description(expectedRevision=revision),
            ).status_code
            == 404
        )
        assert (
            api.request(
                "DELETE",
                URL + "/" + ID,
                headers=headers(),
                json={"expectedRevision": revision},
            ).status_code
            == 404
        )


def test_assessment_deletion_preserves_checklists_referrals_and_other_account():
    from test_checklists import MemoryStore as Checklists
    from test_checklists import body as checklist_body
    from test_referrals import MemoryStore as Referrals
    from test_referrals import body as referral_body

    from app.dashboard import compose

    store, checklists, referrals = MemoryStore(), Checklists(), Referrals()

    class Dashboard:
        def get(self, uid):
            data = []
            for source in (store, checklists, referrals):
                rows = [
                    record
                    for (owner, _), record in source.records.items()
                    if owner == uid
                ]
                data.append((len(rows), rows))
            return compose(uid, *data)

    with client(store) as api:
        api.app.state.checklist_store = checklists
        api.app.state.referral_store = referrals
        api.app.state.dashboard_store = Dashboard()
        notifications = Mock()
        api.app.state.notification_store = notifications
        for owner, identifier in [("user-a", ID), ("user-a", OTHER), ("user-b", ID)]:
            assert (
                api.put(
                    URL + "/" + identifier, headers=headers(owner), json=description()
                ).status_code
                == 200
            )
        assert (
            api.put(URL + "/" + ID, headers=headers(), json=clarification()).status_code
            == 200
        )
        assert (
            api.put(
                "/api/v1/checklists/" + ID, headers=headers(), json=checklist_body()
            ).status_code
            == 200
        )
        assert (
            api.put(
                "/api/v1/referrals/" + ID, headers=headers(), json=referral_body()
            ).status_code
            == 200
        )
        before_checklist = api.get("/api/v1/checklists/" + ID, headers=headers()).json()
        before_referral = api.get("/api/v1/referrals/" + ID, headers=headers()).json()
        assert (
            api.request(
                "DELETE",
                URL + "/" + ID,
                headers=headers(),
                json={"expectedRevision": 1},
            ).status_code
            == 409
        )
        assert (
            api.request(
                "DELETE",
                URL + "/" + ID + "?uid=user-b",
                headers=headers(),
                json={"expectedRevision": 2},
            ).status_code
            == 200
        )
        assert api.get(URL + "/" + ID, headers=headers("user-b")).status_code == 200
        assert (
            api.get("/api/v1/checklists/" + ID, headers=headers()).json()
            == before_checklist
        )
        assert (
            api.get("/api/v1/referrals/" + ID, headers=headers()).json()
            == before_referral
        )
        dashboard = api.get("/api/v1/dashboard", headers=headers()).json()
        assert dashboard["counts"] == {
            "assessments": 1,
            "checklists": 1,
            "referrals": 1,
        }
        assert all(
            row["kind"] != "assessment" or row["id"] != ID
            for row in dashboard["activity"]
        )
    assert not notifications.mock_calls


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"expectedRevision": 0},
        {"expectedRevision": -1},
        {"expectedRevision": True},
        {"expectedRevision": "1"},
        {"expectedRevision": 1, "uid": "PRIVATE"},
    ],
)
def test_invalid_delete_input_is_redacted_before_storage(payload):
    store = MemoryStore()
    with client(store) as api:
        response = api.request(
            "DELETE", URL + "/" + ID, headers=headers(), json=payload
        )
    assert (
        response.status_code == 422
        and "PRIVATE" not in response.text
        and not store.calls
    )


def test_delete_cannot_target_another_owners_record_or_claim_foreign_success():
    store = MemoryStore()
    with client(store) as api:
        assert (
            api.put(
                URL + "/" + ID, headers=headers("user-b"), json=description()
            ).status_code
            == 200
        )
        assert (
            api.request(
                "DELETE",
                URL + "/" + ID,
                headers=headers(),
                json={"expectedRevision": 1},
            ).status_code
            == 404
        )
        assert api.get(URL + "/" + ID, headers=headers("user-b")).status_code == 200
    store = Mock()
    with client(store) as api:
        store.delete.side_effect = AssessmentUnavailable("PRIVATE")
        response = api.request(
            "DELETE", URL + "/" + ID, headers=headers(), json={"expectedRevision": 1}
        )
        assert response.status_code == 503 and "PRIVATE" not in response.text
        store.delete.side_effect = None
        store.delete.return_value = assessments.AssessmentDeleted(
            uid="foreign", deletedId=ID, revision=1
        )
        assert (
            api.request(
                "DELETE",
                URL + "/" + ID,
                headers=headers(),
                json={"expectedRevision": 1},
            ).status_code
            == 503
        )


def test_firestore_deletion_is_atomic_revision_checked_and_metadata_only(monkeypatch):
    from google.cloud.firestore_v1._helpers import encode_dict

    saved = next_record(
        "user-a", ID, None, DescriptionUpdate.model_validate(description())
    )
    store, reference, transaction = transaction_fixture(monkeypatch, saved)
    receipt = store.delete("user-a", ID, 1)
    assert receipt.model_dump(by_alias=True) == {
        "uid": "user-a",
        "deletedId": ID,
        "revision": 1,
    }
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    transaction.delete.assert_called_once_with(reference)
    marker, data = transaction.create.call_args.args
    assert marker is store._deletion.return_value
    assert set(data) == {"uid", "deletedId", "revision", "deletedAt"}
    assert "description" not in data and "answers" not in data
    encode_dict(data)
    assert transaction.create.call_count == 1
    transaction.set.assert_not_called()
    for value, revision, error in [
        (saved, 2, AssessmentConflict),
        (saved.model_copy(update={"uid": "foreign"}), 1, AssessmentUnavailable),
        (None, 1, AssessmentMissing),
    ]:
        store, _, transaction = transaction_fixture(monkeypatch, value)
        with pytest.raises(error):
            store.delete("user-a", ID, revision)
        transaction.delete.assert_not_called()
        transaction.create.assert_not_called()


def test_deletion_marker_prevents_a_late_first_save_and_is_owner_scoped(monkeypatch):
    import hashlib
    from datetime import UTC, datetime

    from google.auth.credentials import AnonymousCredentials
    from google.cloud.firestore_v1 import Client

    store, _, transaction = transaction_fixture(monkeypatch)
    marker = assessments.DeletionMarker(
        uid="user-a", deletedId=ID, revision=1, deletedAt=datetime.now(UTC)
    )
    snapshot = store._deletion.return_value.get.return_value
    snapshot.exists = True
    snapshot.to_dict.return_value = marker.model_dump(by_alias=True)
    with pytest.raises(AssessmentMissing):
        store.save("user-a", ID, DescriptionUpdate.model_validate(description()))
    transaction.create.assert_not_called()
    transaction.set.assert_not_called()
    snapshot.to_dict.return_value = marker.model_copy(
        update={"uid": "foreign"}
    ).model_dump(by_alias=True)
    with pytest.raises(AssessmentUnavailable):
        store.save("user-a", ID, DescriptionUpdate.model_validate(description()))
    real = FirestoreAssessmentStore(Settings(_env_file=None))
    real._client = Client(
        project="assessment-delete-test", credentials=AnonymousCredentials()
    )
    owner = hashlib.sha256(b"user-a").hexdigest()
    assert (
        real._deletion("user-a", ID).path
        == f"assessmentOwners/{owner}/deletedAssessments/{ID}"
    )


def test_concurrent_edit_and_delete_cannot_silently_overwrite_each_other():
    store = MemoryStore()
    store.save("user-a", ID, DescriptionUpdate.model_validate(description()))

    def change(action):
        try:
            if action == "delete":
                store.delete("user-a", ID, 1)
            else:
                store.save(
                    "user-a",
                    ID,
                    DescriptionUpdate.model_validate(description(expectedRevision=1)),
                )
            return "ok"
        except AssessmentMissing, AssessmentConflict:
            return "blocked"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(change, ["delete", "edit"])) == ["blocked", "ok"]
