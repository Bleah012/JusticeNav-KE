"""Administrator-only account creation; existing accounts are never re-roled."""

import re
import unicodedata
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from firebase_admin import auth, exceptions
from google.auth.exceptions import GoogleAuthError
from pydantic import (
    AwareDatetime,
    Field,
    SecretStr,
    StrictStr,
    field_validator,
    model_validator,
)

from .admin_catalog import load_catalog
from .auth import CurrentUser, VerificationUnavailable, get_firebase_app, require_roles
from .catalog import CatalogModel
from .catalog import Identifier as ServiceId

Admin = Annotated[CurrentUser, Depends(require_roles("admin"))]
RequestId = Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{32}$")]
Cursor = Annotated[StrictStr, Field(min_length=1, max_length=4096)]
router = APIRouter(prefix="/api/v1/admin/users", tags=["Administrator accounts"])
SDK_ERRORS = (
    exceptions.FirebaseError,
    GoogleAuthError,
    OSError,
    ValueError,
    TypeError,
    AttributeError,
    OverflowError,
    VerificationUnavailable,
)


class AccountsUnavailable(Exception):
    pass


class AccountConflict(Exception):
    pass


class AccountMissing(Exception):
    pass


class AccountInput(Exception):
    pass


class AccountCreate(CatalogModel):
    name: StrictStr = Field(min_length=1, max_length=120)
    email: StrictStr = Field(min_length=3, max_length=254)
    password: SecretStr
    role: Literal["provider", "admin"]
    service_id: ServiceId | None = None
    confirmed: bool = Field(strict=True)

    @field_validator("name", "email", mode="before")
    @classmethod
    def clean(cls, value):
        if not isinstance(value, str):
            raise ValueError("Text required")
        value = value.strip()
        if any(unicodedata.category(char) == "Cc" for char in value):
            raise ValueError("Unsupported character")
        return value

    @field_validator("password", mode="before")
    @classmethod
    def password_text(cls, value):
        if (
            not isinstance(value, str)
            or not 12 <= len(value) <= 128
            or any(unicodedata.category(char) == "Cc" for char in value)
        ):
            raise ValueError("Use a password of 12 to 128 characters")
        return value

    @model_validator(mode="after")
    def valid(self):
        if not self.confirmed or not re.fullmatch(
            r"[^\s@]+@[^\s@]+\.[^\s@]+", self.email
        ):
            raise ValueError("Confirmation and email required")
        if (self.role == "provider") != (self.service_id is not None):
            raise ValueError("Only providers need a service")
        return self


class Account(CatalogModel):
    id: StrictStr = Field(min_length=1, max_length=128)
    name: StrictStr | None = Field(max_length=120)
    email: StrictStr | None = Field(max_length=254)
    role: Literal["seeker", "provider", "admin", "unsupported"]
    disabled: bool = Field(strict=True)
    service_id: ServiceId | None
    created_at: AwareDatetime
    last_sign_in_at: AwareDatetime | None


class AccountPage(CatalogModel):
    uid: StrictStr
    users: list[Account] = Field(max_length=50)
    next_cursor: Cursor | None


class AccountResponse(CatalogModel):
    uid: StrictStr
    account: Account


def account_view(user):
    claims = user.custom_claims or {}
    role = claims.get("role", "seeker")
    role = role if role in {"seeker", "provider", "admin"} else "unsupported"
    service = claims.get("demoServiceId") if role == "provider" else None
    metadata = user.user_metadata
    return Account(
        id=user.uid,
        name=user.display_name,
        email=user.email,
        role=role,
        disabled=user.disabled,
        serviceId=service,
        createdAt=datetime.fromtimestamp(metadata.creation_timestamp / 1000, UTC),
        lastSignInAt=datetime.fromtimestamp(metadata.last_sign_in_timestamp / 1000, UTC)
        if metadata.last_sign_in_timestamp
        else None,
    )


