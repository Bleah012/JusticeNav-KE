"""Verify Firebase ID tokens and derive roles only from verified claims."""

import os
from collections.abc import Callable, Mapping
from threading import Lock
from typing import Annotated, Literal, Protocol

import firebase_admin
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth, credentials, exceptions
from google.auth.exceptions import GoogleAuthError
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings

Role = Literal["seeker", "provider", "admin"]
ROLES = {"seeker", "provider", "admin"}
_firebase_lock = Lock()
bearer = HTTPBearer(auto_error=False)


class InvalidToken(Exception):
    """The supplied token cannot establish an authenticated identity."""


class VerificationUnavailable(Exception):
    """Configuration or a verification dependency is unavailable."""


class TokenVerifier(Protocol):
    def verify(self, token: str) -> Mapping[str, object]: ...


class CurrentUser(BaseModel):
    model_config = ConfigDict(populate_by_name=True, frozen=True)

    uid: str
    role: Role
    email_verified: bool = Field(alias="emailVerified")


def get_firebase_app(settings: Settings) -> firebase_admin.App:
    """Share lazy, backend-only Firebase initialization across API services."""
    project = settings.firebase_project_id
    # Emulator tokens are unsigned. This foundation has no emulator bypass.
    if not project or os.environ.get("FIREBASE_AUTH_EMULATOR_HOST"):
        raise VerificationUnavailable
    try:
        with _firebase_lock:
            name = f"justicenav-{project}"
            try:
                return firebase_admin.get_app(name)
            except ValueError:
                credential_path = settings.google_application_credentials
                credential = (
                    credentials.Certificate(credential_path)
                    if credential_path
                    else credentials.ApplicationDefault()
                )
                return firebase_admin.initialize_app(
                    credential,
                    options={"projectId": project},
                    name=name,
                )
    except (GoogleAuthError, OSError, ValueError) as exc:
        raise VerificationUnavailable from exc


class FirebaseTokenVerifier:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _get_app(self) -> firebase_admin.App:
        """Initialize the Admin SDK lazily using backend-only credentials."""
        return get_firebase_app(self.settings)

    def verify(self, token: str) -> Mapping[str, object]:
        """Require SDK signature/project/expiry checks and revocation checking."""
        app = self._get_app()
        try:
            return auth.verify_id_token(token, app=app, check_revoked=True)
        except auth.CertificateFetchError as exc:
            raise VerificationUnavailable from exc
        except (
            auth.InvalidIdTokenError,
            auth.RevokedIdTokenError,
            auth.UserDisabledError,
            auth.UserNotFoundError,
            ValueError,
        ) as exc:
            raise InvalidToken from exc
        except (exceptions.FirebaseError, GoogleAuthError) as exc:
            raise VerificationUnavailable from exc


def get_verifier(request: Request) -> TokenVerifier:
    """Use the verifier configured by the application factory, never request input."""
    return request.app.state.token_verifier


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="A valid Firebase ID token is required.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credential: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    verifier: Annotated[TokenVerifier, Depends(get_verifier)],
) -> CurrentUser:
    """Reject missing/invalid tokens and avoid returning claims or credential errors."""
    if credential is None or not credential.credentials.strip():
        raise unauthorized()
    try:
        claims = verifier.verify(credential.credentials)
    except InvalidToken as exc:
        raise unauthorized() from exc
    except VerificationUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication verification is currently unavailable.",
        ) from exc

    uid = claims.get("uid")
    role = claims.get("role", "seeker")
    if not isinstance(uid, str) or not uid.strip() or len(uid) > 128:
        raise unauthorized()
    if not isinstance(role, str) or role not in ROLES:
        raise HTTPException(status_code=403, detail="Account role is not supported.")
    return CurrentUser(
        uid=uid,
        role=role,
        email_verified=claims.get("email_verified") is True,
    )


def require_roles(*roles: Role) -> Callable[..., CurrentUser]:
    """Reusable role gate; resource ownership and provider assignment come later."""
    if not roles or not set(roles).issubset(ROLES):
        raise ValueError("Specify supported allowed roles")

    def check_role(
        user: Annotated[CurrentUser, Depends(get_current_user)],
    ) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="This action is not permitted.")
        return user

    return check_role
