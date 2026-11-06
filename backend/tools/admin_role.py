"""Explicit local development role setup; no public privilege-changing endpoint."""

import argparse
import json
import sys
from pathlib import Path


class RoleSetupError(ValueError):
    """A controlled status message that is safe to display locally."""


def change_role(sdk, app, uid, desired, apply=False, service_id=None):
    if (
        desired not in {"admin", "seeker", "provider"}
        or not isinstance(uid, str)
        or not uid.strip()
        or len(uid) > 128
    ):
        raise RoleSetupError("Enter the User UID from Firebase Authentication → Users.")
    if (desired == "provider") != bool(service_id):
        raise RoleSetupError("A provider needs one published service ID")
    user = sdk.get_user(uid, app=app)
    if user.disabled:
        raise RoleSetupError(
            "This Firebase account is disabled. Choose an active development account."
        )
    claims = dict(user.custom_claims or {})
    current = claims.get("role", "seeker")
    allowed = (
        {"admin", "seeker"}
        if desired == "admin"
        else {"seeker", "provider"}
        if desired == "provider"
        else {"admin", "seeker", "provider"}
    )
    if current == "admin" and desired == "provider":
        raise RoleSetupError(
            "This account is an administrator. Choose a separate development account for the provider."
        )
    if current not in allowed:
        raise RoleSetupError(
            "This account has a different managed role. Choose a development account with the seeker role."
        )
    result = {"currentRole": current, "requestedRole": desired, "mode": "dry-run"}
    if not apply:
        return result
    # Firebase replaces all custom claims. Keep unrelated claims.
    updated = {**claims, "role": desired}
    if desired == "provider":
        updated["demoServiceId"] = service_id
    elif current == "provider":
        updated.pop("demoServiceId", None)
    if current == desired and (desired != "provider" or updated == claims):
        return {**result, "mode": "unchanged"}
    if (
        len(
            json.dumps(updated, separators=(",", ":"), ensure_ascii=False).encode(
                "utf-8"
            )
        )
        > 1000
    ):
        raise RoleSetupError("Claims exceed allowed size")
    fresh = sdk.get_user(uid, app=app)
    if fresh.disabled or dict(fresh.custom_claims or {}) != claims:
        raise RoleSetupError("Account claims changed; inspect again")
    sdk.set_custom_user_claims(uid, updated, app=app)
    verified = sdk.get_user(uid, app=app)
    if (verified.custom_claims or {}) != updated:
        raise RoleSetupError("Role write outcome needs inspection")
    return {**result, "mode": "updated"}


def main():
    parser = argparse.ArgumentParser(
        description="Inspect or explicitly change one local development account role."
    )
    parser.add_argument(
        "--role", choices=["admin", "seeker", "provider"], default="admin"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Ask for explicit confirmation before writing the role.",
    )
    parser.add_argument(
        "--service-id", help="Published service ID for a development provider."
    )
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from firebase_admin import auth, exceptions

    from app.auth import get_firebase_app
    from app.catalog import CatalogStore
    from app.config import Settings

    phase = "loading backend settings"
    try:
        settings = Settings()
        if (
            settings.app_env != "development"
            or settings.firebase_project_id != "justicenav-ke"
        ):
            raise RoleSetupError(
                "The backend must use development mode and Firebase project justicenav-ke."
            )
        phase = "initializing the Firebase Admin SDK"
        app = get_firebase_app(settings)
        if getattr(app.credential, "project_id", None) != "justicenav-ke":
            raise RoleSetupError(
                "The Firebase credential must belong to justicenav-ke."
            )
        phase = "loading the published service catalogue"
        if args.role == "provider" and args.service_id not in {
            item.id for item in CatalogStore().load().services
        }:
            raise RoleSetupError("Choose a service ID from the published directory.")
        phase = "reading the User UID from the prompt"
        uid = input(
            "Paste the development account UID from Firebase Authentication (keep it local): "
        ).strip()
        phase = "looking up the Firebase account"
        preview = change_role(auth, app, uid, args.role, service_id=args.service_id)
        print(
            f"Project: justicenav-ke; current role: {preview['currentRole']}; requested role: {args.role}."
        )
        if args.service_id:
            print("Demonstration service: " + args.service_id)
        if not args.apply:
            print(
                "DRY RUN: no role was changed. Use --apply only when ready to confirm this account."
            )
            return 0
        phrase = {
            "admin": "GRANT ADMIN",
            "provider": "GRANT PROVIDER",
            "seeker": "RESTORE SEEKER",
        }[args.role]
        if input(f"Type {phrase} to change only this development account: ") != phrase:
            print("Cancelled. No role change requested.")
            return 1
        phase = "updating or verifying the Firebase role"
        result = change_role(
            auth, app, uid, args.role, apply=True, service_id=args.service_id
        )
        print(
            "Role setup status: "
            + result["mode"]
            + ". Sign out and sign in again to refresh the verified token."
        )
        return 0
    except RoleSetupError as error:
        print(f"Role setup stopped. {error}")
    except auth.UserNotFoundError:
        print(
            "Firebase could not find that account in justicenav-ke. Copy its User UID from Authentication → Users."
        )
    except exceptions.PermissionDeniedError:
        print(
            f"Firebase denied permission while {phase}. Check the service account's Firebase Authentication permissions."
        )
    except exceptions.UnauthenticatedError:
        print(
            f"Firebase rejected the credentials while {phase}. Check the backend credential configuration."
        )
    except EOFError, KeyboardInterrupt:
        print("Role setup cancelled at the terminal prompt.")
    except Exception:
        print(f"Role setup could not complete while {phase}.")
    if phase == "updating or verifying the Firebase role":
        print("Run the preview to inspect the current role before retrying.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
