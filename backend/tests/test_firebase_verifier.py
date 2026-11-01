"""Check the Admin SDK boundary using mocks, never Firebase accounts or tokens."""

import firebase_admin
import pytest
from firebase_admin import auth
from google.auth.exceptions import DefaultCredentialsError

from app import auth as auth_module
from app.auth import FirebaseTokenVerifier, InvalidToken, VerificationUnavailable
from app.config import Settings


def verifier():
    return FirebaseTokenVerifier(
        Settings(_env_file=None, firebase_project_id="unit-project")
    )


def test_sdk_is_called_with_revocation_check_and_correct_app(monkeypatch):
    instance = verifier()
    sentinel = object()
    monkeypatch.setattr(instance, "_get_app", lambda: sentinel)

    def verified(token, *, app, check_revoked):
        assert token == "unit-token"
        assert app is sentinel
        assert check_revoked is True
        return {"uid": "unit-user"}

    monkeypatch.setattr(auth, "verify_id_token", verified)
    assert instance.verify("unit-token") == {"uid": "unit-user"}


@pytest.mark.parametrize(
    "sdk_error",
    [
        auth.InvalidIdTokenError("invalid test token"),
        auth.ExpiredIdTokenError("expired test token", cause=None),
        auth.RevokedIdTokenError("revoked test token"),
        auth.UserDisabledError("disabled test account"),
        auth.UserNotFoundError("deleted test account"),
    ],
    ids=lambda error: type(error).__name__,
)
def test_invalid_expired_revoked_or_disabled_identity_is_denied(monkeypatch, sdk_error):
    instance = verifier()
    monkeypatch.setattr(instance, "_get_app", lambda: object())

    def fail(*args, **kwargs):
        raise sdk_error

    monkeypatch.setattr(auth, "verify_id_token", fail)
    with pytest.raises(InvalidToken):
        instance.verify("unit-token")


def test_certificate_failure_is_unavailable_not_invalid_login(monkeypatch):
    instance = verifier()
    monkeypatch.setattr(instance, "_get_app", lambda: object())

    def fail(*args, **kwargs):
        raise auth.CertificateFetchError("internal test message", cause=None)

    monkeypatch.setattr(auth, "verify_id_token", fail)
    with pytest.raises(VerificationUnavailable):
        instance.verify("unit-token")


def test_emulator_environment_cannot_enable_unsigned_token_verification(monkeypatch):
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
    with pytest.raises(VerificationUnavailable):
        verifier().verify("unit-token")


def test_initialization_passes_the_configured_project_and_backend_credentials(
    monkeypatch,
):
    sentinel = object()
    app = object()

    def not_initialized(name):
        assert name == "justicenav-unit-project"
        raise ValueError("not initialized")

    def initialize(credential, *, options, name):
        assert credential is sentinel
        assert options == {"projectId": "unit-project"}
        assert name == "justicenav-unit-project"
        return app

    monkeypatch.setattr(firebase_admin, "get_app", not_initialized)
    monkeypatch.setattr(auth_module.credentials, "ApplicationDefault", lambda: sentinel)
    monkeypatch.setattr(firebase_admin, "initialize_app", initialize)
    assert verifier()._get_app() is app


def test_credential_failure_is_an_unavailable_service(monkeypatch):
    instance = verifier()
    monkeypatch.setattr(instance, "_get_app", lambda: object())

    def fail(*args, **kwargs):
        raise DefaultCredentialsError("private local credential details")

    monkeypatch.setattr(auth, "verify_id_token", fail)
    with pytest.raises(VerificationUnavailable):
        instance.verify("unit-token")
