"""Read-only own-account dashboard; totals are not limited to list page sizes."""

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Lock
from typing import Annotated, Literal, Protocol

from fastapi import APIRouter, Depends, HTTPException, Request
from firebase_admin import firestore
from pydantic import AwareDatetime, Field, StrictStr, model_validator

from .assessments import (
    STORAGE_ERRORS,
    AssessmentMissing,
    AssessmentUnavailable,
    Status,
    UserDependency,
)
from .assessments import read_record as read_assessment
from .auth import get_firebase_app
from .catalog import CatalogModel
from .checklists import ChecklistMissing, ChecklistSummary, ChecklistUnavailable
from .checklists import read_record as read_checklist
from .checklists import summary as checklist_summary
from .referrals import Identifier, ReferralMissing, ReferralSummary, ReferralUnavailable
from .referrals import read_record as read_referral
from .referrals import summary as referral_summary

MAX_COUNT = 9007199254740991
Count = Annotated[int, Field(strict=True, ge=0, le=MAX_COUNT)]
Kind = Literal["assessment", "checklist", "referral"]
WINDOW = 6


class DashboardUnavailable(Exception):
    """A complete own-account summary could not be read safely."""


class DashboardCounts(CatalogModel):
    assessments: Count
    checklists: Count
    referrals: Count


class DashboardActivity(CatalogModel):
    kind: Kind
    id: Identifier
    occurred_at: AwareDatetime
    assessment_status: Status | None = None

    @model_validator(mode="after")
    def valid_target(self):
        if (self.kind == "assessment") != (self.assessment_status is not None):
            raise ValueError("Invalid activity target")
        return self


def activity_order(item):
    return (item.occurred_at, item.kind, item.id)


class DashboardSnapshot(CatalogModel):
    uid: StrictStr = Field(min_length=1, max_length=128)
    counts: DashboardCounts
    latest_checklist: ChecklistSummary | None
    latest_referral: ReferralSummary | None
    activity: list[DashboardActivity] = Field(max_length=WINDOW)
    refreshed_at: AwareDatetime

    @model_validator(mode="after")
    def consistent_summary(self):
        if (self.counts.checklists > 0) != (self.latest_checklist is not None):
            raise ValueError("Missing checklist summary")
        if (self.counts.referrals > 0) != (self.latest_referral is not None):
            raise ValueError("Missing referral summary")
        keys = [(item.kind, item.id) for item in self.activity]
        if len(keys) != len(set(keys)) or self.activity != sorted(
            self.activity, key=activity_order, reverse=True
        ):
            raise ValueError("Invalid recent save order")
        for kind in ("assessment", "checklist", "referral"):
            items = [item for item in self.activity if item.kind == kind]
            count = getattr(self.counts, kind + "s")
            if len(items) > count or (count > 0 and not self.activity):
                raise ValueError("Inconsistent save summary")
        if any(item.occurred_at > self.refreshed_at for item in self.activity):
            raise ValueError("Invalid save timestamp")
        if self.latest_checklist:
            item = self.latest_checklist
            expected = (
                "empty"
                if not item.total_items
                else "complete"
                if item.completed_items == item.total_items
                else "in-progress"
            )
            if item.completed_items > item.total_items or item.status != expected:
                raise ValueError("Invalid checklist progress")
        return self


