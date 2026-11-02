"""Public, source-backed catalogue reads; no authentication or Firestore writes."""

import re
from datetime import date
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictStr,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

OFFICIAL_HOSTS = frozenset(
    {
        "judiciary.go.ke",
        "www.judiciary.go.ke",
        "cak.go.ke",
        "www.cak.go.ke",
        "nlas.go.ke",
        "www.nlas.go.ke",
    }
)
Identifier = Annotated[
    StrictStr, Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=3, max_length=64)
]
Text = Annotated[StrictStr, Field(min_length=1, max_length=2000)]
Category = Literal["preparation", "self-representation", "consumer", "civil"]


def official_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in OFFICIAL_HOSTS
        or parsed.username
        or parsed.password
        or parsed.port is not None
        or "?" in value
        or "#" in value
        or any(char.isspace() for char in value)
        or "\\" in value
    ):
        raise ValueError("An approved official HTTPS source URL is required")
    return value


SourceUrl = Annotated[StrictStr, Field(max_length=2048), AfterValidator(official_url)]


class CatalogModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid"
    )


class SourceLink(CatalogModel):
    name: Text
    url: SourceUrl


class CheckedDate(CatalogModel):
    checked_on: date

    @field_validator("checked_on", mode="before")
    @classmethod
    def iso_date_only(cls, value):
        if isinstance(value, date):
            return value
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Use an ISO calendar date")
        return value


class SourceReview(CheckedDate):
    sources: list[SourceLink] = Field(min_length=1, max_length=8)


class DirectoryService(CatalogModel):
    id: Identifier
    name: Text
    service_type: Text
    location: Text
    description: Text
    eligibility: Text | None
    access_methods: list[Text] = Field(max_length=10)
    delivery_modes: list[Text] = Field(max_length=5)
    source_review: SourceReview


class AccessStep(CatalogModel):
    title: Text
    description: Text | None


class Contact(CatalogModel):
    access: Text | None
    coverage: Text | None
    hours: Text | None
    address: Text | None
    phone: Text | None
    email: Text | None


class ServiceProfile(DirectoryService):
    about: Text | None
    offered_services: list[Text] = Field(max_length=15)
    who_may_qualify: Text | None
    access_steps: list[AccessStep] = Field(max_length=10)
    official_website: SourceUrl
    contact: Contact


class ResourceSource(CheckedDate, SourceLink):
    pass


class ResourceItem(CatalogModel):
    id: Identifier
    title: Text
    description: Text
    categories: list[Category] = Field(min_length=1, max_length=4)
    source: ResourceSource

    @field_validator("categories")
    @classmethod
    def unique_categories(cls, values):
        if len(set(values)) != len(values):
            raise ValueError("Duplicate categories")
        return values


class Catalog(CheckedDate):
    schema_version: Literal[1]
    checked_on: date
    services: list[ServiceProfile] = Field(max_length=50)
    resources: list[ResourceItem] = Field(max_length=100)

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_schema_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError("Unsupported catalogue schema")
        return value

    @model_validator(mode="after")
    def unique_records_and_review_dates(self):
        for records in (self.services, self.resources):
            if len({record.id for record in records}) != len(records):
                raise ValueError("Duplicate catalogue identifiers")
        if any(
            service.source_review.checked_on > self.checked_on
            for service in self.services
        ) or any(
            resource.source.checked_on > self.checked_on for resource in self.resources
        ):
            raise ValueError("Record check date exceeds catalogue check date")
        return self


class DirectoryResponse(CatalogModel):
    schema_version: Literal[1] = 1
    checked_on: date
    services: list[DirectoryService]


class ServiceResponse(CatalogModel):
    schema_version: Literal[1] = 1
    service: ServiceProfile


class ResourcesResponse(CatalogModel):
    schema_version: Literal[1] = 1
    checked_on: date
    resources: list[ResourceItem]


class CatalogUnavailable(Exception):
    """The published catalogue is missing, malformed or exceeds its bounded size."""


class CatalogStore:
    def __init__(self, path: Path | None = None):
        self.path = (
            path
            if path is not None
            else Path(__file__).with_name("public_catalog.json")
        )

    def load(self) -> Catalog:
        try:
            if self.path.stat().st_size > 262144:
                raise CatalogUnavailable
            return Catalog.model_validate_json(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError) as error:
            raise CatalogUnavailable from error


def get_catalog(request: Request) -> Catalog:
    try:
        return request.app.state.catalog_store.load()
    except CatalogUnavailable as error:
        raise HTTPException(
            503, "Public catalogue information is currently unavailable."
        ) from error


CatalogDependency = Annotated[Catalog, Depends(get_catalog)]
router = APIRouter(prefix="/api/v1", tags=["Public catalogue"])


@router.get("/services", response_model=DirectoryResponse)
def list_services(catalog: CatalogDependency):
    """Return the complete bounded public directory; personal data and tokens are not needed."""
    summaries = [
        DirectoryService.model_validate(
            service.model_dump(
                include=set(DirectoryService.model_fields), by_alias=True
            )
        )
        for service in catalog.services
    ]
    return DirectoryResponse(checked_on=catalog.checked_on, services=summaries)


@router.get("/services/{service_id}", response_model=ServiceResponse)
def get_service(service_id: str, catalog: CatalogDependency):
    for service in catalog.services:
        if service.id == service_id:
            return ServiceResponse(service=service)
    raise HTTPException(404, "Service not found.")


@router.get("/resources", response_model=ResourcesResponse)
def list_resources(catalog: CatalogDependency):
    return ResourcesResponse(checked_on=catalog.checked_on, resources=catalog.resources)
