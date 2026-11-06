"""Local role setup is dry-run by default and preserves unrelated claims."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

spec = importlib.util.spec_from_file_location(
    "admin_role_tool", Path(__file__).parents[1] / "tools/admin_role.py"
)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def user(claims=None, disabled=False):
    return SimpleNamespace(custom_claims=claims, disabled=disabled)


def test_default_is_read_only_preview():
    sdk = Mock(get_user=Mock(return_value=user({"feature": True})))
    assert tool.change_role(sdk, "unit-app", "unit-user", "admin") == {
        "currentRole": "seeker",
        "requestedRole": "admin",
        "mode": "dry-run",
    }
    sdk.set_custom_user_claims.assert_not_called()


@pytest.mark.parametrize("desired,current", [("admin", "seeker"), ("seeker", "admin")])
def test_explicit_write_preserves_other_claims_and_verifies_outcome(desired, current):
    before = {"role": current, "feature": True}
    after = {"role": desired, "feature": True}
    sdk = Mock(get_user=Mock(side_effect=[user(before), user(before), user(after)]))
    assert (
        tool.change_role(sdk, "unit-app", "unit-user", desired, True)["mode"]
        == "updated"
    )
    sdk.set_custom_user_claims.assert_called_once_with(
        "unit-user", after, app="unit-app"
    )


@pytest.mark.parametrize(
    "claims,disabled", [({"role": "provider"}, False), ({"role": "admin"}, True)]
)
def test_disabled_or_differently_managed_accounts_never_change(claims, disabled):
    sdk = Mock(get_user=Mock(return_value=user(claims, disabled)))
    with pytest.raises(ValueError):
        tool.change_role(sdk, "unit-app", "unit-user", "admin", True)
    sdk.set_custom_user_claims.assert_not_called()


def test_concurrent_claim_change_aborts_before_write():
    sdk = Mock(get_user=Mock(side_effect=[user({}), user({"other": True})]))
    with pytest.raises(ValueError):
        tool.change_role(sdk, "unit-app", "unit-user", "admin", True)
    sdk.set_custom_user_claims.assert_not_called()


def test_unchanged_role_does_not_write():
    sdk = Mock(get_user=Mock(return_value=user({"role": "admin"})))
    assert (
        tool.change_role(sdk, "unit-app", "unit-user", "admin", True)["mode"]
        == "unchanged"
    )
    sdk.set_custom_user_claims.assert_not_called()


def test_unconfirmed_write_outcome_is_an_error():
    sdk = Mock(get_user=Mock(side_effect=[user({}), user({}), user({})]))
    with pytest.raises(ValueError):
        tool.change_role(sdk, "unit-app", "unit-user", "admin", True)
    assert sdk.set_custom_user_claims.call_count == 1


def test_oversized_claims_abort_before_write():
    sdk = Mock(get_user=Mock(return_value=user({"large": "x" * 1001})))
    with pytest.raises(ValueError):
        tool.change_role(sdk, "unit-app", "unit-user", "admin", True)
    sdk.set_custom_user_claims.assert_not_called()


def test_provider_setup_and_restore_preserve_unrelated_claims():
    before = {"feature": True}
    provider = {
        "feature": True,
        "role": "provider",
        "demoServiceId": "small-claims-courts",
    }
    seeker = {"feature": True, "role": "seeker"}
    sdk = Mock(
        get_user=Mock(
            side_effect=[
                user(before),
                user(before),
                user(provider),
                user(provider),
                user(provider),
                user(seeker),
            ]
        )
    )
    assert (
        tool.change_role(
            sdk, "unit-app", "unit-user", "provider", True, "small-claims-courts"
        )["mode"]
        == "updated"
    )
    assert (
        tool.change_role(sdk, "unit-app", "unit-user", "seeker", True)["mode"]
        == "updated"
    )
    assert [call.args[1] for call in sdk.set_custom_user_claims.call_args_list] == [
        provider,
        seeker,
    ]


def test_provider_setup_requires_service_and_cannot_replace_admin():
    sdk = Mock(get_user=Mock(return_value=user({"role": "admin"})))
    with pytest.raises(ValueError):
        tool.change_role(sdk, "unit-app", "unit-user", "provider", True)
    with pytest.raises(ValueError):
        tool.change_role(
            sdk, "unit-app", "unit-user", "provider", True, "small-claims-courts"
        )
    sdk.set_custom_user_claims.assert_not_called()


@pytest.mark.parametrize(
    "scenario,message",
    [
        ("admin", "This account is an administrator"),
        ("disabled", "This Firebase account is disabled"),
        ("missing", "Firebase could not find that account"),
        ("denied", "Firebase denied permission while looking up the Firebase account"),
        (
            "unexpected",
            "Role setup could not complete while looking up the Firebase account",
        ),
    ],
)
def test_provider_preview_reports_safe_diagnostic_and_never_writes(
    monkeypatch, capsys, scenario, message
):
    import sys

    from firebase_admin import auth, exceptions

    from app import auth as authentication
    from app import catalog, config

    monkeypatch.setattr(
        sys,
        "argv",
        ["admin_role.py", "--role", "provider", "--service-id", "small-claims-courts"],
    )
    monkeypatch.setattr(
        config,
        "Settings",
        lambda: SimpleNamespace(
            app_env="development", firebase_project_id="justicenav-ke"
        ),
    )
    monkeypatch.setattr(
        authentication,
        "get_firebase_app",
        lambda _: SimpleNamespace(
            credential=SimpleNamespace(project_id="justicenav-ke")
        ),
    )
    monkeypatch.setattr(
        catalog,
        "CatalogStore",
        lambda: Mock(
            load=Mock(
                return_value=SimpleNamespace(
                    services=[SimpleNamespace(id="small-claims-courts")]
                )
            )
        ),
    )
    monkeypatch.setattr("builtins.input", lambda _: "PRIVATE-UID")
    failures = {
        "missing": auth.UserNotFoundError("PRIVATE-UID"),
        "denied": exceptions.PermissionDeniedError("PRIVATE-UID"),
        "unexpected": RuntimeError("PRIVATE-UID"),
    }
    lookup = Mock(
        side_effect=failures.get(scenario),
        return_value=user(
            {"role": "admin"} if scenario == "admin" else None, scenario == "disabled"
        ),
    )
    update = Mock()
    monkeypatch.setattr(auth, "get_user", lookup)
    monkeypatch.setattr(auth, "set_custom_user_claims", update)
    assert tool.main() == 1
    output = capsys.readouterr().out
    assert message in output and "PRIVATE-UID" not in output
    update.assert_not_called()
