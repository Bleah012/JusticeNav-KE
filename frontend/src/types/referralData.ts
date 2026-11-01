// These records must come from an authenticated backend after ownership checks.
// Route parameters select records; they never establish permission or success.
export type DemonstrationReferral = {
  id: string;
  scope: "school-demonstration";
  serviceName: string;
  pathwayTitle: string;
  savedAt: string;
  updatedAt: string;
  status:
    | "saved"
    | "under-review"
    | "action-required"
    | "completed"
    | "cancelled";
  nextAction: string | null;
  history: readonly {
    id: string;
    title: string;
    occurredAt: string;
    note: string | null;
  }[];
};

export type ReferralData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "not-found" }
  | { status: "ready"; referrals: readonly DemonstrationReferral[] };

export const referralStatusLabels: Record<
  DemonstrationReferral["status"],
  string
> = {
  saved: "Saved",
  "under-review": "Under review",
  "action-required": "Action required",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Reject absent or unparseable server dates rather than substituting today's date.
export function referralDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    return null;
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    return null;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(parsed);
}

// Keep success and tracking unavailable for incomplete or ambiguous records.
export function isSavedDemonstrationReferral(
  record: DemonstrationReferral,
): boolean {
  return (
    record.scope === "school-demonstration" &&
    Boolean(record.id.trim()) &&
    Boolean(record.serviceName.trim()) &&
    Boolean(record.pathwayTitle.trim()) &&
    Boolean(referralDate(record.savedAt)) &&
    Boolean(referralDate(record.updatedAt)) &&
    Object.hasOwn(referralStatusLabels, record.status)
  );
}

// Match exactly one authorized record instead of trusting a URL alone.
export function selectReferral(
  data: ReferralData,
  id: string | undefined,
): DemonstrationReferral | null {
  if (data.status !== "ready" || !id) return null;
  const matches = data.referrals.filter((record) => record.id === id);
  return matches.length === 1 && isSavedDemonstrationReferral(matches[0])
    ? matches[0]
    : null;
}
