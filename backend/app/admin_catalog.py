"""Admin-only, read-only projections of the existing published source files."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field, StrictInt, StrictStr

from .auth import CurrentUser, require_roles
from .catalog import CatalogModel, CatalogUnavailable, DirectoryService
from .pathways import Pathway, PathwayUnavailable

AdminDependency = Annotated[CurrentUser, Depends(require_roles("admin"))]
router = APIRouter(prefix="/api/v1/admin", tags=["Administrative catalogue reads"])


class AdminEnvelope(CatalogModel):
    schema_version: Literal[1] = 1
    uid: StrictStr = Field(min_length=1, max_length=128)
    role: Literal["admin"] = "admin"
    read_only: Literal[True] = True


class Overview(AdminEnvelope):
    services: StrictInt = Field(ge=0, le=50)
    pathways: StrictInt = Field(ge=0, le=30)
    resources: StrictInt = Field(ge=0, le=100)
    catalog_checked_on: str
    pathways_checked_on: str


class Services(AdminEnvelope):
    checked_on: str
    services: list[DirectoryService] = Field(max_length=50)


class Pathways(AdminEnvelope):
    checked_on: str
    pathways: list[Pathway] = Field(max_length=30)
    service_ids: list[str] = Field(max_length=50)


def load_catalog(request):
    try:
        return request.app.state.catalog_store.load()
    except CatalogUnavailable as error:
        raise HTTPException(
            503, "Administrative catalogue information is currently unavailable."
        ) from error


def load_pathways(request, catalog):
    try:
        data = request.app.state.pathway_store.load()
        known = {item.id for item in catalog.services}
        if any(item.service_id not in known for item in data.pathways):
            raise PathwayUnavailable
        return data
    except PathwayUnavailable as error:
        raise HTTPException(
            503, "Administrative pathway information is currently unavailable."
        ) from error


@router.get("/overview", response_model=Overview)
def overview(user: AdminDependency, request: Request):
    # Authorization completes before loading either file or deriving totals.
    catalog = load_catalog(request)
    pathways = load_pathways(request, catalog)
    return Overview(
        uid=user.uid,
        services=len(catalog.services),
        pathways=len(pathways.pathways),
        resources=len(catalog.resources),
        catalogCheckedOn=catalog.checked_on.isoformat(),
        pathwaysCheckedOn=pathways.checked_on.isoformat(),
    )


@router.get("/services", response_model=Services)
def services(user: AdminDependency, request: Request):
    catalog = load_catalog(request)
    return Services(
        uid=user.uid,
        checkedOn=catalog.checked_on.isoformat(),
        services=[
            DirectoryService.model_validate(
                item.model_dump(
                    include=set(DirectoryService.model_fields), by_alias=True
                )
            )
            for item in catalog.services
        ],
    )


@router.get("/pathways", response_model=Pathways)
def pathways(user: AdminDependency, request: Request):
    catalog = load_catalog(request)
    data = load_pathways(request, catalog)
    return Pathways(
        uid=user.uid,
        checkedOn=data.checked_on.isoformat(),
        pathways=data.pathways,
        serviceIds=[item.id for item in catalog.services],
    )
