"""Exercise HTTP authentication boundaries without creating accounts or records."""

from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import (
    CurrentUser,
    InvalidToken,
    VerificationUnavailable,
    require_roles,
)
from app.config import Settings
from app.main import create_app


class ClaimsVerifier:
    """Test-only identity fixture; it is never selected by runtime configuration."""

    def __init__(self, claims=None, error=None):
        self.claims = claims if claims is not None else {"uid": "unit-user"}
        self.error = error
        self.calls = []

    def verify(self, token):
        self.calls.append(token)
        if self.error:
            raise self.error
        return self.claims


def make_client(verifier=None):
    settings = Settings(_env_file=None)
    return TestClient(create_app(settings, verifier))


def test_health_does_not_verify_a_token():
    verifier = ClaimsVerifier(error=AssertionError("must not contact Firebase"))
    with make_client(verifier) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "justicenav-api"}
        assert verifier.calls == []


@pytest.mark.parametrize("authorization", [None, "Basic not-a-token", "Bearer "])
def test_missing_bearer_is_401(authorization):
    verifier = ClaimsVerifier()
    with make_client(verifier) as client:
        headers = {"Authorization": authorization} if authorization else {}
        response = client.get("/api/v1/auth/me", headers=headers)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert response.headers["cache-control"] == "no-store"
        assert verifier.calls == []


def test_query_parameters_and_headers_cannot_grant_identity_or_role():
    with make_client(ClaimsVerifier()) as client:
        response = client.get(
            "/api/v1/auth/me?token=untrusted&role=admin",
            headers={"X-User-Id": "untrusted", "X-Role": "admin"},
        )
        assert response.status_code == 401


def test_unconfigured_firebase_returns_503_for_a_bearer_request():
    with make_client() as client:
        response = client.get(
            "/api/v1/auth/me", headers={"Authorization": "Bearer unit-token"}
        )
        assert response.status_code == 503
        assert response.json() == {
            "detail": "Authentication verification is currently unavailable."
        }


@pytest.mark.parametrize(
    ("error", "code"),
    [(InvalidToken(), 401), (VerificationUnavailable(), 503)],
)
def test_verification_errors_do_not_leak_token_or_internal_details(error, code):
    with make_client(ClaimsVerifier(error=error)) as client:
        response = client.get(
            "/api/v1/auth/me", headers={"Authorization": "Bearer unit-private-value"}
        )
        assert response.status_code == code
        assert "unit-private-value" not in response.text


def test_me_returns_minimal_camel_case_identity_and_defaults_to_seeker():
    verifier = ClaimsVerifier(
        {"uid": "unit-user", "email_verified": True, "email": "unused@example.invalid"}
    )
    with make_client(verifier) as client:
        response = client.get(
            "/api/v1/auth/me?role=admin",
            headers={"Authorization": "Bearer unit-token", "X-Role": "admin"},
        )
        assert response.status_code == 200
        assert response.json() == {
            "uid": "unit-user",
            "role": "seeker",
            "emailVerified": True,
        }
        assert verifier.calls == ["unit-token"]
        assert "email" not in response.json()


def test_email_verification_requires_a_true_boolean_claim():
    with make_client(
        ClaimsVerifier({"uid": "unit-user", "email_verified": "true"})
    ) as client:
        response = client.get(
            "/api/v1/auth/me", headers={"Authorization": "Bearer unit-token"}
        )
        assert response.json()["emailVerified"] is False


@pytest.mark.parametrize("uid", [None, "", " " * 3, 1, "x" * 129])
def test_invalid_verified_identity_is_rejected(uid):
    with make_client(ClaimsVerifier({"uid": uid})) as client:
        assert (
            client.get(
                "/api/v1/auth/me", headers={"Authorization": "Bearer unit-token"}
            ).status_code
            == 401
        )


@pytest.mark.parametrize("role", [None, "owner", [], True])
def test_unsupported_roles_are_rejected(role):
    with make_client(ClaimsVerifier({"uid": "unit-user", "role": role})) as client:
        assert (
            client.get(
                "/api/v1/auth/me", headers={"Authorization": "Bearer unit-token"}
            ).status_code
            == 403
        )


@pytest.mark.parametrize(
    "role,expected", [("seeker", 403), ("provider", 403), ("admin", 200)]
)
def test_role_dependency_uses_only_verified_claims(role, expected):
    app = create_app(
        Settings(_env_file=None), ClaimsVerifier({"uid": "unit-user", "role": role})
    )

    # This route is test-only and is not included in the application entry point.
    @app.get("/test/admin")
    def protected(user: Annotated[CurrentUser, Depends(require_roles("admin"))]):
        return {"role": user.role}

    with TestClient(app) as client:
        assert (
            client.get(
                "/test/admin?role=admin",
                headers={"Authorization": "Bearer unit-token", "X-Role": "admin"},
            ).status_code
            == expected
        )


def test_cors_allows_only_the_configured_frontend():
    with make_client() as client:
        for origin, expected in [
            ("http://localhost:5173", 200),
            ("http://untrusted.invalid", 400),
        ]:
            response = client.options(
                "/api/v1/auth/me",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Headers": "authorization",
                },
            )
            assert response.status_code == expected
            assert response.headers.get("access-control-allow-origin") == (
                origin if expected == 200 else None
            )
        response = client.get(
            "/api/v1/auth/me", headers={"Origin": "http://localhost:5173"}
        )
        assert response.status_code == 401
        assert (
            response.headers["access-control-allow-origin"] == "http://localhost:5173"
        )


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://app.invalid/path",
        "ftp://app.invalid",
        "https://user:secret@app.invalid",
    ],
)
def test_invalid_cors_configuration_is_rejected(origin):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, frontend_origin=origin)


def test_example_environment_can_be_loaded_without_becoming_configured(tmp_path):
    example = tmp_path / "example"
    example.write_text(
        "FIREBASE_PROJECT_ID=your_project_id\nVITE_API_BASE_URL=http://localhost:8000\n",
        encoding="utf-8",
    )
    assert Settings(_env_file=example).firebase_project_id is None


def test_production_disables_interactive_api_documentation():
    with TestClient(
        create_app(Settings(_env_file=None, app_env="production"))
    ) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
