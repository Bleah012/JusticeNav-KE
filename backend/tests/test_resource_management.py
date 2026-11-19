"""Resource publication, persistent CRUD, role boundaries and public projections."""

from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied
from google.cloud.firestore_v1._helpers import encode_dict
from test_pathway_management import MemoryPathways, Verifier
from test_service_management import MemoryRepository as MemoryServices

from app import resource_management as resources
from app.catalog import CatalogStore, CatalogUnavailable, review_today
from app.config import Settings
from app.main import create_app

BASE = "/api/v1/admin/resource-records"
ADMIN = {"Authorization": "Bearer admin"}


class MemoryResources:
    def __init__(self):
        self.state = resources.initial_state(CatalogStore())
        self.lock, self.audit = Lock(), []

    def read(self):
        return self.state.model_copy(deep=True)

    def change(self, identifier, change, uid):
        with self.lock:
            state, record, audit = resources.transition(
                self.state, identifier, change, uid
            )
            self.state = state
            self.audit.append(audit)
            return record


def api(repository=None, **stores):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            resource_repository=repository
            if repository is not None
            else MemoryResources(),
            **stores,
        )
    )


def item(identifier="development-resource"):
    data = CatalogStore().load().resources[0].model_dump(mode="json", by_alias=True)
    data.update(id=identifier, title="Development resource")
    return data


def body(identifier="development-resource", revision=0):
    return {"resource": item(identifier), "expectedRevision": revision}


def publish(revision=1):
    return {
        "expectedRevision": revision,
        "publication": "published",
        "reviewed": True,
        "reviewNote": "Reviewed the linked official source.",
    }


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("GET", "", None),
        ("GET", "/development-resource", None),
        ("PUT", "/development-resource", body()),
        ("PUT", "/development-resource/publication", publish()),
        ("DELETE", "/development-resource", {"expectedRevision": 1}),
    ],
)
@pytest.mark.parametrize(
    "role,status", [(None, 401), ("invalid", 401), ("seeker", 403), ("provider", 403)]
)
def test_authorization_precedes_resource_storage(method, path, payload, role, status):
    repository = Mock()
    with api(repository) as client:
        result = client.request(
            method,
            BASE + path,
            json=payload,
            headers={"Authorization": f"Bearer {role}"} if role else {},
        )
    assert result.status_code == status
    repository.read.assert_not_called()
    repository.change.assert_not_called()


def test_full_lifecycle_persists_between_app_instances_and_updates_public_library():
    repository = MemoryResources()
    path = BASE + "/development-resource"
    with api(repository) as client:
        assert len(client.get(BASE, headers=ADMIN).json()["records"]) == 6
        public = client.get("/api/v1/resources").json()
        assert len(public["resources"]) == 6
        created = client.put(path, headers=ADMIN, json=body())
        assert (
            created.status_code == 200
            and created.json()["record"]["publication"] == "draft"
        )
        assert created.json()["record"]["revision"] == 1
        assert client.get("/api/v1/resources").json() == public
        change = body(revision=1)
        change["resource"]["description"] = "Updated development resource description."
        change["resource"]["categories"] = ["preparation", "consumer"]
        assert (
            client.put(path, headers=ADMIN, json=change).json()["record"]["revision"]
            == 2
        )
    with api(repository) as client:
        loaded = client.get(path, headers=ADMIN).json()["record"]
        assert (
            loaded["resource"]["description"]
            == "Updated development resource description."
        )
        assert (
            client.put(
                path + "/publication", headers=ADMIN, json=publish(2)
            ).status_code
            == 200
        )
        response = client.get("/api/v1/resources")
        assert response.status_code == 200 and len(response.json()["resources"]) == 7
        assert (
            "reviewNote" not in response.text
            and "test-administrator" not in response.text
            and "everPublished" not in response.text
        )
        row = next(
            row
            for row in response.json()["resources"]
            if row["id"] == "development-resource"
        )
        assert row["categories"] == ["preparation", "consumer"]
        assert (
            client.get("/api/v1/admin/overview", headers=ADMIN).json()["resources"] == 7
        )
        assert (
            client.request(
                "DELETE", path, headers=ADMIN, json={"expectedRevision": 3}
            ).status_code
            == 409
        )
        assert (
            client.put(
                path + "/publication",
                headers=ADMIN,
                json={"expectedRevision": 3, "publication": "archived"},
            ).status_code
            == 200
        )
        assert len(client.get("/api/v1/resources").json()["resources"]) == 6
        assert (
            client.get("/api/v1/admin/overview", headers=ADMIN).json()["resources"] == 6
        )
        assert (
            client.request(
                "DELETE", path, headers=ADMIN, json={"expectedRevision": 4}
            ).status_code
            == 409
        )
        assert (
            client.put(
                path + "/publication", headers=ADMIN, json=publish(4)
            ).status_code
            == 200
        )
    assert [row["action"] for row in repository.audit] == [
        "resource.create",
        "resource.update",
        "resource.publish",
        "resource.archive",
        "resource.publish",
    ]


