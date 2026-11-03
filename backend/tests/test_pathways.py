"""Pathway provenance, fixed category mapping and ownership; no live Firebase calls."""

import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.assessments import (
    Answers,
    AssessmentMissing,
    AssessmentUnavailable,
    ClarificationUpdate,
    DescriptionUpdate,
    next_record,
)
from app.auth import InvalidToken
from app.config import Settings
from app.main import create_app
from app.pathways import PathwayCatalog, PathwayStore, PathwayUnavailable

DATA = Path(__file__).parents[1] / "app/public_pathways.json"
ID = "a" * 32
URL = f"/api/v1/assessments/{ID}/pathways"


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        return {"uid": token}


def record(issue="consumer", complete=True):
    previous = next_record(
        "owner",
        ID,
        None,
        DescriptionUpdate(
            step="describe",
            description="PRIVATE_DESCRIPTION_SENTINEL",
            proceed=True,
            expectedRevision=0,
        ),
    )
    return next_record(
        "owner",
        ID,
        previous,
        ClarificationUpdate(
            step="clarify",
            answers=Answers(
                issue=issue, timeframe="recent" if complete else None, contact="no"
            ),
            proceed=complete,
            expectedRevision=1,
        ),
    )


def client(store=None, pathways=None, verifier=None):
    return TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=verifier or Verifier(),
            assessment_store=store or Mock(),
            pathway_store=pathways or PathwayStore(DATA),
        )
    )


def owned_store(value):
    store = Mock()

    def get(uid, identifier):
        if uid != value.uid or identifier != value.id:
            raise AssessmentMissing
        return value

    store.get.side_effect = get
    return store


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/pathways",
        "/api/v1/pathways/cak-consumer-complaint",
        "/api/v1/pathways/cak-consumer-complaint/preparation",
    ],
)
def test_public_guides_do_not_verify_identity_or_access_private_storage(path):
    verifier, store = Mock(), Mock()
    with client(store=store, verifier=verifier) as api:
        result = api.get(path, headers={"Authorization": "Bearer ignored"})
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "no-store"
    verifier.verify.assert_not_called()
    assert not store.mock_calls
    assert "uid" not in result.json()


@pytest.mark.parametrize(
    "issue,ids",
    [
        ("consumer", ["cak-consumer-complaint", "small-claims-information"]),
        ("money-debt", ["small-claims-information"]),
        ("other", []),
    ],
)
def test_mapping_uses_saved_category_and_never_creates_or_updates_records(issue, ids):
    saved = record(issue)
    store = owned_store(saved)
    with client(store=store) as api:
        result = api.get(URL, headers={"Authorization": "Bearer owner"})
    assert result.status_code == 200
    body = result.json()
    assert body["method"] == "selected-category-v1"
    assert body["uid"] == "owner" and body["assessmentId"] == ID
    assert body["revision"] == saved.revision
    assert [item["pathway"]["id"] for item in body["pathways"]] == ids
    assert "PRIVATE_DESCRIPTION_SENTINEL" not in result.text
    assert "timeframe" not in result.text and "contact" not in body
    store.get.assert_called_once_with("owner", ID)
    store.save.assert_not_called()
    store.list.assert_not_called()


def test_description_timeframe_and_contact_do_not_classify_or_rank():
    saved = record()
    store = owned_store(saved)
    with client(store=store) as api:
        first = api.get(URL, headers={"Authorization": "Bearer owner"}).json()
        saved.description = (
            "An unrelated narrative must not change selected category links."
        )
        saved.answers.timeframe = "older"
        saved.answers.contact = "yes"
        second = api.get(
            URL + "?issue=money-debt&uid=other",
            headers={"Authorization": "Bearer owner"},
        ).json()
    assert first == second


@pytest.mark.parametrize(
    "authorization,expected",
    [(None, 401), ("Bearer invalid", 401), ("Bearer other", 404)],
)
def test_no_cross_account_results(authorization, expected):
    store = owned_store(record())
    with client(store=store) as api:
        response = api.get(
            URL, headers={"Authorization": authorization} if authorization else {}
        )
    assert response.status_code == expected
    assert "PRIVATE_DESCRIPTION_SENTINEL" not in response.text
    store.save.assert_not_called()


def test_foreign_record_returned_by_store_is_never_serialized():
    store = Mock()
    foreign = record()
    foreign.uid = "foreign"
    store.get.return_value = foreign
    with client(store=store) as api:
        response = api.get(URL, headers={"Authorization": "Bearer owner"})
    assert response.status_code == 503
    assert "foreign" not in response.text


