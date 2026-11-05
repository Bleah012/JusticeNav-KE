"""Explicit local development role setup; no public privilege-changing endpoint."""

import argparse
import json
import sys
from pathlib import Path


def change_role(sdk, app, uid, desired, apply=False):
    if (
        desired not in {"admin", "seeker"}
        or not isinstance(uid, str)
        or not uid.strip()
        or len(uid) > 128
    ):
        raise ValueError("Invalid role setup input")
    user = sdk.get_user(uid, app=app)
    if user.disabled:
        raise ValueError("Disabled account")
    claims = dict(user.custom_claims or {})
    current = claims.get("role", "seeker")
    if current not in {"admin", "seeker"}:
        raise ValueError("Account has a different managed role")
    result = {"currentRole": current, "requestedRole": desired, "mode": "dry-run"}
    if not apply:
        return result
    if current == desired:
        return {**result, "mode": "unchanged"}
    # Firebase replaces all custom claims, so preserve unrelated current claims.
    updated = {**claims, "role": desired}
    if (
        len(
            json.dumps(updated, separators=(",", ":"), ensure_ascii=False).encode(
                "utf-8"
            )
        )
        > 1000
    ):
        raise ValueError("Claims exceed allowed size")
    fresh = sdk.get_user(uid, app=app)
    if fresh.disabled or dict(fresh.custom_claims or {}) != claims:
        raise ValueError("Account claims changed; inspect again")
    sdk.set_custom_user_claims(uid, updated, app=app)
    verified = sdk.get_user(uid, app=app)
    if (verified.custom_claims or {}) != updated:
        raise ValueError("Role write outcome needs inspection")
    return {**result, "mode": "updated"}


def main():
    parser = argparse.ArgumentParser(
        description="Inspect or explicitly change one local development account role."
    )
    parser.add_argument("--role", choices=["admin", "seeker"], default="admin")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Ask for explicit confirmation before writing the role.",
    )
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from firebase_admin import auth

    from app.auth import get_firebase_app
    from app.config import Settings

    try:
        settings = Settings()
        if (
            settings.app_env != "development"
            or settings.firebase_project_id != "justicenav-ke"
        ):
            raise ValueError("Expected development project")
        app = get_firebase_app(settings)
        if getattr(app.credential, "project_id", None) != "justicenav-ke":
            raise ValueError("Credential project mismatch")
        uid = input(
            "Paste the development account UID from Firebase Authentication (keep it local): "
        ).strip()
        preview = change_role(auth, app, uid, args.role)
        print(
            f"Project: justicenav-ke; current role: {preview['currentRole']}; requested role: {args.role}."
        )
        if not args.apply:
            print(
                "DRY RUN: no role was changed. Use --apply only when ready to confirm this account."
            )
            return 0
        phrase = "GRANT ADMIN" if args.role == "admin" else "RESTORE SEEKER"
        if input(f"Type {phrase} to change only this development account: ") != phrase:
            print("Cancelled. No role change requested.")
            return 1
        result = change_role(auth, app, uid, args.role, apply=True)
        print(
            "Role setup status: "
            + result["mode"]
            + ". Sign out and sign in again to refresh the verified token."
        )
        return 0
    except Exception:
        print(
            "Role setup could not be confirmed. Check the project, credential permission and account locally. Do not repeat an uncertain write before inspecting its role."
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
