"""FastAPI entry point; health is independent of Firebase configuration."""

from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .admin_catalog import router as admin_catalog_router
from .assessments import AssessmentStore, FirestoreAssessmentStore
from .assessments import router as assessment_router
from .audit_logs import FirestoreAuditRepository
from .audit_logs import router as audit_logs_router
from .auth import CurrentUser, FirebaseTokenVerifier, TokenVerifier, get_current_user
from .catalog import CatalogStore
from .catalog import router as catalog_router
from .checklists import ChecklistStore, FirestoreChecklistStore
from .checklists import router as checklist_router
from .config import Settings
from .dashboard import DashboardStore, FirestoreDashboardStore
from .dashboard import router as dashboard_router
from .demo_referrals import FirebaseProviderDirectory, FirestoreDemoReferrals
from .demo_referrals import router as demo_referral_router
from .notifications import FirestoreNotificationStore, NotificationStore
from .notifications import router as notification_router
from .pathway_management import FirestorePathwayRepository, ManagedPathwayStore
from .pathway_management import router as pathway_management_router
from .pathways import PathwayStore
from .pathways import router as pathway_router
from .profiles import FirestoreProfileStore, ProfileStore
from .profiles import router as profile_router
from .referrals import FirestoreReferralStore, ReferralStore
from .referrals import router as referral_router
from .resource_management import (
    FirestoreResourceRepository,
    ManagedResourceCatalogStore,
)
from .resource_management import router as resource_management_router
from .service_management import FirestoreServiceRepository, ManagedCatalogStore
from .service_management import router as service_management_router


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["justicenav-api"] = "justicenav-api"