class FirebaseAccounts:
    def __init__(self, settings):
        self.settings = settings

    def list(self, cursor):
        try:
            app = get_firebase_app(self.settings)
            page = auth.list_users(page_token=cursor, max_results=50, app=app)
            return [
                account_view(user) for user in page.users
            ], page.next_page_token or None
        except SDK_ERRORS as error:
            raise AccountsUnavailable from error

    def lookup(self, identifier):
        try:
            return account_view(
                auth.get_user("jn-" + identifier, app=get_firebase_app(self.settings))
            )
        except auth.UserNotFoundError as error:
            raise AccountMissing from error
        except SDK_ERRORS as error:
            raise AccountsUnavailable from error

    def create(self, identifier, command):
        # Never repair or change an existing account from this creation endpoint.
        # A fixed UID lets a lost response be inspected with a read-only lookup.
        started = False
        try:
            app = get_firebase_app(self.settings)
            uid = "jn-" + identifier
            user = auth.create_user(
                uid=uid,
                display_name=command.name,
                email=command.email,
                password=command.password.get_secret_value(),
                disabled=True,
                email_verified=False,
                app=app,
            )
            started = True
            if (
                user.uid != uid
                or not user.disabled
                or user.email.casefold() != command.email.casefold()
            ):
                raise AccountsUnavailable
            claims = {"role": command.role}
            if command.role == "provider":
                claims["demoServiceId"] = command.service_id
            auth.set_custom_user_claims(uid, claims, app=app)
            assigned = auth.get_user(uid, app=app)
            if (
                assigned.uid != uid
                or not assigned.disabled
                or assigned.custom_claims != claims
            ):
                raise AccountsUnavailable
            auth.update_user(uid, disabled=False, app=app)
            verified = auth.get_user(uid, app=app)
            if (
                verified.uid != uid
                or verified.disabled
                or verified.custom_claims != claims
                or verified.email.casefold() != command.email.casefold()
                or verified.display_name != command.name
            ):
                raise AccountsUnavailable
            return account_view(verified)
        except (auth.EmailAlreadyExistsError, auth.UidAlreadyExistsError) as error:
            if started:
                raise AccountsUnavailable from error
            raise AccountConflict from error
        except (ValueError, exceptions.InvalidArgumentError) as error:
            if started:
                raise AccountsUnavailable from error
            raise AccountInput from error
        except SDK_ERRORS as error:
            raise AccountsUnavailable from error


def execute(operation):
    try:
        return operation()
    except AccountMissing as error:
        raise HTTPException(404, "Account not found.") from error
    except AccountConflict as error:
        raise HTTPException(
            409,
            "The email or creation reference already exists. Reload accounts and inspect before continuing.",
        ) from error
    except AccountInput as error:
        raise HTTPException(
            422, "Check the account name, email and password requirements."
        ) from error
    except AccountsUnavailable as error:
        raise HTTPException(
            503,
            "Account information or creation could not be confirmed. Reload accounts before trying again.",
        ) from error


@router.get("", response_model=AccountPage)
def list_accounts(user: Admin, request: Request, after: Cursor | None = None):
    def read():
        rows, cursor = request.app.state.account_directory.list(after)
        if len({row.id for row in rows}) != len(rows):
            raise AccountsUnavailable
        return AccountPage(uid=user.uid, users=rows, nextCursor=cursor)

    return execute(read)


@router.get("/created/{identifier}", response_model=AccountResponse)
def inspect_creation(identifier: RequestId, user: Admin, request: Request):
    return execute(
        lambda: AccountResponse(
            uid=user.uid, account=request.app.state.account_directory.lookup(identifier)
        )
    )


@router.put("/{identifier}", response_model=AccountResponse)
def create_account(
    identifier: RequestId, command: AccountCreate, user: Admin, request: Request
):
    if command.role == "provider" and command.service_id not in {
        item.id for item in load_catalog(request).services
    }:
        raise HTTPException(422, "Choose a published service for the provider.")
    return execute(
        lambda: AccountResponse(
            uid=user.uid,
            account=request.app.state.account_directory.create(identifier, command),
        )
    )
