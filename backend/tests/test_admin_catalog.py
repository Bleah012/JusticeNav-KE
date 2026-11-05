"""Administrative catalogue authorization and exact public-data projections."""

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.auth import InvalidToken, VerificationUnavailable
from app.catalog import CatalogStore, CatalogUnavailable
from app.config import Settings
from app.main import create_app
from app.pathways import PathwayStore, PathwayUnavailable

BASE = "/api/v1/admin/"


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        if token == "unavailable":
            raise VerificationUnavailable
        if token == "default":
            return {"uid": "unit-user"}
        return {"uid": "unit-user", "role": token}


def client(catalog=None, pathways=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            catalog_store=catalog if catalog is not None else CatalogStore(),
            pathway_store=pathways if pathways is not None else PathwayStore(),
        )
    )


def headers(role="admin"):
    return {"Authorization": f"Bearer {role}"}


@pytest.mark.parametrize("page", ["overview", "services", "pathways"])
@pytest.mark.parametrize(
    "role,status",
    [
        (None, 401),
        ("invalid", 401),
        ("unavailable", 503),
        ("seeker", 403),
        ("provider", 403),
        ("default", 403),
        ("unknown", 403),
    ],
)
def test_authorization_precedes_loading_catalogues(page, role, status):
    catalog, pathways = Mock(), Mock()
    with client(catalog, pathways) as api:
        response = api.get(BASE + page, headers=headers(role) if role else {})
    assert response.status_code == status
    catalog.load.assert_not_called()
    pathways.load.assert_not_called()


def test_overview_counts_exact_published_catalogue_rows_and_omits_private_metrics():
    catalog, pathways = CatalogStore().load(), PathwayStore().load()
    with client() as api:
        response = api.get(BASE + "overview", headers=headers())
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "schemaVersion": 1,
        "uid": "unit-user",
        "role": "admin",
        "readOnly": True,
        "services": len(catalog.services),
        "pathways": len(pathways.pathways),
        "resources": len(catalog.resources),
        "catalogCheckedOn": catalog.checked_on.isoformat(),
        "pathwaysCheckedOn": pathways.checked_on.isoformat(),
    }


def test_service_projection_has_official_sources_and_no_profile_contacts_or_edit_metadata():
    expected = CatalogStore().load()
    with client() as api:
        response = api.get(BASE + "services", headers=headers())
    assert response.status_code == 200
    data = response.json()
    assert data["readOnly"] is True and data["uid"] == "unit-user"
    assert len(data["services"]) == len(expected.services)
    for row, source in zip(data["services"], expected.services, strict=True):
        assert row["id"] == source.id
        assert row["sourceReview"] == source.source_review.model_dump(
            mode="json", by_alias=True
        )
        assert not {
            "contact",
            "email",
            "phone",
            "verificationNote",
            "ownerUid",
            "role",
        }.intersection(row)
    assert response.headers["cache-control"] == "no-store"


def test_pathway_projection_preserves_real_links_preparation_and_known_services():
    expected = PathwayStore().load()
    with client() as api:
        data = api.get(BASE + "pathways", headers=headers()).json()
    assert (
        data["pathways"] == expected.model_dump(mode="json", by_alias=True)["pathways"]
    )
    assert all(row["serviceId"] in data["serviceIds"] for row in data["pathways"])
    assert data["role"] == "admin" and data["readOnly"] is True


@pytest.mark.parametrize("page", ["overview", "services", "pathways"])
def test_empty_valid_catalogues_return_confirmed_zero_or_empty_lists(page):
    catalog = CatalogStore().load().model_copy(update={"services": [], "resources": []})
    pathways = PathwayStore().load().model_copy(update={"pathways": []})
    with client(
        Mock(load=Mock(return_value=catalog)), Mock(load=Mock(return_value=pathways))
    ) as api:
        result = api.get(BASE + page, headers=headers())
    assert result.status_code == 200
    data = result.json()
    if page == "overview":
        assert data["services"] == data["pathways"] == data["resources"] == 0
    else:
        assert data[page] == []


@pytest.mark.parametrize("page", ["overview", "services", "pathways"])
def test_catalogue_failure_is_generic_unavailable_not_empty_success(page):
    broken = Mock(load=Mock(side_effect=CatalogUnavailable("PRIVATE diagnostic")))
    with client(broken) as api:
        result = api.get(BASE + page, headers=headers())
    assert result.status_code == 503 and "PRIVATE" not in result.text


@pytest.mark.parametrize("page", ["overview", "pathways"])
def test_missing_pathway_source_or_foreign_service_reference_fails_closed(page):
    foreign = PathwayStore().load()
    foreign.pathways[0].service_id = "missing-service"
    for store in [
        Mock(load=Mock(side_effect=PathwayUnavailable("PRIVATE"))),
        Mock(load=Mock(return_value=foreign)),
    ]:
        with client(pathways=store) as api:
            result = api.get(BASE + page, headers=headers())
        assert result.status_code == 503 and "PRIVATE" not in result.text


def test_services_are_independent_of_unavailable_pathways():
    broken = Mock(load=Mock(side_effect=PathwayUnavailable()))
    with client(pathways=broken) as api:
        assert api.get(BASE + "services", headers=headers()).status_code == 200
    broken.load.assert_not_called()


@pytest.mark.parametrize("method", ["put", "post", "delete", "patch"])
@pytest.mark.parametrize("page", ["overview", "services", "pathways"])
def test_catalogue_endpoints_do_not_accept_writes(method, page):
    catalog, pathways = Mock(), Mock()
    with client(catalog, pathways) as api:
        response = getattr(api, method)(BASE + page, headers=headers())
    assert response.status_code == 405
    catalog.load.assert_not_called()
    pathways.load.assert_not_called()


def test_spoofed_query_role_or_uid_cannot_upgrade_seeker_access():
    catalog = Mock()
    with client(catalog) as api:
        response = api.get(
            BASE + "services?role=admin&uid=another-account", headers=headers("seeker")
        )
    assert response.status_code == 403 and not catalog.load.called


def test_admin_reads_do_not_initialize_firebase_or_firestore(monkeypatch):
    import app.auth as authentication

    blocked = Mock(side_effect=AssertionError("Unexpected Firebase initialization"))
    monkeypatch.setattr(authentication, "get_firebase_app", blocked)
    with client() as api:
        for page in ["overview", "services", "pathways"]:
            assert api.get(BASE + page, headers=headers()).status_code == 200
    blocked.assert_not_called()