@pytest.mark.parametrize(
    "failure,expected", [(AssessmentMissing, 404), (AssessmentUnavailable, 503)]
)
def test_storage_failure_does_not_become_empty_results(failure, expected):
    store = Mock()
    store.get.side_effect = failure
    with client(store=store) as api:
        response = api.get(URL, headers={"Authorization": "Bearer owner"})
    assert response.status_code == expected
    assert "pathways" not in response.json()


def test_partial_answers_require_completion_without_writing():
    store = owned_store(record(complete=False))
    with client(store=store) as api:
        response = api.get(URL, headers={"Authorization": "Bearer owner"})
    assert response.status_code == 409
    store.save.assert_not_called()


@pytest.mark.parametrize("identifier", ["bad", "b" * 31, "B" * 32, "g" * 32])
def test_invalid_assessment_ids_never_access_storage(identifier):
    store = Mock()
    with client(store=store) as api:
        response = api.get(
            f"/api/v1/assessments/{identifier}/pathways",
            headers={"Authorization": "Bearer owner"},
        )
    assert response.status_code == 422
    assert not store.mock_calls


@pytest.mark.parametrize("suffix", ["", "/preparation"])
def test_unknown_public_pathway_is_404(suffix):
    with client() as api:
        assert api.get("/api/v1/pathways/not-listed" + suffix).status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/pathways",
        "/api/v1/pathways/not-listed",
        "/api/v1/pathways/not-listed/preparation",
        URL,
    ],
)
def test_bad_catalogue_is_503_not_empty_or_404(path):
    pathways = Mock()
    pathways.load.side_effect = PathwayUnavailable
    with client(store=owned_store(record()), pathways=pathways) as api:
        response = api.get(path, headers={"Authorization": "Bearer owner"})
    assert response.status_code == 503


@pytest.mark.parametrize(
    "mutation",
    [
        "duplicate",
        "duplicate-item",
        "unsafe-source",
        "wrong-host",
        "future-review",
        "version-bool",
        "version-two",
        "extra-claim",
    ],
)
def test_malformed_published_records_are_rejected(mutation):
    data = json.loads(DATA.read_text(encoding="utf-8"))
    first = data["pathways"][0]
    if mutation == "duplicate":
        data["pathways"].append(first)
    if mutation == "duplicate-item":
        first["preparation"].append(first["preparation"][0])
    if mutation == "unsafe-source":
        first["sourceReview"]["sources"][0]["url"] = "javascript:alert(1)"
    if mutation == "wrong-host":
        first["sourceReview"]["sources"][0]["url"] = (
            "https://cak.go.ke.untrusted.invalid/"
        )
    if mutation == "future-review":
        first["sourceReview"]["checkedOn"] = "2099-01-01"
    if mutation == "version-bool":
        data["schemaVersion"] = True
    if mutation == "version-two":
        data["schemaVersion"] = 2
    if mutation == "extra-claim":
        first["guaranteedEligible"] = True
    with pytest.raises(ValidationError):
        PathwayCatalog.model_validate(data)


def test_missing_oversized_or_invalid_file_is_unavailable(tmp_path):
    path = tmp_path / "pathways.json"
    for content in [None, "not-json", " " * 262145]:
        if content is not None:
            path.write_text(content, encoding="utf-8")
        with pytest.raises(PathwayUnavailable):
            PathwayStore(path).load()


def test_dangling_service_reference_is_not_published():
    data = PathwayStore(DATA).load()
    data.pathways[0].service_id = "unknown-service"
    pathways = Mock()
    pathways.load.return_value = data
    with client(pathways=pathways) as api:
        assert api.get("/api/v1/pathways").status_code == 503


def test_removed_mapped_pathway_causes_unavailable_not_silent_partial_results():
    data = PathwayStore(DATA).load()
    data.pathways = []
    pathways = Mock()
    pathways.load.return_value = data
    with client(store=owned_store(record()), pathways=pathways) as api:
        assert (
            api.get(URL, headers={"Authorization": "Bearer owner"}).status_code == 503
        )


def test_empty_catalogue_is_valid_and_nlas_is_browse_only():
    data = PathwayStore(DATA).load()
    nlas = next(
        item for item in data.pathways if item.id == "nlas-application-information"
    )
    assert "debt recovery" in nlas.who_may_use
    assert all(
        item.source_review.checked_on.isoformat() == "2026-11-03"
        for item in data.pathways
    )
    data.pathways = []
    pathways = Mock()
    pathways.load.return_value = data
    with client(pathways=pathways) as api:
        assert api.get("/api/v1/pathways").json()["pathways"] == []
