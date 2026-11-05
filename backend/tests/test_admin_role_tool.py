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
