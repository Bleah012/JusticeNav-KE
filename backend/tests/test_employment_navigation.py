"""Employment navigation uses explicit saved answers and existing owner boundaries."""

from fastapi.testclient import TestClient
from test_assessments import MemoryStore as Assessments
from test_assessments import Verifier, clarification, description
from test_checklists import MemoryStore as Checklists
from test_referrals import MemoryStore as Referrals
from test_referrals import body as referral_body

from app.checklists import make_template
from app.config import Settings
from app.main import create_app
from app.pathways import PathwayStore

ID = "a" * 32
HEADERS = {"Authorization": "Bearer owner"}
PATHWAY = "employment-dispute-information"


def test_employment_assessment_preparation_and_private_referral_survive_reload():
    assessments, checklists, referrals = Assessments(), Checklists(), Referrals()
    app = create_app(
        Settings(_env_file=None),
        verifier=Verifier(),
        assessment_store=assessments,
        checklist_store=checklists,
        referral_store=referrals,
    )
    with TestClient(app) as api:
        path = f"/api/v1/assessments/{ID}"
        result = api.put(
            path,
            headers=HEADERS,
            json=description(
                description="My employer has not paid my salary for two months despite my scheduled work.",
                proceed=True,
            ),
        )
        assert result.status_code == 200
        suggestion = api.get(
            path + "/issue-suggestion", params={"revision": 1}, headers=HEADERS
        )
        assert (
            suggestion.status_code == 200 and suggestion.json()["issue"] == "employment"
        )
        # Suggestion alone must not select or save an answer.
        assert (
            api.get(path, headers=HEADERS).json()["assessment"]["answers"]["issue"]
            is None
        )
        result = api.put(
            path,
            headers=HEADERS,
            json=clarification(
                answers={"issue": "employment", "timeframe": "months", "contact": "yes"}
            ),
        )
        assert result.status_code == 200
        navigation = api.get(path + "/pathways", headers=HEADERS).json()
        assert navigation["selectedIssue"] == "employment"
        assert [row["pathway"]["id"] for row in navigation["pathways"]] == [PATHWAY]
        assert "salary for two" not in str(navigation)
        pathway = next(
            row for row in PathwayStore().load().pathways if row.id == PATHWAY
        )
        template = make_template(pathway)
        result = api.put(
            f"/api/v1/checklists/{ID}",
            headers=HEADERS,
            json={
                "pathwayId": PATHWAY,
                "templateVersion": template.template_version,
                "checkedIds": [template.items[0].id, template.items[1].id],
                "expectedRevision": 0,
            },
        )
        assert result.status_code == 200
        loaded = api.get(f"/api/v1/checklists/{ID}", headers=HEADERS).json()[
            "checklist"
        ]
        assert set(loaded["checkedIds"]) == {template.items[0].id, template.items[1].id}
        selection = api.get(f"/api/v1/referrals/selection/{PATHWAY}", headers=HEADERS)
        assert selection.status_code == 200
        source = selection.json()
        result = api.put(
            f"/api/v1/referrals/{ID}",
            headers=HEADERS,
            json=referral_body(
                pathwayId=PATHWAY,
                serviceId=pathway.service_id,
                selectionVersion=source["selectionVersion"],
            ),
        )
        assert result.status_code == 200
        saved = api.get(f"/api/v1/referrals/{ID}", headers=HEADERS).json()["referral"]
        assert (
            saved["selection"]["service"]["id"] == "employment-labour-relations-court"
        )
        assert saved["selection"]["pathway"]["id"] == PATHWAY
        assert (
            api.get(path, headers={"Authorization": "Bearer another"}).status_code
            == 404
        )


def test_legacy_other_stays_other_until_the_owner_explicitly_reselects():
    assessments = Assessments()
    with TestClient(
        create_app(
            Settings(_env_file=None), verifier=Verifier(), assessment_store=assessments
        )
    ) as api:
        path = f"/api/v1/assessments/{ID}"
        api.put(
            path,
            headers=HEADERS,
            json=description(
                description="My employer dismissed me from my job.", proceed=True
            ),
        )
        api.put(
            path,
            headers=HEADERS,
            json=clarification(
                answers={"issue": "other", "timeframe": "recent", "contact": "no"}
            ),
        )
        before = api.get(path, headers=HEADERS).json()["assessment"]
        assert (
            api.get(
                path + "/issue-suggestion", params={"revision": 2}, headers=HEADERS
            ).json()["issue"]
            == "employment"
        )
        after = api.get(path, headers=HEADERS).json()["assessment"]
        assert after == before and after["answers"]["issue"] == "other"
        assert api.get(path + "/pathways", headers=HEADERS).json()["pathways"] == []
        result = api.put(
            path,
            headers=HEADERS,
            json=clarification(
                expectedRevision=2,
                answers={"issue": "employment", "timeframe": "recent", "contact": "no"},
            ),
        )
        assert result.status_code == 200
        assert (
            api.get(path + "/pathways", headers=HEADERS).json()["selectedIssue"]
            == "employment"
        )
