"""Public catalogue checks use local reviewed records and never contact publishers."""

import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.catalog import Catalog, CatalogStore, CatalogUnavailable, official_url
from app.config import Settings
from app.main import create_app

DATA = Path(__file__).parents[1] / "app/public_catalog.json"


def content():
    return json.loads(DATA.read_text(encoding="utf-8"))


def client(store=None, verifier=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=verifier,
            catalog_store=store if store is not None else CatalogStore(DATA),
        )
    )


def test_checked_records_are_real_official_sources_with_consistent_dates():
    data = CatalogStore(DATA).load()
    assert len(data.services) == 3 and len(data.resources) == 6
    assert {service.id for service in data.services} == {
        "small-claims-courts",
        "cak-consumer-protection",
        "nlas-legal-aid",
    }
    assert data.checked_on.isoformat() == "2026-11-02"
    for service in data.services:
        assert service.source_review.checked_on == data.checked_on
        for link in service.source_review.sources:
            assert official_url(link.url) == link.url
    for resource in data.resources:
        assert resource.source.checked_on == data.checked_on
        assert official_url(resource.source.url) == resource.source.url


@pytest.mark.parametrize(
    "path",
    ["/api/v1/services", "/api/v1/services/small-claims-courts", "/api/v1/resources"],
)
@pytest.mark.parametrize("authorization", [None, "Bearer invalid-unused"])
def test_public_reads_need_no_token_and_do_not_call_authentication(path, authorization):
    verifier = Mock()
    verifier.verify.side_effect = AssertionError(
        "Public routes must not verify identity"
    )
    with client(verifier=verifier) as api:
        response = api.get(
            path, headers={"Authorization": authorization} if authorization else {}
        )
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["schemaVersion"] == 1
    verifier.verify.assert_not_called()
    assert "privateKey" not in response.text and "expectedRevision" not in response.text


def test_directory_summaries_exclude_profile_contact_details_and_unknown_fields():
    with client() as api:
        response = api.get("/api/v1/services").json()
    assert len(response["services"]) == 3
    assert response["checkedOn"] == "2026-11-02"
    for service in response["services"]:
        assert set(service) == {
            "id",
            "name",
            "serviceType",
            "location",
            "description",
            "eligibility",
            "accessMethods",
            "deliveryModes",
            "sourceReview",
        }
        assert service["sourceReview"]["sources"]


def test_service_profiles_select_exact_identifier_and_retain_unknowns_as_null():
    with client() as api:
        profile = api.get("/api/v1/services/nlas-legal-aid").json()["service"]
        other = api.get("/api/v1/services/cak-consumer-protection").json()["service"]
        assert api.get("/api/v1/services/not-a-listed-service").status_code == 404
        assert api.get("/api/v1/services/NLAS-LEGAL-AID").status_code == 404
    assert profile["id"] == "nlas-legal-aid"
    assert "debt recovery" in profile["whoMayQualify"]
    assert profile["contact"]["hours"] is None
    assert profile["contact"]["phone"] is None
    assert other["contact"]["email"] == "complain@cak.go.ke"
    assert other["contact"]["hours"] is None


def test_resource_categories_and_source_links_are_available_without_fake_downloads():
    with client() as api:
        resources = api.get("/api/v1/resources").json()["resources"]
    assert len(resources) == 6
    assert set(
        category for resource in resources for category in resource["categories"]
    ) == {"civil", "consumer", "preparation", "self-representation"}
    for resource in resources:
        assert set(resource["source"]) == {"name", "url", "checkedOn"}
        assert "downloadUrl" not in resource


@pytest.mark.parametrize(
    "value",
    [
        "http://www.cak.go.ke/",
        "javascript:alert(1)",
        "https://www.cak.go.ke.evil.invalid/",
        "https://user:pass@www.cak.go.ke/",
        "https://127.0.0.1/",
        "https://www.nlas.go.ke/?token=private-test",
        "https://www.nlas.go.ke/#private-test",
        "https://www.nlas.go.ke:444/",
        "https://www.nlas.go.ke/ ",
        "https://www.nlas.go.ke/\\private",
    ],
)
def test_only_approved_official_https_links_are_accepted(value):
    with pytest.raises(ValueError):
        official_url(value)