def test_unused_draft_delete_reserves_id_and_leaves_public_entries_unchanged():
    with api() as client:
        path = BASE + "/development-resource"
        before = client.get("/api/v1/resources").json()
        client.put(path, headers=ADMIN, json=body())
        result = client.request(
            "DELETE", path, headers=ADMIN, json={"expectedRevision": 1}
        )
        assert (
            result.status_code == 200
            and result.json()["deletedId"] == "development-resource"
            and result.json()["revision"] == 2
        )
        assert client.get(path, headers=ADMIN).status_code == 404
        assert client.put(path, headers=ADMIN, json=body()).status_code == 409
        assert client.get("/api/v1/resources").json() == before


def test_published_edits_require_review_and_stale_revisions_never_overwrite():
    identifier = CatalogStore().load().resources[0].id
    with api() as client:
        change = body(identifier, 1)
        assert (
            client.put(BASE + "/" + identifier, headers=ADMIN, json=change).status_code
            == 422
        )
        change.update(reviewed=True, reviewNote="Checked the official publication.")
        assert (
            client.put(BASE + "/" + identifier, headers=ADMIN, json=change).status_code
            == 200
        )
        assert (
            client.put(BASE + "/" + identifier, headers=ADMIN, json=change).status_code
            == 409
        )
        client.put(BASE + "/development-resource", headers=ADMIN, json=body())
        assert (
            client.put(
                BASE + "/development-resource/publication",
                headers=ADMIN,
                json={**publish(), "reviewed": False},
            ).status_code
            == 422
        )
        assert (
            client.put(
                BASE + "/development-resource/publication",
                headers=ADMIN,
                json={**publish(), "reviewNote": " "},
            ).status_code
            == 422
        )
        assert (
            client.put(
                BASE + "/development-resource/publication",
                headers=ADMIN,
                json={"expectedRevision": 1, "publication": "archived"},
            ).status_code
            == 409
        )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update(expectedRevision=True),
        lambda value: value.update(uid="PRIVATE_FORGED"),
        lambda value: value["resource"].update(id="different-reference"),
        lambda value: value["resource"].update(title=" "),
        lambda value: value["resource"].update(description="x" * 2001),
        lambda value: value["resource"].update(categories=[]),
        lambda value: value["resource"].update(categories=["consumer", "consumer"]),
        lambda value: value["resource"].update(categories=["unknown-category"]),
        lambda value: value["resource"]["source"].update(url="https://evil.test"),
        lambda value: value["resource"]["source"].update(
            url="https://judiciary.go.ke/?private=sentinel"
        ),
        lambda value: value["resource"]["source"].update(checkedOn="2999-01-01"),
        lambda value: value["resource"]["source"].update(name="\x00"),
    ],
)
def test_invalid_content_is_redacted_and_never_written(mutate):
    repository = MemoryResources()
    change = body()
    mutate(change)
    with api(repository) as client:
        result = client.put(BASE + "/development-resource", headers=ADMIN, json=change)
    assert (
        result.status_code == 422
        and "PRIVATE_FORGED" not in result.text
        and "evil.test" not in result.text
        and "sentinel" not in result.text
    )
    assert not repository.audit


def test_todays_kenya_review_date_updates_public_catalogue_date():
    with api() as client:
        change = body()
        change["resource"]["source"]["checkedOn"] = review_today().isoformat()
        assert (
            client.put(
                BASE + "/development-resource", headers=ADMIN, json=change
            ).status_code
            == 200
        )
        client.put(
            BASE + "/development-resource/publication", headers=ADMIN, json=publish()
        )
        assert (
            client.get("/api/v1/resources").json()["checkedOn"]
            == review_today().isoformat()
        )


