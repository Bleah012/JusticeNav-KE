"""Account creation authorization, private-input handling and staged Firebase writes."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from firebase_admin import auth, exceptions

from app import admin_users as users
from app.auth import InvalidToken, VerificationUnavailable
from app.catalog import CatalogStore
from app.config import Settings
from app.main import create_app

ID, BASE, SERVICE = "c" * 32, "/api/v1/admin/users", "cak-consumer-protection"


class Verifier:
    def verify(self, token):
        if token == "invalid":
            raise InvalidToken
        if token == "unavailable":
            raise VerificationUnavailable
        return {"uid": "admin-one", "role": token}


def headers(role="admin"):
    return {"Authorization": "Bearer " + role}


def payload(**changes):
    return {
        "name": "Development Provider",
        "email": "provider@example.test",
        "password": "Test-only-password-2026!",
        "role": "provider",
        "serviceId": CatalogStore().load().services[0].id,
        "confirmed": True,
        **changes,
    }


def account(uid="existing", **changes):
    return SimpleNamespace(
        **{
            "uid": uid,
            "display_name": "Development account",
            "email": "existing@example.test",
            "disabled": False,
            "custom_claims": {"role": "seeker"},
            "user_metadata": SimpleNamespace(
                creation_timestamp=1767225600000, last_sign_in_timestamp=None
            ),
            "password_hash": "NEVER-RETURN",
            **changes,
        }
    )


class FakeAuth:
    def __init__(self):
        self.users = {}
        self.calls = []
        self.reads = 0

    def create(self, **values):
        self.calls.append(("create", values["uid"], values["disabled"]))
        if values["uid"] in self.users:
            raise auth.UidAlreadyExistsError("EXISTS", None, None)
        if any(
            row.email.casefold() == values["email"].casefold()
            for row in self.users.values()
        ):
            raise auth.EmailAlreadyExistsError("EXISTS", None, None)
        result = account(
            values["uid"],
            display_name=values["display_name"],
            email=values["email"],
            disabled=values["disabled"],
            custom_claims=None,
        )
        self.users[result.uid] = result
        return result

    def claims(self, uid, claims, **_):
        self.calls.append(("claims", uid, self.users[uid].disabled))
        self.users[uid].custom_claims = claims

    def get(self, uid, **_):
        self.reads += 1
        self.calls.append(("get", uid, None))
        if uid not in self.users:
            raise auth.UserNotFoundError("MISSING")
        return self.users[uid]

    def update(self, uid, disabled, **_):
        self.calls.append(("enable", uid, disabled))
        self.users[uid].disabled = disabled
        return self.users[uid]

    def list(self, page_token=None, max_results=None, **_):
        self.calls.append(("list", page_token, max_results))
        rows = sorted(self.users.values(), key=lambda row: row.uid)
        offset = int(page_token) if page_token else 0
        return SimpleNamespace(
            users=rows[offset : offset + max_results],
            next_page_token=str(offset + max_results)
            if len(rows) > offset + max_results
            else None,
        )


@pytest.fixture
def setup(monkeypatch):
    sdk = FakeAuth()
    monkeypatch.setattr(users, "get_firebase_app", lambda _: "isolated-app")
    for name, method in [
        ("create_user", sdk.create),
        ("set_custom_user_claims", sdk.claims),
        ("get_user", sdk.get),
        ("update_user", sdk.update),
        ("list_users", sdk.list),
    ]:
        monkeypatch.setattr(users.auth, name, method)
    app = create_app(
        Settings(_env_file=None), verifier=Verifier(), catalog_store=CatalogStore()
    )
    with TestClient(app) as api:
        yield api, sdk


@pytest.mark.parametrize(
    "method,path",
    [("GET", BASE), ("GET", BASE + "/created/" + ID), ("PUT", BASE + "/" + ID)],
)
@pytest.mark.parametrize(
    "role,status",
    [
        (None, 401),
        ("invalid", 401),
        ("unavailable", 503),
        ("seeker", 403),
        ("provider", 403),
    ],
)
def test_only_verified_administrators_can_read_or_create(method, path, role, status):
    directory, catalog = Mock(), Mock()
    with TestClient(
        create_app(
            Settings(_env_file=None),
            verifier=Verifier(),
            account_directory=directory,
            catalog_store=catalog,
        )
    ) as api:
        response = api.request(
            method,
            path,
            headers=headers(role) if role else {},
            json=payload() if method == "PUT" else None,
        )
    assert response.status_code == status
    directory.list.assert_not_called()
    directory.lookup.assert_not_called()
    directory.create.assert_not_called()
    catalog.load.assert_not_called()


@pytest.mark.parametrize("role", ["provider", "admin"])
def test_created_account_has_verified_role_and_only_enables_after_claim_check(
    setup, role
):
    api, sdk = setup
    command = payload(
        role=role, serviceId=payload()["serviceId"] if role == "provider" else None
    )
    result = api.put(BASE + "/" + ID, headers=headers(), json=command)
    assert result.status_code == 200
    data = result.json()
    assert data["uid"] == "admin-one"
    assert data["account"]["id"] == "jn-" + ID
    assert data["account"]["role"] == role and data["account"]["disabled"] is False
    assert sdk.calls == [
        ("create", "jn-" + ID, True),
        ("claims", "jn-" + ID, True),
        ("get", "jn-" + ID, None),
        ("enable", "jn-" + ID, False),
        ("get", "jn-" + ID, None),
    ]
    expected = {
        "role": role,
        **({"demoServiceId": command["serviceId"]} if role == "provider" else {}),
    }
    assert sdk.users["jn-" + ID].custom_claims == expected
    assert (
        "password" not in result.text.lower()
        and "NEVER-RETURN" not in result.text
        and "customClaims" not in result.text
    )
    assert result.headers["cache-control"] == "no-store"
    assert (
        api.get(BASE + "/created/" + ID, headers=headers()).json()["account"]
        == data["account"]
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"name": " "},
        {"name": "x" * 121},
        {"email": "bad"},
        {"password": "short"},
        {"password": "a" * 129},
        {"password": 123456789012},
        {"password": "test-password\n2026"},
        {"role": "seeker"},
        {"role": "super-admin"},
        {"serviceId": None},
        {"role": "admin"},
        {"confirmed": False},
        {"confirmed": 1},
        {"uid": "existing"},
        {"customClaims": {"role": "admin"}},
        {"disabled": False},
    ],
)
def test_invalid_creation_is_redacted_and_has_no_sdk_calls(setup, changes):
    api, sdk = setup
    command = payload(**changes)
    result = api.put(BASE + "/" + ID, headers=headers(), json=command)
    assert result.status_code == 422
    assert command["email"] not in result.text and "Test-only" not in result.text
    assert not sdk.calls


def test_provider_requires_published_service(setup):
    api, sdk = setup
    response = api.put(
        BASE + "/" + ID, headers=headers(), json=payload(serviceId="not-published")
    )
    assert response.status_code == 422 and not sdk.calls


def test_duplicate_uid_or_email_never_modifies_existing_account(setup):
    api, sdk = setup
    original = account(
        "existing",
        email=payload()["email"],
        custom_claims={"role": "admin", "otherClaim": True},
    )
    sdk.users[original.uid] = original
    assert (
        api.put(BASE + "/" + ID, headers=headers(), json=payload()).status_code == 409
    )
    assert original.custom_claims == {"role": "admin", "otherClaim": True}
    assert [entry[0] for entry in sdk.calls] == ["create"]
    sdk.users = {}
    assert (
        api.put(BASE + "/" + ID, headers=headers(), json=payload()).status_code == 200
    )
    sdk.calls.clear()
    assert (
        api.put(
            BASE + "/" + ID,
            headers=headers(),
            json=payload(role="admin", serviceId=None),
        ).status_code
        == 409
    )
    assert sdk.users["jn-" + ID].custom_claims["role"] == "provider"
    assert [entry[0] for entry in sdk.calls] == ["create"]


@pytest.mark.parametrize(
    "phase", ["creation-response", "claims", "claim-read", "enable", "final-read"]
)
def test_partial_or_uncertain_creation_never_reports_success(setup, monkeypatch, phase):
    api, sdk = setup

    def fail(*args, **kwargs):
        raise exceptions.PermissionDeniedError("PRIVATE password and credential error")

    if phase == "creation-response":

        def lost(**kwargs):
            sdk.create(**kwargs)
            fail()

        monkeypatch.setattr(users.auth, "create_user", lost)
    elif phase == "claims":
        monkeypatch.setattr(users.auth, "set_custom_user_claims", fail)
    elif phase == "enable":
        monkeypatch.setattr(users.auth, "update_user", fail)
    else:

        def get(uid, **kwargs):
            if phase == "claim-read" or sdk.reads == 1:
                fail()
            return sdk.get(uid, **kwargs)

        monkeypatch.setattr(users.auth, "get_user", get)
    response = api.put(BASE + "/" + ID, headers=headers(), json=payload())
    assert response.status_code == 503 and "PRIVATE" not in response.text
    record = sdk.users["jn-" + ID]
    assert record.disabled is (phase != "final-read")
    if not record.disabled:
        assert record.custom_claims["role"] == "provider"


def test_failed_claim_verification_never_enables(setup, monkeypatch):
    api, sdk = setup
    monkeypatch.setattr(
        users.auth, "set_custom_user_claims", lambda *args, **kwargs: None
    )
    assert (
        api.put(BASE + "/" + ID, headers=headers(), json=payload()).status_code == 503
    )
    assert sdk.users["jn-" + ID].disabled and not any(
        call[0] == "enable" for call in sdk.calls
    )


def test_bounded_listing_preserves_pagination_without_secrets(setup):
    api, sdk = setup
    for number in range(51):
        sdk.users[f"user-{number:02}"] = account(f"user-{number:02}")
    first = api.get(BASE, headers=headers()).json()
    assert len(first["users"]) == 50 and first["nextCursor"] == "50"
    assert first["users"][0]["lastSignInAt"] is None and "NEVER-RETURN" not in str(
        first
    )
    last = api.get(BASE + "?after=50", headers=headers()).json()
    assert len(last["users"]) == 1 and last["nextCursor"] is None
    assert all(call[2] == 50 for call in sdk.calls)


def test_empty_missing_and_unavailable_accounts_are_distinct(setup, monkeypatch):
    api, sdk = setup
    assert api.get(BASE, headers=headers()).json()["users"] == []
    assert api.get(BASE + "/created/" + ID, headers=headers()).status_code == 404
    monkeypatch.setattr(
        users, "get_firebase_app", Mock(side_effect=VerificationUnavailable)
    )
    assert api.get(BASE, headers=headers()).status_code == 503
    assert api.get(BASE + "/created/" + ID, headers=headers()).status_code == 503


def test_unsupported_role_is_never_reported_as_administrator(setup):
    api, sdk = setup
    sdk.users["unknown"] = account(
        "unknown", custom_claims={"role": "invented", "secretClaim": "NEVER-RETURN"}
    )
    result = api.get(BASE, headers=headers()).json()
    assert result["users"][0]["role"] == "unsupported" and "NEVER-RETURN" not in str(
        result
    )