def create_app(
    settings: Settings | None = None,
    verifier: TokenVerifier | None = None,
    profile_store: ProfileStore | None = None,
    assessment_store: AssessmentStore | None = None,
    catalog_store: CatalogStore | None = None,
    pathway_store: PathwayStore | None = None,
    checklist_store: ChecklistStore | None = None,
    referral_store: ReferralStore | None = None,
    dashboard_store: DashboardStore | None = None,
    notification_store: NotificationStore | None = None,
    demo_referral_store=None,
    demo_provider_directory=None,
    service_repository=None,
    pathway_repository=None,
    resource_repository=None,
    audit_repository=None,
) -> FastAPI:
    """Build an app with explicit settings and replaceable dependencies for tests."""
    settings = settings if settings is not None else Settings()
    app = FastAPI(
        title="JusticeNav KE API",
        version="0.1.0",
        description="Firebase authentication, profiles and private assessment drafts. Health checks process liveness only.",
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.app_env != "production" else None,
    )
    app.state.token_verifier = (
        verifier if verifier is not None else FirebaseTokenVerifier(settings)
    )
    app.state.profile_store = (
        profile_store if profile_store is not None else FirestoreProfileStore(settings)
    )
    app.include_router(profile_router)
    app.state.assessment_store = (
        assessment_store
        if assessment_store is not None
        else FirestoreAssessmentStore(settings)
    )
    app.include_router(assessment_router)
    seed_catalog = catalog_store if catalog_store is not None else CatalogStore()
    app.state.service_repository = (
        service_repository
        if service_repository is not None
        else FirestoreServiceRepository(settings)
    )
    app.state.catalog_store = (
        ManagedCatalogStore(seed_catalog, app.state.service_repository)
        if service_repository is not None
        or (catalog_store is None and settings.firebase_project_id)
        else seed_catalog
    )
    app.state.resource_repository = (
        resource_repository
        if resource_repository is not None
        else FirestoreResourceRepository(settings)
    )
    if resource_repository is not None or (
        catalog_store is None and settings.firebase_project_id
    ):
        app.state.catalog_store = ManagedResourceCatalogStore(
            app.state.catalog_store, app.state.resource_repository
        )
    app.include_router(catalog_router)
    seed_pathways = pathway_store if pathway_store is not None else PathwayStore()
    app.state.pathway_repository = (
        pathway_repository
        if pathway_repository is not None
        else FirestorePathwayRepository(settings, app.state.service_repository)
    )
    managed_pathways = pathway_repository is not None or (
        pathway_store is None and settings.firebase_project_id
    )
    app.state.pathway_store = (
        ManagedPathwayStore(seed_pathways, app.state.pathway_repository)
        if managed_pathways
        else seed_pathways
    )
    if (
        managed_pathways
        and isinstance(app.state.service_repository, FirestoreServiceRepository)
        and isinstance(app.state.pathway_repository, FirestorePathwayRepository)
    ):
        app.state.service_repository.pathway_repository = app.state.pathway_repository
    app.include_router(pathway_router)
    app.state.checklist_store = (
        checklist_store
        if checklist_store is not None
        else FirestoreChecklistStore(settings)
    )
    app.include_router(checklist_router)
    app.state.referral_store = (
        referral_store
        if referral_store is not None
        else FirestoreReferralStore(settings)
    )
    app.include_router(referral_router)
    app.state.dashboard_store = (
        dashboard_store
        if dashboard_store is not None
        else FirestoreDashboardStore(settings)
    )
    app.include_router(dashboard_router)
    app.state.notification_store = (
        notification_store
        if notification_store is not None
        else FirestoreNotificationStore(settings)
    )
    app.include_router(notification_router)
    app.include_router(admin_catalog_router)
    app.include_router(service_management_router)
    app.include_router(pathway_management_router)
    app.include_router(resource_management_router)
    app.state.audit_repository = (
        audit_repository
        if audit_repository is not None
        else FirestoreAuditRepository(settings)
    )
    app.include_router(audit_logs_router)
    app.state.demo_referrals_enabled = settings.app_env in {"development", "test"}
    app.state.demo_referral_store = (
        demo_referral_store
        if demo_referral_store is not None
        else FirestoreDemoReferrals(settings)
    )
    app.state.demo_provider_directory = (
        demo_provider_directory
        if demo_provider_directory is not None
        else FirebaseProviderDirectory(settings)
    )
    app.include_router(demo_referral_router)

    @app.exception_handler(RequestValidationError)
    async def private_profile_validation(
        request: Request, error: RequestValidationError
    ):
        """Do not echo rejected profile values or extra credential fields into API errors."""
        if request.url.path.startswith("/api/v1/admin/audit-logs"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid audit filters or cursor. Reload the first page."
                },
            )
        if request.url.path.startswith("/api/v1/admin/resource-records"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid resource input. Check the categories, official source, review date and saved revision."
                },
            )
        if request.url.path.startswith("/api/v1/admin/pathway-records"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid pathway input. Check the fields, checklist items, source review and saved revision."
                },
            )
        if request.url.path.startswith("/api/v1/admin/service-records"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid service input. Check the fields, source review and saved revision."
                },
            )
        if request.url.path.startswith("/api/v1/demo-referrals"):
            return JSONResponse(
                status_code=422,
                content={"detail": "Invalid demonstration referral input."},
            )
        if request.url.path.startswith("/api/v1/notifications"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid notification input. Check the notification references and filter."
                },
            )
        if request.url.path.startswith("/api/v1/referrals"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid referral input. Check the contact fields, description, acknowledgement and source selection."
                },
            )
        if request.url.path.startswith("/api/v1/checklists"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid checklist input. Check the selected items, template and saved revision."
                },
            )
        if request.url.path.startswith("/api/v1/assessments"):
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid assessment input. Check the description, answers and saved revision."
                },
            )
        if request.url.path == "/api/v1/profile/me":
            return JSONResponse(
                status_code=422,
                content={
                    "detail": "Invalid profile input. Check your name, optional phone number, language and revision."
                },
            )
        return await request_validation_exception_handler(request, error)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=False,
        allow_methods=["GET", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def avoid_identity_caching(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/v1/health", response_model=HealthResponse, tags=["Health"])
    def health() -> HealthResponse:
        """Report process liveness only, without credentials or external requests."""
        return HealthResponse()

    @app.get("/api/v1/auth/me", response_model=CurrentUser, tags=["Authentication"])
    def me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        """Return minimal metadata for the identity verified on this request."""
        return user

    return app


app = create_app()