def test_concurrent_stale_updates_allow_one_writer():
    repository = MemoryResources()
    repository.change(
        "development-resource", resources.ResourceSave.model_validate(body()), "admin"
    )

    def edit(title):
        change = body(revision=1)
        change["resource"]["title"] = title
        try:
            repository.change(
                "development-resource",
                resources.ResourceSave.model_validate(change),
                "admin",
            )
            return 200
        except resources.ResourceProblem as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit, ["First writer", "Second writer"])) == [200, 409]


def test_resource_operations_preserve_managed_services_and_pathways():
    with api(
        service_repository=MemoryServices(), pathway_repository=MemoryPathways()
    ) as client:
        services_before = client.get("/api/v1/services").json()["services"]
        pathways_before = client.get("/api/v1/pathways").json()
        client.put(BASE + "/development-resource", headers=ADMIN, json=body())
        client.put(
            BASE + "/development-resource/publication", headers=ADMIN, json=publish()
        )
        assert client.get("/api/v1/services").json()["services"] == services_before
        assert client.get("/api/v1/pathways").json() == pathways_before
        service = client.get("/api/v1/services/" + services_before[0]["id"]).json()[
            "service"
        ]
        service["description"] = "Updated reviewed service description."
        assert (
            client.put(
                "/api/v1/admin/service-records/" + service["id"],
                headers=ADMIN,
                json={
                    "service": service,
                    "expectedRevision": 1,
                    "reviewed": True,
                    "reviewNote": "Checked official source.",
                },
            ).status_code
            == 200
        )
        assert any(
            row["id"] == "development-resource"
            for row in client.get("/api/v1/resources").json()["resources"]
        )


def test_storage_failures_do_not_report_empty_success_or_fallback_to_old_file():
    repository = Mock()
    repository.read.side_effect = CatalogUnavailable("PRIVATE")
    repository.change.side_effect = CatalogUnavailable("PRIVATE")
    with api(repository) as client:
        for result in [
            client.get(BASE, headers=ADMIN),
            client.get("/api/v1/resources"),
            client.put(BASE + "/development-resource", headers=ADMIN, json=body()),
        ]:
            assert result.status_code == 503 and "PRIVATE" not in result.text


def test_firestore_state_and_audit_share_transaction_and_use_encodable_dates(
    monkeypatch,
):
    repository = resources.FirestoreResourceRepository(Settings(_env_file=None))
    repository._client = Mock()
    client = repository._client
    reference = client.collection.return_value.document.return_value
    reference.get.return_value = SimpleNamespace(exists=False)
    transaction = client.transaction.return_value
    monkeypatch.setattr(resources.firestore, "transactional", lambda function: function)
    result = repository.change(
        "development-resource", resources.ResourceSave.model_validate(body()), "admin"
    )
    assert result.publication == "draft"
    reference.get.assert_called_once_with(
        transaction=transaction, retry=None, timeout=10
    )
    transaction.set.assert_called_once()
    transaction.create.assert_called_once()
    state = transaction.set.call_args.args[1]
    encode_dict(state)
    assert isinstance(state["records"][0]["resource"]["source"]["checkedOn"], str)
    assert transaction.create.call_args.args[1]["action"] == "resource.create"
    reference.get.return_value = SimpleNamespace(exists=True, to_dict=lambda: state)
    assert len(repository.read().records) == 7


def test_firestore_denial_and_corrupt_state_fail_closed():
    repository = resources.FirestoreResourceRepository(Settings(_env_file=None))
    repository._client = Mock()
    reference = repository._client.collection.return_value.document.return_value
    reference.get.side_effect = PermissionDenied("PRIVATE")
    with pytest.raises(CatalogUnavailable):
        repository.read()
    reference.get.side_effect = None
    reference.get.return_value = SimpleNamespace(
        exists=True, to_dict=lambda: {"records": "broken"}
    )
    with pytest.raises(CatalogUnavailable):
        repository.read()


def test_reading_never_seeds_storage_and_api_responses_are_not_cached():
    repository = MemoryResources()
    with api(repository) as client:
        assert client.get(BASE, headers=ADMIN).headers["cache-control"] == "no-store"
        assert client.get("/api/v1/resources").headers["cache-control"] == "no-store"
    assert not repository.audit