def compose(uid, assessment_data, checklist_data, referral_data):
    """Recent activity is each record's latest save, not a fabricated event log."""
    sources = [
        ("assessment", *assessment_data),
        ("checklist", *checklist_data),
        ("referral", *referral_data),
    ]
    events = []
    for kind, count, records in sources:
        if (
            type(count) is not int
            or not 0 <= count <= MAX_COUNT
            or len(records) > WINDOW
            or len(records) > count
            or bool(count) != bool(records)
        ):
            raise DashboardUnavailable
        if len({item.id for item in records}) != len(records) or any(
            item.uid != uid for item in records
        ):
            raise DashboardUnavailable
        for item in records:
            events.append(
                DashboardActivity(
                    kind=kind,
                    id=item.id,
                    occurredAt=item.updated_at,
                    assessmentStatus=item.status if kind == "assessment" else None,
                )
            )
    checklists = checklist_data[1]
    referrals = referral_data[1]
    latest_checklist = (
        max(checklists, key=lambda row: (row.updated_at, row.id))
        if checklists
        else None
    )
    latest_referral = (
        max(referrals, key=lambda row: (row.updated_at, row.id)) if referrals else None
    )
    return DashboardSnapshot(
        uid=uid,
        counts=DashboardCounts(
            assessments=assessment_data[0],
            checklists=checklist_data[0],
            referrals=referral_data[0],
        ),
        latestChecklist=checklist_summary(latest_checklist)
        if latest_checklist
        else None,
        latestReferral=referral_summary(latest_referral) if latest_referral else None,
        activity=sorted(events, key=activity_order, reverse=True)[:WINDOW],
        refreshedAt=datetime.now(UTC),
    )


class DashboardStore(Protocol):
    def get(self, uid: str) -> DashboardSnapshot: ...


class FirestoreDashboardStore:
    def __init__(self, settings):
        self.settings, self._client, self._lock = settings, None, Lock()

    def _connection(self):
        if os.environ.get("FIRESTORE_EMULATOR_HOST"):
            raise DashboardUnavailable
        with self._lock:
            if self._client is None:
                self._client = firestore.client(
                    app=get_firebase_app(self.settings), database_id="(default)"
                )
        return self._client

    def _read(self, connection, uid, owner_collection, child, reader):
        owner = hashlib.sha256(uid.encode("utf-8")).hexdigest()
        collection = (
            connection.collection(owner_collection).document(owner).collection(child)
        )
        # Count the entire owner collection, not a paginated/limited query.
        result = collection.count(alias="total").get(retry=None, timeout=5)
        if (
            len(result) != 1
            or len(result[0]) != 1
            or getattr(result[0][0], "alias", None) != "total"
        ):
            raise DashboardUnavailable
        total = result[0][0].value
        # The installed SDK decoder represents integer zero as 0.0.
        if type(total) is float and total == 0.0:
            total = 0
        if type(total) is not int or not 0 <= total <= MAX_COUNT:
            raise DashboardUnavailable
        rows = (
            collection.order_by("updatedAt", direction="DESCENDING")
            .limit(WINDOW)
            .stream(retry=None, timeout=5)
        )
        records = [reader(row, uid, row.id) for row in rows]
        return total, records

    def get(self, uid):
        try:
            connection = self._connection()
            # Three independent owner collections; bound each RPC and avoid serial latency.
            with ThreadPoolExecutor(max_workers=3) as pool:
                jobs = [
                    pool.submit(self._read, connection, uid, owner, child, reader)
                    for owner, child, reader in [
                        ("assessmentOwners", "assessments", read_assessment),
                        ("checklistOwners", "checklists", read_checklist),
                        ("referralOwners", "referrals", read_referral),
                    ]
                ]
                data = [job.result() for job in jobs]
            return compose(uid, *data)
        except (
            *STORAGE_ERRORS,
            AssessmentMissing,
            AssessmentUnavailable,
            ChecklistMissing,
            ChecklistUnavailable,
            ReferralMissing,
            ReferralUnavailable,
        ) as error:
            raise DashboardUnavailable from error


router = APIRouter(prefix="/api/v1/dashboard", tags=["Own-account dashboard"])


def get_store(request: Request) -> DashboardStore:
    return request.app.state.dashboard_store


@router.get("", response_model=DashboardSnapshot)
def get_my_dashboard(
    user: UserDependency, store: Annotated[DashboardStore, Depends(get_store)]
):
    """Read counts and bounded metadata only; opening the dashboard creates nothing."""
    try:
        result = DashboardSnapshot.model_validate(store.get(user.uid))
        if result.uid != user.uid:
            raise DashboardUnavailable
        return result
    except (DashboardUnavailable, ValueError, TypeError) as error:
        raise HTTPException(
            503, "Your dashboard could not be loaded. Try again."
        ) from error
