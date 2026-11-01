"""Load backend configuration without requiring a Firebase project for health checks."""

import re
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8-sig",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    frontend_origin: str = "http://localhost:5173"
    firebase_project_id: str | None = None
    google_application_credentials: str = ""

    @field_validator("frontend_origin")
    @classmethod
    def validate_origin(cls, value: str) -> str:
        """Allow one explicit HTTP(S) origin, never a wildcard or URL path."""
        value = value.strip()
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
            or "*" in value
        ):
            raise ValueError("FRONTEND_ORIGIN must be a single HTTP(S) origin")
        _ = parsed.port  # Reject malformed ports while parsing configuration.
        return value.rstrip("/")

    @field_validator("firebase_project_id", mode="before")
    @classmethod
    def validate_project(cls, value: object) -> str | None:
        """Treat the agreed placeholder as unconfigured, not as a real project."""
        if value is None or value == "" or value == "your_project_id":
            return None
        if not isinstance(value, str) or not re.fullmatch(
            r"[a-z][a-z0-9-]{4,28}[a-z0-9]", value
        ):
            raise ValueError("FIREBASE_PROJECT_ID must be a real project ID")
        return value
