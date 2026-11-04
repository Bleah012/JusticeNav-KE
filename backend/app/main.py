"""FastAPI entry point; health is independent of Firebase configuration."""

from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .assessments import AssessmentStore, FirestoreAssessmentStore
from .assessments import router as assessment_router
from .auth import CurrentUser, FirebaseTokenVerifier, TokenVerifier, get_current_user
from .catalog import CatalogStore
from .catalog import router as catalog_router
from .checklists import ChecklistStore, FirestoreChecklistStore
from .checklists import router as checklist_router
from .config import Settings
from .pathways import PathwayStore
from .pathways import router as pathway_router
from .profiles import FirestoreProfileStore, ProfileStore
from .profiles import router as profile_router
from .referrals import FirestoreReferralStore, ReferralStore
from .referrals import router as referral_router


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
    app.state.catalog_store = (
        catalog_store if catalog_store is not None else CatalogStore()
    )
    app.include_router(catalog_router)
    app.state.pathway_store = (
        pathway_store if pathway_store is not None else PathwayStore()
    )
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

    @app.exception_handler(RequestValidationError)
    async def private_profile_validation(
        request: Request, error: RequestValidationError
    ):
        """Do not echo rejected profile values or extra credential fields into API errors."""
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
        allow_methods=["GET", "PUT"],
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
