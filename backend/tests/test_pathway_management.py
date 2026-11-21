"""Administrative pathway lifecycle, service dependencies and immutable saved snapshots."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Lock
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from google.api_core.exceptions import PermissionDenied
from google.cloud.firestore_v1._helpers import encode_dict
from test_checklists import MemoryStore as MemoryChecklists
from test_referrals import MemoryStore as MemoryReferrals
from test_service_management import MemoryRepository as MemoryServices

from app import catalog as public_catalog
from app import pathway_management as pathways
from app import service_management as services
from app.auth import InvalidToken
from app.catalog import CatalogStore
from app.config import Settings
from app.main import create_app
from app.pathways import PathwayStore, PathwayUnavailable

BASE = "/api/v1/admin/pathway-records"
ADMIN = {"Authorization": "Bearer admin"}
SEEKER = {"Authorization": "Bearer seeker:seeker-owner"}


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        role, _, uid = token.partition(":")
        return {"uid": uid or "test-administrator", "role": role}


class MemoryPathways:
    def __init__(self):
        self.state = pathways.initial_state(PathwayStore())
        self.lock = Lock()
        self.audit = []

    def read(self):
        return self.state.model_copy(deep=True)

    def change(self, identifier, change, uid, published_service_ids):
        with self.lock:
            state, record, audit = pathways.transition(
                self.state, identifier, change, uid, published_service_ids
            )
            self.state = state
            self.audit.append(audit)
            return record


def api(repository=None, service_repository=None, **stores):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            pathway_repository=repository
            if repository is not None
            else MemoryPathways(),
            service_repository=service_repository
            if service_repository is not None
            else MemoryServices(),
            **stores,
        )
    )


def guide(identifier="development-pathway"):
    value = PathwayStore().load().pathways[0].model_dump(mode="json", by_alias=True)
    value.update(id=identifier, title="Development pathway")
    return value


def body(identifier="development-pathway", revision=0):
    return {"pathway": guide(identifier), "expectedRevision": revision}


def publish(revision=1):
    return {
        "expectedRevision": revision,
        "publication": "published",
        "reviewed": True,
        "reviewNote": "Compared the guide with the cited official source.",
    }


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("GET", "", None),
        ("GET", "/development-pathway", None),
        ("PUT", "/development-pathway", body()),
        ("PUT", "/development-pathway/publication", publish()),
        ("DELETE", "/development-pathway", {"expectedRevision": 1}),
    ],
)
@pytest.mark.parametrize(
    "role,status", [(None, 401), ("invalid", 401), ("seeker", 403), ("provider", 403)]
)
def test_authorization_precedes_all_repository_access(
    method, path, payload, role, status
):
    repository, service_repository = Mock(), Mock()
    with api(repository, service_repository) as client:
        response = client.request(
            method,
            BASE + path,
            json=payload,
            headers={"Authorization": f"Bearer {role}"} if role else {},
        )
    assert response.status_code == status
    repository.read.assert_not_called()
    repository.change.assert_not_called()
    service_repository.read.assert_not_called()


def test_create_edit_publish_archive_republish_and_persistence_between_apps():
    repository, service_repository = MemoryPathways(), MemoryServices()
    path = BASE + "/development-pathway"
    with api(repository, service_repository) as client:
        listing = client.get(BASE, headers=ADMIN).json()
        assert len(listing["records"]) == 4 and len(listing["publishedServices"]) == 4
        assert set(listing["protectedPathwayIds"]) == pathways.PROTECTED_PATHWAYS
        created = client.put(path, headers=ADMIN, json=body())
        assert (
            created.status_code == 200
            and created.json()["record"]["publication"] == "draft"
        )
        assert client.get("/api/v1/pathways/development-pathway").status_code == 404
        changed = body(revision=1)
        changed["pathway"]["requirements"] = ["Updated public requirement"]
        changed["pathway"]["preparation"].append(
            {
                "id": "check-latest",
                "label": "Check latest guidance",
                "note": "Review the official page.",
            }
        )
        assert (
            client.put(path, headers=ADMIN, json=changed).json()["record"]["revision"]
            == 2
        )
    with api(repository, service_repository) as client:
        assert client.get(path, headers=ADMIN).json()["record"]["pathway"][
            "requirements"
        ] == ["Updated public requirement"]
        assert (
            client.put(
                path + "/publication", headers=ADMIN, json=publish(2)
            ).status_code
            == 200
        )
        public = client.get("/api/v1/pathways/development-pathway")
        assert (
            public.status_code == 200
            and "test-administrator" not in public.text
            and "reviewNote" not in public.text
        )
        assert (
            len(
                client.get("/api/v1/pathways/development-pathway/preparation").json()[
                    "items"
                ]
            )
            == 4
        )
        assert (
            client.get("/api/v1/admin/overview", headers=ADMIN).json()["pathways"] == 5
        )
        assert (
            client.put(
                path + "/publication",
                headers=ADMIN,
                json={"expectedRevision": 3, "publication": "archived"},
            ).status_code
            == 200
        )
        assert client.get("/api/v1/pathways/development-pathway").status_code == 404
        assert (
            client.get("/api/v1/admin/overview", headers=ADMIN).json()["pathways"] == 4
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
    assert [entry["action"] for entry in repository.audit] == [
        "pathway.create",
        "pathway.update",
        "pathway.publish",
        "pathway.archive",
        "pathway.publish",
    ]


def test_unused_draft_deletion_reserves_reference_and_does_not_change_public_catalogue():
    with api() as client:
        path = BASE + "/development-pathway"
        before = client.get("/api/v1/pathways").json()
        client.put(path, headers=ADMIN, json=body())
        response = client.request(
            "DELETE", path, headers=ADMIN, json={"expectedRevision": 1}
        )
        assert (
            response.status_code == 200
            and response.json()["deletedId"] == "development-pathway"
        )
        assert response.json()["revision"] == 2
        assert client.get(path, headers=ADMIN).status_code == 404
        assert client.put(path, headers=ADMIN, json=body()).status_code == 409
        assert client.get("/api/v1/pathways").json() == before


@pytest.mark.parametrize("identifier", sorted(pathways.PROTECTED_PATHWAYS))
def test_assessment_links_cannot_be_archived(identifier):
    with api() as client:
        assert (
            client.put(
                f"{BASE}/{identifier}/publication",
                headers=ADMIN,
                json={"expectedRevision": 1, "publication": "archived"},
            ).status_code
            == 409
        )
        assert client.get(f"/api/v1/pathways/{identifier}").status_code == 200


def test_published_edits_and_publication_require_review_and_current_revision():
    with api() as client:
        identifier = "cak-consumer-complaint"
        change = body(identifier, 1)
        assert (
            client.put(f"{BASE}/{identifier}", headers=ADMIN, json=change).status_code
            == 422
        )
        change.update(reviewed=True, reviewNote="Reviewed official guidance.")
        assert (
            client.put(f"{BASE}/{identifier}", headers=ADMIN, json=change).status_code
            == 200
        )
        assert (
            client.put(f"{BASE}/{identifier}", headers=ADMIN, json=change).status_code
            == 409
        )
        client.put(BASE + "/development-pathway", headers=ADMIN, json=body())
        assert (
            client.put(
                BASE + "/development-pathway/publication",
                headers=ADMIN,
                json={**publish(), "reviewed": False},
            ).status_code
            == 422
        )
        assert (
            client.put(
                BASE + "/development-pathway/publication",
                headers=ADMIN,
                json={**publish(), "reviewNote": " "},
            ).status_code
            == 422
        )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update(expectedRevision=True),
        lambda value: value.update(uid="PRIVATE_FORGED"),
        lambda value: value["pathway"].update(id="another-reference"),
        lambda value: value["pathway"].update(overview="   "),
        lambda value: value["pathway"]["sourceReview"].update(checkedOn="2999-01-01"),
        lambda value: value["pathway"]["sourceReview"].update(
            sources=[{"name": "Source", "url": "https://evil.test"}]
        ),
        lambda value: value["pathway"]["preparation"].append(
            value["pathway"]["preparation"][0].copy()
        ),
        lambda value: value["pathway"].update(requirements=["Requirement"] * 11),
    ],
)
def test_invalid_content_is_redacted_and_never_persisted(mutate):
    repository = MemoryPathways()
    change = body()
    mutate(change)
    with api(repository) as client:
        result = client.put(BASE + "/development-pathway", headers=ADMIN, json=change)
    assert (
        result.status_code == 422
        and "PRIVATE_FORGED" not in result.text
        and "evil.test" not in result.text
    )
    assert not repository.audit


def test_only_published_service_links_can_be_saved_and_publish_rechecks_service():
    service_repository = MemoryServices()
    path_repository = MemoryPathways()
    with api(path_repository, service_repository) as client:
        # Create a service draft through its real management endpoint.
        data = CatalogStore().load().services[0].model_dump(mode="json", by_alias=True)
        data["id"] = "development-service"
        client.put(
            "/api/v1/admin/service-records/development-service",
            headers=ADMIN,
            json={"service": data, "expectedRevision": 0},
        )
        invalid = body()
        invalid["pathway"]["serviceId"] = "development-service"
        assert (
            client.put(
                BASE + "/development-pathway", headers=ADMIN, json=invalid
            ).status_code
            == 409
        )
        client.put(
            "/api/v1/admin/service-records/development-service/publication",
            headers=ADMIN,
            json=publish(),
        )
        assert (
            client.put(
                BASE + "/development-pathway", headers=ADMIN, json=invalid
            ).status_code
            == 200
        )
        # A draft does not prevent service archiving, but cannot publish afterwards.
        assert (
            client.put(
                "/api/v1/admin/service-records/development-service/publication",
                headers=ADMIN,
                json={"expectedRevision": 2, "publication": "archived"},
            ).status_code
            == 200
        )
        assert (
            client.put(
                BASE + "/development-pathway/publication", headers=ADMIN, json=publish()
            ).status_code
            == 409
        )


def test_published_pathway_blocks_service_archive_until_unlinked():
    with api() as client:
        data = CatalogStore().load().services[0].model_dump(mode="json", by_alias=True)
        data["id"] = "development-service"
        service_url = "/api/v1/admin/service-records/development-service"
        client.put(
            service_url, headers=ADMIN, json={"service": data, "expectedRevision": 0}
        )
        client.put(service_url + "/publication", headers=ADMIN, json=publish())
        change = body()
        change["pathway"]["serviceId"] = "development-service"
        client.put(BASE + "/development-pathway", headers=ADMIN, json=change)
        client.put(
            BASE + "/development-pathway/publication", headers=ADMIN, json=publish()
        )
        assert (
            client.put(
                service_url + "/publication",
                headers=ADMIN,
                json={"expectedRevision": 2, "publication": "archived"},
            ).status_code
            == 409
        )
        client.put(
            BASE + "/development-pathway/publication",
            headers=ADMIN,
            json={"expectedRevision": 2, "publication": "archived"},
        )
        assert (
            client.put(
                service_url + "/publication",
                headers=ADMIN,
                json={"expectedRevision": 2, "publication": "archived"},
            ).status_code
            == 200
        )


def test_saved_checklist_and_referral_snapshots_survive_edits_and_archival():
    checklist_store, referral_store = MemoryChecklists(), MemoryReferrals()
    with api(checklist_store=checklist_store, referral_store=referral_store) as client:
        identifier = "development-pathway"
        path = BASE + "/" + identifier
        client.put(path, headers=ADMIN, json=body())
        client.put(path + "/publication", headers=ADMIN, json=publish())
        template = client.get(
            "/api/v1/checklists/templates/" + identifier, headers=SEEKER
        ).json()
        create = {
            "pathwayId": identifier,
            "templateVersion": template["templateVersion"],
            "checkedIds": [template["items"][0]["id"]],
            "expectedRevision": 0,
        }
        checklist_url = "/api/v1/checklists/" + "a" * 32
        assert client.put(checklist_url, headers=SEEKER, json=create).status_code == 200
        saved_checklist = client.get(checklist_url, headers=SEEKER).json()
        selection = client.get(
            "/api/v1/referrals/selection/" + identifier, headers=SEEKER
        ).json()
        request = {
            "pathwayId": identifier,
            "serviceId": selection["service"]["id"],
            "selectionVersion": selection["selectionVersion"],
            "fullName": "Development user",
            "email": "test@example.test",
            "phone": None,
            "contactMethod": "email",
            "description": "Non-sensitive demonstration.",
            "acknowledged": True,
            "expectedRevision": 0,
        }
        referral_url = "/api/v1/referrals/" + "b" * 32
        assert client.put(referral_url, headers=SEEKER, json=request).status_code == 200
        saved_referral = client.get(referral_url, headers=SEEKER).json()
        change = body(revision=2)
        change["pathway"]["title"] = "Updated guide title"
        change["pathway"]["preparation"][0]["note"] = (
            "Changed current preparation note."
        )
        change.update(reviewed=True, reviewNote="Checked revised guidance.")
        assert client.put(path, headers=ADMIN, json=change).status_code == 200
        current = client.get(
            "/api/v1/checklists/templates/" + identifier, headers=SEEKER
        ).json()
        assert current["templateVersion"] != template["templateVersion"]
        assert (
            client.put(
                "/api/v1/checklists/" + "c" * 32, headers=SEEKER, json=create
            ).status_code
            == 409
        )
        assert client.get(checklist_url, headers=SEEKER).json() == saved_checklist
        assert client.get(referral_url, headers=SEEKER).json() == saved_referral
        client.put(
            path + "/publication",
            headers=ADMIN,
            json={"expectedRevision": 3, "publication": "archived"},
        )
        assert (
            client.get(
                "/api/v1/checklists/templates/" + identifier, headers=SEEKER
            ).status_code
            == 404
        )
        assert client.get(referral_url, headers=SEEKER).json() == saved_referral
        assert (
            client.put(
                checklist_url, headers=SEEKER, json={**create, "expectedRevision": 1}
            ).status_code
            == 200
        )


def test_concurrent_stale_edits_do_not_overwrite():
    repository = MemoryPathways()
    active = {row.id for row in CatalogStore().load().services}
    repository.change(
        "development-pathway",
        pathways.PathwaySave.model_validate(body()),
        "admin",
        active,
    )

    def edit(title):
        value = body(revision=1)
        value["pathway"]["title"] = title
        try:
            repository.change(
                "development-pathway",
                pathways.PathwaySave.model_validate(value),
                "admin",
                active,
            )
            return 200
        except pathways.PathwayProblem as error:
            return error.status

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(edit, ["First writer", "Second writer"])) == [
            200,
            409,
        ]


def test_storage_failure_is_an_error_instead_of_file_fallback_or_empty_success():
    repository = Mock()
    repository.read.side_effect = PathwayUnavailable("PRIVATE")
    repository.change.side_effect = PathwayUnavailable("PRIVATE")
    with api(repository) as client:
        for result in [
            client.get(BASE, headers=ADMIN),
            client.get("/api/v1/pathways"),
            client.put(BASE + "/development-pathway", headers=ADMIN, json=body()),
        ]:
            assert result.status_code == 503 and "PRIVATE" not in result.text


def test_firestore_transactions_read_both_catalogues_before_writing_and_append_audit(
    monkeypatch,
):
    service_repository = services.FirestoreServiceRepository(Settings(_env_file=None))
    path_repository = pathways.FirestorePathwayRepository(
        Settings(_env_file=None), service_repository
    )
    service_repository.pathway_repository = path_repository
    transaction = Mock()
    client = Mock()
    service_repository._client = path_repository._client = client
    reads = []

    class Collection:
        def __init__(self, name):
            self.name = name

        def document(self, identifier):
            def get(**kwargs):
                reads.append((self.name, identifier, kwargs))
                return SimpleNamespace(exists=False)

            return SimpleNamespace(get=get)

    client.collection.side_effect = Collection
    client.transaction.return_value = transaction
    monkeypatch.setattr(services.firestore, "transactional", lambda function: function)
    record = path_repository.change(
        "development-pathway",
        pathways.PathwaySave.model_validate(body()),
        "admin",
        set(),
    )
    assert record.publication == "draft"
    assert {entry[1] for entry in reads} == {"services-v1", "pathways-v1"}
    assert all(entry[2]["transaction"] is transaction for entry in reads)
    data = transaction.set.call_args.args[1]
    assert isinstance(data["records"][0]["pathway"]["sourceReview"]["checkedOn"], str)
    encode_dict(data)
    assert transaction.create.call_args.args[1]["action"] == "pathway.create"
    reads.clear()
    transaction.reset_mock()
    change = services.ServiceSave(
        service=CatalogStore()
        .load()
        .services[0]
        .model_copy(update={"id": "development-service"}),
        expectedRevision=0,
    )
    service_repository.change("development-service", change, "admin", set())
    assert {entry[1] for entry in reads} == {"services-v1", "pathways-v1"}
    assert transaction.create.call_args.args[1]["action"] == "service.create"


def test_firestore_denial_and_corruption_fail_closed():
    repository = pathways.FirestorePathwayRepository(Settings(_env_file=None), Mock())
    repository._client = Mock()
    reference = repository._client.collection.return_value.document.return_value
    reference.get.side_effect = PermissionDenied("PRIVATE")
    with pytest.raises(PathwayUnavailable):
        repository.read()
    reference.get.side_effect = None
    reference.get.return_value = SimpleNamespace(
        exists=True, to_dict=lambda: {"records": "broken"}
    )
    with pytest.raises(PathwayUnavailable):
        repository.read()


def test_public_reads_do_not_seed_a_document_and_responses_disable_cache():
    repository = MemoryPathways()
    with api(repository) as client:
        result = client.get("/api/v1/pathways")
        assert (
            result.status_code == 200 and result.headers["cache-control"] == "no-store"
        )
        assert client.get(BASE, headers=ADMIN).headers["cache-control"] == "no-store"
    assert not repository.audit


def test_review_date_uses_the_nairobi_day_after_local_midnight(monkeypatch):
    class Clock:
        @staticmethod
        def now(tz):
            return datetime(2026, 11, 18, 21, 30, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(public_catalog, "datetime", Clock)
    assert public_catalog.review_today().isoformat() == "2026-11-19"
    change = body()
    change["pathway"]["sourceReview"]["checkedOn"] = "2026-11-19"
    pathways.PathwaySave.model_validate(change)
    change["pathway"]["sourceReview"]["checkedOn"] = "2026-11-20"
    with pytest.raises(ValueError):
        pathways.PathwaySave.model_validate(change)


def test_transaction_snapshot_overrules_stale_outside_service_choices(monkeypatch):
    service_repository = Mock()
    service_repository.read_in_transaction.return_value = services.ServiceState(
        records=[]
    )
    repository = pathways.FirestorePathwayRepository(
        Settings(_env_file=None), service_repository
    )
    repository._client = Mock()
    reference = repository._client.collection.return_value.document.return_value
    reference.get.return_value = SimpleNamespace(exists=False)
    transaction = repository._client.transaction.return_value
    monkeypatch.setattr(pathways.firestore, "transactional", lambda function: function)
    stale_choices = {guide()["serviceId"]}
    with pytest.raises(pathways.PathwayProblem) as error:
        repository.change(
            "development-pathway",
            pathways.PathwaySave.model_validate(body()),
            "admin",
            stale_choices,
        )
    assert error.value.status == 409
    transaction.set.assert_not_called()
    transaction.create.assert_not_called()


def test_service_archive_rechecks_published_pathway_references_in_transaction(
    monkeypatch,
):
    repository = services.FirestoreServiceRepository(Settings(_env_file=None))
    repository._client = Mock()
    reference = repository._client.collection.return_value.document.return_value
    reference.get.return_value = SimpleNamespace(exists=False)
    repository.pathway_repository = Mock()
    repository.pathway_repository.read_in_transaction.return_value = (
        pathways.initial_state(PathwayStore())
    )
    transaction = repository._client.transaction.return_value
    monkeypatch.setattr(services.firestore, "transactional", lambda function: function)
    with pytest.raises(services.ServiceProblem) as error:
        repository.change(
            "cak-consumer-protection",
            services.PublicationChange(expectedRevision=1, publication="archived"),
            "admin",
            set(),
        )
    assert error.value.status == 409
    transaction.set.assert_not_called()
    transaction.create.assert_not_called()