@pytest.mark.parametrize(
    "change",
    [
        "duplicate-service",
        "duplicate-resource",
        "bad-category",
        "duplicate-category",
        "unsafe-source",
        "bad-date",
        "future-record",
        "extra-private-field",
        "boolean-version",
        "unknown-version",
    ],
)
def test_invalid_or_ambiguous_catalogue_is_rejected(change):
    data = content()
    if change == "duplicate-service":
        data["services"].append(data["services"][0])
    elif change == "duplicate-resource":
        data["resources"].append(data["resources"][0])
    elif change == "bad-category":
        data["resources"][0]["categories"] = ["invented"]
    elif change == "duplicate-category":
        data["resources"][0]["categories"] = ["civil", "civil"]
    elif change == "unsafe-source":
        data["services"][0]["sourceReview"]["sources"][0]["url"] = (
            "https://untrusted.invalid/"
        )
    elif change == "bad-date":
        data["services"][0]["sourceReview"]["checkedOn"] = "2026-02-31"
    elif change == "future-record":
        data["resources"][0]["source"]["checkedOn"] = "2026-12-01"
    elif change == "extra-private-field":
        data["services"][0]["internalNotes"] = "private-test-only"
    elif change == "boolean-version":
        data["schemaVersion"] = True
    else:
        data["schemaVersion"] = 2
    with pytest.raises(ValidationError):
        Catalog.model_validate(data)


def test_empty_published_catalogue_is_an_explicit_success_not_unavailable(tmp_path):
    target = tmp_path / "public.json"
    target.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "checkedOn": "2026-11-02",
                "services": [],
                "resources": [],
            }
        )
    )
    with client(CatalogStore(target)) as api:
        assert api.get("/api/v1/services").json()["services"] == []


@pytest.mark.parametrize("kind", ["missing", "malformed", "oversized"])
def test_unavailable_catalogue_is_503_without_paths_or_raw_contents(tmp_path, kind):
    target = tmp_path / "private-server-file.json"
    if kind == "malformed":
        target.write_text("not-json private-test-only")
    if kind == "oversized":
        target.write_text(" " * 262145)
    with client(CatalogStore(target)) as api:
        response = api.get("/api/v1/services")
        assert response.status_code == 503
        assert response.json() == {
            "detail": "Public catalogue information is currently unavailable."
        }
        assert "private" not in response.text
        assert api.get("/api/v1/health").status_code == 200


def test_missing_catalogue_does_not_return_a_false_404_for_a_possible_service(tmp_path):
    with client(CatalogStore(tmp_path / "missing.json")) as api:
        assert api.get("/api/v1/services/small-claims-courts").status_code == 503


@pytest.mark.parametrize(
    "path", ["/api/v1/services", "/api/v1/services/nlas-legal-aid", "/api/v1/resources"]
)
def test_catalogue_routes_are_read_only(path):
    with client() as api:
        assert api.post(path, json={}).status_code == 405
        assert api.put(path, json={}).status_code == 405
        assert api.delete(path).status_code == 405


def test_public_catalogue_retains_configured_origin_cors_policy():
    with client() as api:
        for origin, expected in [
            ("http://localhost:5173", 200),
            ("https://untrusted.invalid", 400),
        ]:
            response = api.options(
                "/api/v1/services",
                headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
            )
            assert response.status_code == expected


def test_catalogue_loader_failure_uses_generic_unavailability():
    store = Mock()
    store.load.side_effect = CatalogUnavailable("private-server-details")
    with client(store) as api:
        response = api.get("/api/v1/resources")
    assert response.status_code == 503 and "private-server-details" not in response.text
