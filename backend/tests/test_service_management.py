"""Exercise persistent service CRUD, public visibility and administrative boundaries."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied

from app import service_management as services
from app.auth import InvalidToken
from app.catalog import CatalogStore, CatalogUnavailable
from app.config import Settings
from app.main import create_app

BASE = "/api/v1/admin/service-records"
ADMIN = {"Authorization": "Bearer admin"}


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        return {"uid": "test-administrator", "role": token}


class MemoryRepository:
    def __init__(self):
        self.state = services.initial_state(CatalogStore())
        self.lock = Lock()
        self.audit = []

    def read(self):
        return self.state.model_copy(deep=True)

    def change(self, identifier, change, uid, protected):
        with self.lock:
            state, record, audit = services.transition(
                self.state, identifier, change, uid, protected
            )
            self.state = state
            self.audit.append(audit)
            return record


def api(repository=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            service_repository=repository
            if repository is not None
            else MemoryRepository(),
        )
    )


def service(identifier="development-service"):
    record = CatalogStore().load().services[0].model_dump(mode="json", by_alias=True)
    record.update(id=identifier, name="Development service")
    return record


def save_body(identifier="development-service", revision=0):
    return {"service": service(identifier), "expectedRevision": revision}


def publish_body(revision=1):
    return {
        "expectedRevision": revision,
        "publication": "published",
        "reviewed": True,
        "reviewNote": "Checked details against the official source.",
    }


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "", None),
        ("GET", "/development-service", None),
        ("PUT", "/development-service", save_body()),
        ("PUT", "/development-service/publication", publish_body()),
        ("DELETE", "/development-service", {"expectedRevision": 1}),
    ],
)
@pytest.mark.parametrize(
    "role,status", [(None, 401), ("invalid", 401), ("seeker", 403), ("provider", 403)]
)
def test_role_is_verified_before_storage(method, path, body, role, status):
    repository = Mock()
    with api(repository) as client:
        response = client.request(
            method,
            BASE + path,
            json=body,
            headers={"Authorization": f"Bearer {role}"} if role else {},
        )
    assert response.status_code == status
    repository.read.assert_not_called()
    repository.change.assert_not_called()


def test_full_workflow_persists_between_app_instances_and_filters_public_output():
    repository = MemoryRepository()
    with api(repository) as client:
        initial = client.get(BASE, headers=ADMIN).json()
        assert len(initial["records"]) == 4
        assert "small-claims-courts" in initial["protectedServiceIds"]
        created = client.put(
            BASE + "/development-service", headers=ADMIN, json=save_body()
        )
        assert created.status_code == 200
        assert created.json()["record"]["publication"] == "draft"
        assert created.json()["record"]["revision"] == 1
        assert client.get("/api/v1/services/development-service").status_code == 404
        changed = save_body(revision=1)
        changed["service"]["name"] = "Updated development service"
        assert (
            client.put(
                BASE + "/development-service", headers=ADMIN, json=changed
            ).json()["record"]["revision"]
            == 2
        )
    with api(repository) as client:
        assert (
            client.get(BASE + "/development-service", headers=ADMIN).json()["record"][
                "service"
            ]["name"]
            == "Updated development service"
        )
        assert (
            client.put(
                BASE + "/development-service/publication",
                headers=ADMIN,
                json=publish_body(2),
            ).status_code
            == 200
        )
        public = client.get("/api/v1/services/development-service")
        assert public.status_code == 200
        assert public.json()["service"]["name"] == "Updated development service"
        assert (
            "reviewNote" not in public.text and "test-administrator" not in public.text
        )
        assert (
            client.get("/api/v1/admin/overview", headers=ADMIN).json()["services"] == 5
        )
        # Published entries cannot be deleted, even when the client forges a revision.
        assert (
            client.request(
                "DELETE",
                BASE + "/development-service",
                headers=ADMIN,
                json={"expectedRevision": 3},
            ).status_code
            == 409
        )
        archived = client.put(
            BASE + "/development-service/publication",
            headers=ADMIN,
            json={"expectedRevision": 3, "publication": "archived"},
        )
        assert archived.status_code == 200
        assert client.get("/api/v1/services/development-service").status_code == 404
        assert (
            client.get("/api/v1/admin/overview", headers=ADMIN).json()["services"] == 4
        )
        assert (
            client.put(
                BASE + "/development-service/publication",
                headers=ADMIN,
                json=publish_body(4),
            ).status_code
            == 200
        )
        assert client.get("/api/v1/services/development-service").status_code == 200
    assert [entry["action"] for entry in repository.audit] == [
        "service.create",
        "service.update",
        "service.publish",
        "service.archive",
        "service.publish",
    ]


def test_delete_removes_only_unused_draft_and_prevents_identifier_reuse():
    repository = MemoryRepository()
    with api(repository) as client:
        client.put(BASE + "/development-service", headers=ADMIN, json=save_body())
        deleted = client.request(
            "DELETE",
            BASE + "/development-service",
            headers=ADMIN,
            json={"expectedRevision": 1},
        )
        assert deleted.status_code == 200
        assert (
            deleted.json()["deletedId"] == "development-service"
            and deleted.json()["revision"] == 2
        )
        assert (
            client.get(BASE + "/development-service", headers=ADMIN).status_code == 404
        )
        assert len(client.get(BASE, headers=ADMIN).json()["records"]) == 4
        assert (
            client.put(
                BASE + "/development-service", headers=ADMIN, json=save_body()
            ).status_code
            == 409
        )
        assert (
            client.request(
                "DELETE",
                BASE + "/development-service",
                headers=ADMIN,
                json={"expectedRevision": 0},
            ).status_code
            == 404
        )
    assert repository.audit[-1]["action"] == "service.delete"


def test_linked_service_cannot_be_archived_and_published_edits_need_review():
    with api() as client:
        path = BASE + "/small-claims-courts"
        assert (
            client.put(
                path + "/publication",
                headers=ADMIN,
                json={"expectedRevision": 1, "publication": "archived"},
            ).status_code
            == 409
        )
        body = save_body("small-claims-courts", 1)
        assert client.put(path, headers=ADMIN, json=body).status_code == 422
        body.update(reviewed=True, reviewNote="Reviewed the official source.")
        assert client.put(path, headers=ADMIN, json=body).status_code == 200
        assert client.get("/api/v1/pathways").status_code == 200


@pytest.mark.parametrize(
    "mutate",
    [
        lambda body: body.update(expectedRevision=True),
        lambda body: body.update(uid="forged"),
        lambda body: body["service"].update(id="different-reference"),
        lambda body: body["service"].update(name="   "),
        lambda body: body["service"].update(officialWebsite="https://evil.test"),
        lambda body: body["service"]["sourceReview"].update(checkedOn="2999-01-01"),
        lambda body: body["service"]["sourceReview"].update(sources=[]),
    ],
)
def test_invalid_content_never_writes_or_echoes_input(mutate):
    repository = MemoryRepository()
    body = save_body()
    mutate(body)
    with api(repository) as client:
        response = client.put(BASE + "/development-service", headers=ADMIN, json=body)
    assert response.status_code == 422
    assert "evil.test" not in response.text and "forged" not in response.text
    assert not repository.audit


def test_conflicts_and_unreviewed_publication_preserve_previous_revision():
    repository = MemoryRepository()
    with api(repository) as client:
        client.put(BASE + "/development-service", headers=ADMIN, json=save_body())
        assert (
            client.put(
                BASE + "/development-service", headers=ADMIN, json=save_body()
            ).status_code
            == 409
        )
        body = publish_body()
        body["reviewed"] = False
        assert (
            client.put(
                BASE + "/development-service/publication", headers=ADMIN, json=body
            ).status_code
            == 422
        )
        assert (
            client.put(
                BASE + "/development-service/publication",
                headers=ADMIN,
                json={**publish_body(), "reviewNote": " "},
            ).status_code
            == 422
        )
        assert (
            client.get(BASE + "/development-service", headers=ADMIN).json()["record"][
                "revision"
            ]
            == 1
        )
    assert len(repository.audit) == 1


def test_concurrent_edits_allow_only_one_write():
    repository = MemoryRepository()
    repository.change(
        "development-service",
        services.ServiceSave.model_validate(save_body()),
        "admin",
        set(),
    )

    def write(name):
        body = save_body(revision=1)
        body["service"]["name"] = name
        try:
            repository.change(
                "development-service",
                services.ServiceSave.model_validate(body),
                "admin",
                set(),
            )
            return 200
        except services.ServiceProblem as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(write, ["First writer", "Second writer"])) == [200, 409]


def test_storage_failure_is_not_an_empty_success_or_original_file_fallback():
    repository = Mock()
    repository.read.side_effect = CatalogUnavailable("PRIVATE DIAGNOSTIC")
    repository.change.side_effect = CatalogUnavailable("PRIVATE DIAGNOSTIC")
    with api(repository) as client:
        for response in [
            client.get(BASE, headers=ADMIN),
            client.get("/api/v1/services"),
            client.put(BASE + "/development-service", headers=ADMIN, json=save_body()),
        ]:
            assert response.status_code == 503 and "PRIVATE" not in response.text


def test_firestore_writes_state_and_audit_in_same_transaction(monkeypatch):
    repository = services.FirestoreServiceRepository(Settings(_env_file=None))
    snapshot = SimpleNamespace(exists=False)
    reference = Mock()
    reference.get.return_value = snapshot
    transaction = Mock()
    client = Mock()
    client.collection.return_value.document.return_value = reference
    client.transaction.return_value = transaction
    repository._client = client
    monkeypatch.setattr(services.firestore, "transactional", lambda function: function)
    saved = repository.change(
        "development-service",
        services.ServiceSave.model_validate(save_body()),
        "admin",
        set(),
    )
    assert saved.publication == "draft"
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    transaction.set.assert_called_once()
    transaction.create.assert_called_once()
    persisted = deepcopy(transaction.set.call_args.args[1])
    assert isinstance(
        persisted["records"][0]["service"]["sourceReview"]["checkedOn"], str
    )
    repository._client = Mock()
    repository._client.collection.return_value.document.return_value.get.return_value = SimpleNamespace(
        exists=True, to_dict=lambda: persisted
    )
    assert len(repository.read().records) == 5
    assert transaction.create.call_args.args[1]["action"] == "service.create"


def test_firestore_denial_and_corrupt_data_fail_closed():
    repository = services.FirestoreServiceRepository(Settings(_env_file=None))
    repository._client = Mock()
    document = repository._client.collection.return_value.document.return_value
    document.get.side_effect = PermissionDenied("PRIVATE")
    with pytest.raises(CatalogUnavailable):
        repository.read()
    document.get.side_effect = None
    document.get.return_value = SimpleNamespace(
        exists=True, to_dict=lambda: {"records": "broken"}
    )
    with pytest.raises(CatalogUnavailable):
        repository.read()


def test_delete_preflight_and_all_admin_responses_disable_cache():
    with api() as client:
        response = client.options(
            BASE + "/development-service",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "DELETE",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert response.status_code == 200
        assert client.get(BASE, headers=ADMIN).headers["cache-control"] == "no-store"
