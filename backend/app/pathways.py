"""Reviewed public pathway guides and read-only, owner-scoped category navigation."""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field, StrictStr, model_validator

from .assessments import (
    AssessmentMissing,
    AssessmentUnavailable,
    StoreDependency,
    UserDependency,
    http_error,
)
from .assessments import (
    Identifier as AssessmentId,
)
from .catalog import (
    AccessStep,
    CatalogDependency,
    CatalogModel,
    CheckedDate,
    Identifier,
    SourceReview,
    Text,
)


class PreparationItem(CatalogModel):
    id: Identifier
    label: Text
    note: Text


class Pathway(CatalogModel):
    id: Identifier
    title: Text
    category: Text
    service_id: Identifier
    overview: Text
    who_may_use: Text
    matters: list[Text] = Field(max_length=10)
    requirements: list[Text] = Field(max_length=10)
    starting_steps: list[AccessStep] = Field(max_length=10)
    next_stages: list[Text] = Field(max_length=10)
    source_review: SourceReview
    preparation: list[PreparationItem] = Field(max_length=15)

    @model_validator(mode="after")
    def unique_preparation(self):
        if len({item.id for item in self.preparation}) != len(self.preparation):
            raise ValueError("Duplicate preparation identifiers")
        return self


class PathwayCatalog(CheckedDate):
    schema_version: Literal[1]
    pathways: list[Pathway] = Field(max_length=30)

    @model_validator(mode="before")
    @classmethod
    def exact_schema(cls, value):
        if isinstance(value, dict) and (
            type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1
        ):
            raise ValueError("Unsupported pathway catalogue")
        return value

    @model_validator(mode="after")
    def unique_and_reviewed(self):
        if len({item.id for item in self.pathways}) != len(self.pathways):
            raise ValueError("Duplicate pathways")
        if any(
            item.source_review.checked_on > self.checked_on for item in self.pathways
        ):
            raise ValueError("Review exceeds catalogue date")
        return self


class PathwayUnavailable(Exception):
    """The bounded public source file cannot be loaded."""


class PathwayStore:
    def __init__(self, path: Path | None = None):
        self.path = (
            path
            if path is not None
            else Path(__file__).with_name("public_pathways.json")
        )

    def load(self) -> PathwayCatalog:
        try:
            if self.path.stat().st_size > 262144:
                raise PathwayUnavailable
            return PathwayCatalog.model_validate_json(
                self.path.read_text(encoding="utf-8")
            )
        except (OSError, ValueError, TypeError) as error:
            raise PathwayUnavailable from error


class PathwayResponse(CatalogModel):
    schema_version: Literal[1] = 1
    pathway: Pathway


class PreparationResponse(CatalogModel):
    schema_version: Literal[1] = 1
    pathway_id: Identifier
    pathway_title: Text
    source_review: SourceReview
    items: list[PreparationItem]


class NavigationItem(CatalogModel):
    pathway: Pathway
    reason: Text


class NavigationResponse(CatalogModel):
    schema_version: Literal[1] = 1
    assessment_id: AssessmentId
    uid: StrictStr
    revision: int = Field(strict=True, ge=1)
    method: Literal["selected-category-v1"] = "selected-category-v1"
    selected_issue: Literal["consumer", "money-debt", "other"]
    checked_on: str
    pathways: list[NavigationItem]


# Editorial navigation order, not scores, probabilities or legal classifications.
CATEGORY_PATHWAYS = {
    "consumer": ("cak-consumer-complaint", "small-claims-information"),
    "money-debt": ("small-claims-information",),
    "other": (),
}
router = APIRouter(prefix="/api/v1", tags=["Pathway guidance"])


def load_pathways(request: Request, catalog) -> PathwayCatalog:
    try:
        result = request.app.state.pathway_store.load()
        known = {service.id for service in catalog.services}
        if any(pathway.service_id not in known for pathway in result.pathways):
            raise PathwayUnavailable
        return result
    except PathwayUnavailable as error:
        raise HTTPException(
            503, "Pathway information is currently unavailable."
        ) from error


def find_pathway(data: PathwayCatalog, identifier: str) -> Pathway:
    for pathway in data.pathways:
        if pathway.id == identifier:
            return pathway
    raise HTTPException(404, "Pathway not found.")


@router.get("/pathways", response_model=PathwayCatalog)
def list_pathways(request: Request, catalog: CatalogDependency):
    return load_pathways(request, catalog)


@router.get("/pathways/{pathway_id}", response_model=PathwayResponse)
def pathway_detail(pathway_id: str, request: Request, catalog: CatalogDependency):
    return PathwayResponse(
        pathway=find_pathway(load_pathways(request, catalog), pathway_id)
    )


@router.get("/pathways/{pathway_id}/preparation", response_model=PreparationResponse)
def preparation(pathway_id: str, request: Request, catalog: CatalogDependency):
    pathway = find_pathway(load_pathways(request, catalog), pathway_id)
    return PreparationResponse(
        pathwayId=pathway.id,
        pathwayTitle=pathway.title,
        sourceReview=pathway.source_review,
        items=pathway.preparation,
    )


@router.get("/assessments/{identifier}/pathways", response_model=NavigationResponse)
def assessment_pathways(
    identifier: AssessmentId,
    user: UserDependency,
    store: StoreDependency,
    request: Request,
    catalog: CatalogDependency,
):
    """Read the owner's saved category; do not analyse text, save or classify a case."""
    try:
        record = store.get(user.uid, identifier)
        if record.uid != user.uid or record.id != identifier:
            raise AssessmentUnavailable
    except (AssessmentMissing, AssessmentUnavailable) as error:
        raise http_error(error) from error
    if record.status != "awaiting-pathways" or not record.answers.complete():
        raise HTTPException(
            409, "Complete and save clarification answers before exploring pathways."
        )
    data = load_pathways(request, catalog)
    by_id = {pathway.id: pathway for pathway in data.pathways}
    ids = CATEGORY_PATHWAYS[record.answers.issue]
    if any(identifier not in by_id for identifier in ids):
        raise HTTPException(503, "Pathway information is currently unavailable.")
    label = {
        "consumer": "Consumer",
        "money-debt": "Money / Debt",
        "other": "Something else",
    }[record.answers.issue]
    return NavigationResponse(
        assessmentId=record.id,
        uid=user.uid,
        revision=record.revision,
        selectedIssue=record.answers.issue,
        checkedOn=data.checked_on.isoformat(),
        pathways=[
            NavigationItem(
                pathway=by_id[item],
                reason=f"You selected {label}. This is a general information link, not a finding about your case.",
            )
            for item in ids
        ],
    )
