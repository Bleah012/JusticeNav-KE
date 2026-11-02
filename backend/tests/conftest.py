"""Isolate configuration and prevent accidental live Firebase calls in unit tests."""

import pytest


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in (
        "FIREBASE_PROJECT_ID",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "FIREBASE_AUTH_EMULATOR_HOST",
        "FIRESTORE_EMULATOR_HOST",
        "FRONTEND_ORIGIN",
        "APP_ENV",
    ):
        monkeypatch.delenv(name, raising=False)
