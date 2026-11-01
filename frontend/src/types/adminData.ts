// Administrative data must come from a backend that verifies the administrator role.
export type AdminData<T> =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "forbidden" }
  | { status: "ready"; value: T };

export type PublicationStatus = "draft" | "published" | "archived";
export type VerificationStatus = "needs-review" | "verified" | "expired";

type CatalogBase = {
  id: string;
  title: string;
  category: string;
  publication: PublicationStatus;
  verification: VerificationStatus;
  verifiedOn: string | null;
  sourceUrl: string | null;
};

export type AdminServiceRecord = CatalogBase & {
  kind: "service";
  location: string | null;
  description: string | null;
  eligibility: string | null;
  requirements: string | null;
  contact: string | null;
  access: "remote" | "in-person" | "both" | null;
  verificationNote: string | null;
};

export type AdminPathwayRecord = CatalogBase & {
  kind: "pathway";
  relatedServices: number | null;
};

export type AdminCatalogRecord = AdminServiceRecord | AdminPathwayRecord;

export const publicationLabels: Record<PublicationStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};
export const verificationLabels: Record<VerificationStatus, string> = {
  "needs-review": "Needs review",
  verified: "Verified",
  expired: "Expired",
};

// Keep unsafe or incomplete source addresses out of source links and verified labels.
export function isAdminSourceUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

// Format only genuine calendar dates; never substitute the current date.
export function formatAdminDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    return null;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
}

// Label supplied reporting periods without inventing a date range.
export function formatAdminMonth(value: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(value) || !formatAdminDate(`${value}-01`))
    return null;
  return new Intl.DateTimeFormat("en-KE", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T00:00:00Z`));
}

// Require unambiguous records and source metadata before rendering verification claims.
export function validAdminCatalog(
  records: readonly AdminCatalogRecord[],
  kind: "service" | "pathway",
): boolean {
  return (
    new Set(records.map((record) => record.id)).size === records.length &&
    records.every(
      (record) =>
        record.kind === kind &&
        record.id.trim() &&
        record.title.trim() &&
        record.category.trim() &&
        Object.hasOwn(publicationLabels, record.publication) &&
        Object.hasOwn(verificationLabels, record.verification) &&
        (record.verifiedOn === null ||
          Boolean(formatAdminDate(record.verifiedOn))) &&
        (record.verification !== "verified" ||
          (isAdminSourceUrl(record.sourceUrl) &&
            Boolean(formatAdminDate(record.verifiedOn)))) &&
        (record.kind !== "pathway" ||
          record.relatedServices === null ||
          (Number.isSafeInteger(record.relatedServices) &&
            record.relatedServices >= 0)),
    )
  );
}

export type AdminOverviewSnapshot = {
  totalUsers: number;
  activeAssessments: number;
  activeReferrals: number;
  verifiedServices: number;
  referralVolume: readonly { month: string; count: number }[];
  referralStatuses: readonly {
    status:
      | "saved"
      | "under-review"
      | "action-required"
      | "completed"
      | "cancelled";
    count: number;
  }[];
  reviewServices: readonly AdminServiceRecord[];
};
