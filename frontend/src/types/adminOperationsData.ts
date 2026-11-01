import {
  formatAdminDate,
  isAdminSourceUrl,
  publicationLabels,
  verificationLabels,
} from "./adminData";
import { referralDate, referralStatusLabels } from "./referralData";
import type { DemonstrationReferral } from "./referralData";
import type { PublicationStatus, VerificationStatus } from "./adminData";

// Backend projections should contain metadata, not private assessment narratives.
export type AdminReferralSummary = {
  id: string;
  scope: "school-demonstration";
  seekerReference: string | null;
  serviceName: string;
  pathwayTitle: string | null;
  status: DemonstrationReferral["status"];
  savedAt: string;
  updatedAt: string;
};

export type VerificationQueueItem = {
  id: string;
  kind: "service" | "pathway";
  title: string;
  publication: PublicationStatus;
  verification: VerificationStatus;
  sourceUrl: string | null;
  verifiedOn: string | null;
  reviewDueOn: string | null;
  reviewNote: string | null;
};

export const auditActions = {
  "service-created": { label: "Service created", target: "service" },
  "service-updated": { label: "Service updated", target: "service" },
  "service-archived": { label: "Service archived", target: "service" },
  "pathway-created": { label: "Pathway created", target: "pathway" },
  "pathway-updated": { label: "Pathway updated", target: "pathway" },
  "content-reviewed": { label: "Content reviewed", target: "content" },
  "referral-updated": { label: "Referral updated", target: "referral" },
  "access-denied": { label: "Access denied", target: "access" },
} as const;

export const auditOutcomeLabels = {
  succeeded: "Succeeded",
  failed: "Failed",
  denied: "Denied",
} as const;

// Use opaque actor/target references; exclude emails, IPs, payloads and case text.
export type AdminAuditEvent = {
  id: string;
  occurredAt: string;
  actorReference: string | null;
  action: keyof typeof auditActions;
  targetKind: "service" | "pathway" | "content" | "referral" | "access";
  targetReference: string | null;
  outcome: keyof typeof auditOutcomeLabels;
};

// Ensure one unambiguous saved demonstration summary for each referral identifier.
export function validAdminReferrals(
  records: readonly AdminReferralSummary[],
): boolean {
  return (
    new Set(records.map((item) => item.id)).size === records.length &&
    records.every(
      (item) =>
        item.id.trim() &&
        item.scope === "school-demonstration" &&
        item.serviceName.trim() &&
        Object.hasOwn(referralStatusLabels, item.status) &&
        Boolean(referralDate(item.savedAt)) &&
        Boolean(referralDate(item.updatedAt)) &&
        Date.parse(item.savedAt) <= Date.parse(item.updatedAt),
    )
  );
}

// Permit overlapping service/pathway IDs while keeping verified claims source-backed.
export function validVerificationQueue(
  records: readonly VerificationQueueItem[],
): boolean {
  return (
    new Set(records.map((item) => `${item.kind}:${item.id}`)).size ===
      records.length &&
    records.every(
      (item) =>
        item.id.trim() &&
        item.title.trim() &&
        (item.kind === "service" || item.kind === "pathway") &&
        Object.hasOwn(publicationLabels, item.publication) &&
        Object.hasOwn(verificationLabels, item.verification) &&
        (item.verifiedOn === null ||
          Boolean(formatAdminDate(item.verifiedOn))) &&
        (item.reviewDueOn === null ||
          Boolean(formatAdminDate(item.reviewDueOn))) &&
        (item.verification !== "verified" ||
          (isAdminSourceUrl(item.sourceUrl) &&
            Boolean(formatAdminDate(item.verifiedOn)))),
    )
  );
}

// Render only supported server event types; frontend navigation never creates events.
export function validAdminAuditEvents(
  records: readonly AdminAuditEvent[],
): boolean {
  return (
    new Set(records.map((item) => item.id)).size === records.length &&
    records.every(
      (item) =>
        item.id.trim() &&
        Boolean(referralDate(item.occurredAt)) &&
        Object.hasOwn(auditActions, item.action) &&
        auditActions[item.action].target === item.targetKind &&
        Object.hasOwn(auditOutcomeLabels, item.outcome),
    )
  );
}

// Compare audit date filters in Kenya time, including events near midnight UTC.
export function kenyaDateKey(timestamp: string): string | null {
  if (!referralDate(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
