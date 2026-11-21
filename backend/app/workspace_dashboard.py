"""Read-only administrator totals, without private assessment or referral fields."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AwareDatetime, Field

from .admin_catalog import Overview, load_catalog, load_pathways
from .admin_users import AccountsUnavailable
from .auth import CurrentUser, require_roles
from .catalog import CatalogModel
from .demo_referrals import DemoCounts, Unavailable

Admin = Annotated[CurrentUser, Depends(require_roles("admin"))]
router = APIRouter(prefix="/api/v1/admin", tags=["Workspace dashboard"])


class AccountCounts(CatalogModel):
    total: int = Field(strict=True, ge=0, le=5000)
    active: int = Field(strict=True, ge=0, le=5000)
    disabled: int = Field(strict=True, ge=0, le=5000)
    seeker: int = Field(strict=True, ge=0, le=5000)
    provider: int = Field(strict=True, ge=0, le=5000)
    admin: int = Field(strict=True, ge=0, le=5000)
    unsupported: int = Field(strict=True, ge=0, le=5000)


def account_counts(directory):
    counts = dict.fromkeys(AccountCounts.model_fields, 0)
    cursor, seen_cursors, seen_users = None, set(), set()
    # School-MVP bound: never publish a truncated scan as a platform total.
    for _ in range(100):
        rows, following = directory.list(cursor)
        if len(rows) > 50:
            raise AccountsUnavailable
        for row in rows:
            if row.id in seen_users:
                raise AccountsUnavailable
            seen_users.add(row.id)
            counts["total"] += 1
            counts["disabled" if row.disabled else "active"] += 1
            counts[row.role] += 1
        if following is None:
            return AccountCounts(**counts)
        if not following or following in seen_cursors:
            raise AccountsUnavailable
        seen_cursors.add(following)
        cursor = following
    raise AccountsUnavailable


class AdminDashboard(Overview):
    accounts: AccountCounts
    demonstrations: DemoCounts | None
    refreshed_at: AwareDatetime


@router.get("/dashboard", response_model=AdminDashboard)
def dashboard(user: Admin, request: Request):
    catalog = load_catalog(request)
    pathways = load_pathways(request, catalog)
    try:
        accounts = account_counts(request.app.state.account_directory)
        demonstrations = (
            request.app.state.demo_referral_store.summary()
            if request.app.state.demo_referrals_enabled
            else None
        )
        return AdminDashboard(
            uid=user.uid,
            services=len(catalog.services),
            pathways=len(pathways.pathways),
            resources=len(catalog.resources),
            catalogCheckedOn=catalog.checked_on.isoformat(),
            pathwaysCheckedOn=pathways.checked_on.isoformat(),
            accounts=accounts,
            demonstrations=demonstrations,
            refreshedAt=datetime.now(UTC),
        )
    except (AccountsUnavailable, Unavailable) as error:
        raise HTTPException(
            503,
            "Dashboard totals could not be loaded. Check Firebase Authentication and Firestore, then refresh.",
        ) from error
