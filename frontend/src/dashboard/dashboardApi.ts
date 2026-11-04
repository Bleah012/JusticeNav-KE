import { apiOrigin } from "../auth/session";
import { validId, statusLabels } from "../assessments/assessmentApi";
import type { AssessmentStatus } from "../assessments/assessmentApi";
import { parseSummary } from "../checklists/checklistApi";
import type { ChecklistSummary } from "../checklists/checklistApi";
import { validDate } from "../referrals/referralApi";
import type { ReferralSummary } from "../referrals/referralApi";

export type DashboardActivity = {
  kind: "assessment" | "checklist" | "referral";
  id: string;
  occurredAt: string;
  assessmentStatus: AssessmentStatus | null;
};
export type DashboardSnapshot = {
  uid: string;
  counts: { assessments: number; checklists: number; referrals: number };
  latestChecklist: ChecklistSummary | null;
  latestReferral: ReferralSummary | null;
  activity: DashboardActivity[];
  refreshedAt: string;
};
type User = { uid: string; getIdToken: () => Promise<string> };
export class DashboardError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Dashboard request could not be completed");
    this.status = status;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DashboardError(502);
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new DashboardError(502);
  return Number(value);
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000)
    throw new DashboardError(502);
  return value;
}
export function parseDashboard(value: unknown, uid: string): DashboardSnapshot {
  const data = object(value),
    totals = object(data.counts);
  if (
    data.uid !== uid ||
    !validDate(data.refreshedAt) ||
    !Array.isArray(data.activity) ||
    data.activity.length > 6
  )
    throw new DashboardError(502);
  const counts = {
    assessments: count(totals.assessments),
    checklists: count(totals.checklists),
    referrals: count(totals.referrals),
  };
  const latestChecklist =
    data.latestChecklist === null ? null : parseSummary(data.latestChecklist);
  let latestReferral: ReferralSummary | null = null;
  if (data.latestReferral !== null) {
    const row = object(data.latestReferral);
    if (
      !validId(row.id) ||
      !validDate(row.savedAt) ||
      row.status !== "saved" ||
      row.deliveryStatus !== "not-sent"
    )
      throw new DashboardError(502);
    latestReferral = {
      id: row.id,
      serviceName: text(row.serviceName),
      pathwayTitle: text(row.pathwayTitle),
      savedAt: row.savedAt,
      status: "saved",
      deliveryStatus: "not-sent",
    };
  }
  if (
    counts.checklists > 0 !== (latestChecklist !== null) ||
    counts.referrals > 0 !== (latestReferral !== null)
  )
    throw new DashboardError(502);
  const activity = data.activity.map((value): DashboardActivity => {
    const row = object(value);
    if (
      !validId(row.id) ||
      !validDate(row.occurredAt) ||
      !["assessment", "checklist", "referral"].includes(String(row.kind))
    )
      throw new DashboardError(502);
    if (
      row.kind === "assessment"
        ? typeof row.assessmentStatus !== "string" ||
          !Object.hasOwn(statusLabels, row.assessmentStatus)
        : row.assessmentStatus !== null
    )
      throw new DashboardError(502);
    return {
      kind: row.kind as DashboardActivity["kind"],
      id: row.id,
      occurredAt: row.occurredAt,
      assessmentStatus: row.assessmentStatus as AssessmentStatus | null,
    };
  });
  if (
    new Set(activity.map((row) => `${row.kind}:${row.id}`)).size !==
      activity.length ||
    activity.some(
      (row, index) =>
        Date.parse(row.occurredAt) > Date.parse(data.refreshedAt as string) ||
        (index > 0 &&
          Date.parse(row.occurredAt) >
            Date.parse(activity[index - 1].occurredAt)),
    ) ||
    counts.assessments + counts.checklists + counts.referrals > 0 !==
      activity.length > 0
  )
    throw new DashboardError(502);
  for (const [kind, total] of [
    ["assessment", counts.assessments],
    ["checklist", counts.checklists],
    ["referral", counts.referrals],
  ] as const)
    if (activity.filter((row) => row.kind === kind).length > total)
      throw new DashboardError(502);
  if (
    latestChecklist &&
    (!validDate(latestChecklist.createdAt) ||
      !validDate(latestChecklist.updatedAt))
  )
    throw new DashboardError(502);
  if (
    (latestChecklist &&
      Date.parse(latestChecklist.updatedAt) > Date.parse(data.refreshedAt)) ||
    (latestReferral &&
      Date.parse(latestReferral.savedAt) > Date.parse(data.refreshedAt))
  )
    throw new DashboardError(502);
  return {
    uid,
    counts,
    latestChecklist,
    latestReferral,
    activity,
    refreshedAt: data.refreshedAt,
  };
}
export function activityLink(event: DashboardActivity): string {
  if (event.kind === "assessment")
    return `/app/assessments/${event.id}/${event.assessmentStatus === "draft" ? "describe" : event.assessmentStatus === "awaiting-pathways" ? "results" : "clarify"}`;
  return event.kind === "checklist"
    ? `/app/checklists/${event.id}`
    : `/app/referrals/${event.id}`;
}
export function createDashboardApi({
  baseUrl,
  uid,
  currentUser,
  request = fetch,
}: {
  baseUrl: string;
  uid: string;
  currentUser: () => User | null;
  request?: typeof fetch;
}) {
  return async (signal: AbortSignal): Promise<DashboardSnapshot> => {
    const user = currentUser();
    const active = () =>
      !signal.aborted && currentUser() === user && user?.uid === uid;
    if (!user || !active()) throw new DashboardError(401);
    const token = await user.getIdToken();
    if (!active()) throw new DashboardError(401);
    const response = await request(`${apiOrigin(baseUrl)}/api/v1/dashboard`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!active()) throw new DashboardError(401);
    if (!response.ok) throw new DashboardError(response.status);
    const result: unknown = await response.json();
    if (!active()) throw new DashboardError(401);
    return parseDashboard(result, uid);
  };
}
