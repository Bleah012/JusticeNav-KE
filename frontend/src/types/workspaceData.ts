import { validAdminCatalog } from "./adminData";
import type { AdminData, AdminPathwayRecord } from "./adminData";
import { referralDate, referralStatusLabels } from "./referralData";
import type { DemonstrationReferral } from "./referralData";

export const userRoleLabels = {
  seeker: "Seeker",
  provider: "Service provider",
  admin: "Administrator",
} as const;
export const userStatusLabels = {
  active: "Active",
  disabled: "Disabled",
  pending: "Pending",
} as const;

// An administrative projection excludes names, emails, contact details and case text.
export type AdminUserSummary = {
  id: string;
  role: keyof typeof userRoleLabels;
  status: keyof typeof userStatusLabels;
  createdAt: string;
  lastSignInAt: string | null;
};

// Validate account metadata without treating role labels as authorization.
export function validAdminUsers(records: readonly AdminUserSummary[]): boolean {
  return (
    new Set(records.map((item) => item.id)).size === records.length &&
    records.every(
      (item) =>
        item.id.trim() &&
        Object.hasOwn(userRoleLabels, item.role) &&
        Object.hasOwn(userStatusLabels, item.status) &&
        Boolean(referralDate(item.createdAt)) &&
        (item.lastSignInAt === null ||
          Boolean(referralDate(item.lastSignInAt))),
    )
  );
}

export type EditablePathway = AdminPathwayRecord & {
  overview: string | null;
  whoMayUse: string | null;
  matters: readonly string[];
  requirements: readonly string[];
  startingSteps: readonly { title: string; description: string | null }[];
  nextStages: readonly string[];
  sourceName: string | null;
  verificationNote: string | null;
};

export type PathwayEditorData =
  | AdminData<EditablePathway>
  | { status: "not-found" };

// Do not populate an editor from an incomplete or contradictory supplied record.
export function validEditablePathway(record: EditablePathway): boolean {
  return (
    validAdminCatalog([record], "pathway") &&
    record.matters.every((item) => item.trim()) &&
    record.requirements.every((item) => item.trim()) &&
    record.nextStages.every((item) => item.trim()) &&
    record.startingSteps.every((item) => item.title.trim())
  );
}

export type ProviderReferralSummary = {
  id: string;
  scope: "school-demonstration";
  assignedServiceId: string;
  pathwayTitle: string | null;
  status: DemonstrationReferral["status"];
  savedAt: string;
  updatedAt: string;
};

export type ProviderDashboardSnapshot = {
  membership: {
    serviceId: string;
    serviceName: string;
    status: "active" | "inactive";
  } | null;
  assignedReferrals: readonly ProviderReferralSummary[];
};

export type ProviderDashboardData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "forbidden" }
  | { status: "ready"; value: ProviderDashboardSnapshot };

// Consistency checks do not authorize access: backend membership/assignment checks remain required.
export function validProviderSnapshot(
  snapshot: ProviderDashboardSnapshot,
): boolean {
  const membership = snapshot.membership;
  return (
    Boolean(
      membership?.status === "active" &&
      membership.serviceId.trim() &&
      membership.serviceName.trim(),
    ) &&
    new Set(snapshot.assignedReferrals.map((item) => item.id)).size ===
      snapshot.assignedReferrals.length &&
    snapshot.assignedReferrals.every(
      (item) =>
        item.id.trim() &&
        item.scope === "school-demonstration" &&
        item.assignedServiceId === membership?.serviceId &&
        Object.hasOwn(referralStatusLabels, item.status) &&
        Boolean(referralDate(item.savedAt)) &&
        Boolean(referralDate(item.updatedAt)) &&
        Date.parse(item.savedAt) <= Date.parse(item.updatedAt),
    )
  );
}
