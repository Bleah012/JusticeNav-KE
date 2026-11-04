import { apiOrigin } from "../auth/session";
import { validId } from "../assessments/assessmentApi";
import { validServiceId } from "../catalog/catalogApi";
import { parseReview } from "../pathways/pathwayApi";
import type { SourceReview } from "../pathways/pathwayApi";

export const acknowledgement =
  "I understand this request is saved only in JusticeNav KE and is not sent to an institution. Saving does not guarantee acceptance or legal representation.";
export type Selection = {
  pathway: { id: string; title: string };
  service: { id: string; name: string };
  sourceReview: SourceReview;
  selectionVersion: string;
};
export type Contact = {
  fullName: string;
  email: string;
  phone: string | null;
  contactMethod: "email" | "phone";
  description: string;
  acknowledged: boolean;
};
export type Referral = Omit<Contact, "acknowledged"> & {
  id: string;
  uid: string;
  selection: Selection;
  scope: "school-demonstration";
  status: "saved";
  deliveryStatus: "not-sent";
  revision: 1;
  acknowledgementVersion: "project-request-v1";
  savedAt: string;
  updatedAt: string;
  acknowledgedAt: string;
};
export type ReferralSummary = {
  id: string;
  pathwayTitle: string;
  serviceName: string;
  savedAt: string;
  status: "saved";
  deliveryStatus: "not-sent";
};
export type ReferralPage = {
  referrals: ReferralSummary[];
  nextCursor: string | null;
};
export type ReferralDraft = {
  id: string;
  selection: Selection;
  record: Referral | null;
};
type User = { uid: string; getIdToken: () => Promise<string> };
export class ReferralError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Referral request could not be completed");
    this.status = status;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReferralError(502);
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new ReferralError(502);
  return value;
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}
export function referralTime(value: string): string {
  return validDate(value)
    ? new Intl.DateTimeFormat("en-KE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Nairobi",
      }).format(new Date(value))
    : "Date unavailable";
}
export function parseSelection(value: unknown, pathwayId?: string): Selection {
  const item = object(value),
    pathway = object(item.pathway),
    service = object(item.service);
  if (
    !validServiceId(pathway.id) ||
    (pathwayId && pathway.id !== pathwayId) ||
    !validServiceId(service.id) ||
    typeof item.selectionVersion !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.selectionVersion)
  )
    throw new ReferralError(502);
  return {
    pathway: { id: pathway.id, title: text(pathway.title) },
    service: { id: service.id, name: text(service.name) },
    selectionVersion: item.selectionVersion,
    sourceReview: parseReview(item.sourceReview),
  };
}
function controls(value: string, multiline = false): boolean {
  return [...value].some((char) => {
    const code = char.codePointAt(0)!;
    return (
      (code < 32 && !(multiline && [9, 10, 13].includes(code))) ||
      (code >= 127 && code <= 159)
    );
  });
}
export function validateContact(value: Contact): string {
  if (
    !value.fullName.trim() ||
    value.fullName.length > 120 ||
    controls(value.fullName)
  )
    return "Enter your name (up to 120 characters).";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
    value.email.length > 254 ||
    controls(value.email)
  )
    return "Enter a valid email address.";
  if (value.contactMethod !== "email" && value.contactMethod !== "phone")
    return "Select a contact method.";
  if (
    (value.phone && !/^\+[1-9][0-9]{7,14}$/.test(value.phone)) ||
    (value.contactMethod === "phone" && !value.phone)
  )
    return "Enter a phone number in international format, such as +254 followed by the number.";
  if (
    !value.description.trim() ||
    value.description.length > 1500 ||
    controls(value.description, true)
  )
    return "Enter a brief description (up to 1,500 characters).";
  if (value.acknowledged !== true)
    return "Read and tick the acknowledgement before saving.";
  return "";
}
export function parseReferral(
  value: unknown,
  uid: string,
  id: string,
): Referral {
  const item = object(value),
    selection = parseSelection(item.selection);
  if (
    !validId(id) ||
    item.id !== id ||
    item.uid !== uid ||
    item.scope !== "school-demonstration" ||
    item.status !== "saved" ||
    item.deliveryStatus !== "not-sent" ||
    item.revision !== 1 ||
    item.acknowledgementVersion !== "project-request-v1" ||
    !validDate(item.savedAt) ||
    item.savedAt !== item.updatedAt ||
    item.savedAt !== item.acknowledgedAt ||
    typeof item.fullName !== "string" ||
    typeof item.email !== "string" ||
    (item.phone !== null && typeof item.phone !== "string") ||
    (item.contactMethod !== "email" && item.contactMethod !== "phone") ||
    typeof item.description !== "string"
  )
    throw new ReferralError(502);
  const contact: Contact = {
    fullName: item.fullName,
    email: item.email,
    phone: item.phone,
    contactMethod: item.contactMethod,
    description: item.description,
    acknowledged: true,
  };
  if (validateContact(contact)) throw new ReferralError(502);
  return {
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    contactMethod: contact.contactMethod,
    description: contact.description,
    id,
    uid,
    selection,
    scope: item.scope,
    status: item.status,
    deliveryStatus: item.deliveryStatus,
    revision: 1,
    acknowledgementVersion: "project-request-v1",
    savedAt: item.savedAt,
    updatedAt: item.updatedAt,
    acknowledgedAt: item.acknowledgedAt,
  };
}
export function createReferralApi({
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
  async function read(
    path: string,
    method: "GET" | "PUT",
    body: unknown,
    signal: AbortSignal,
  ) {
    const user = currentUser();
    const active = () =>
      !signal.aborted && currentUser() === user && user?.uid === uid;
    if (!user || !active()) throw new ReferralError(401);
    const token = await user.getIdToken();
    if (!active()) throw new ReferralError(401);
    const response = await request(
      `${apiOrigin(baseUrl)}/api/v1/referrals${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "PUT" ? { body: JSON.stringify(body) } : {}),
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    );
    if (!active()) throw new ReferralError(401);
    if (!response.ok) throw new ReferralError(response.status);
    const result: unknown = await response.json();
    if (!active()) throw new ReferralError(401);
    return result;
  }
  function checkId(id: string) {
    if (!validId(id)) throw new ReferralError(422);
  }
  return {
    async selection(pathwayId: string, signal: AbortSignal) {
      if (!validServiceId(pathwayId)) throw new ReferralError(422);
      return parseSelection(
        await read(`/selection/${pathwayId}`, "GET", undefined, signal),
        pathwayId,
      );
    },
    async get(id: string, signal: AbortSignal) {
      checkId(id);
      return parseReferral(
        object(await read(`/${id}`, "GET", undefined, signal)).referral,
        uid,
        id,
      );
    },
    async save(
      id: string,
      selection: Selection,
      contact: Contact,
      signal: AbortSignal,
    ) {
      checkId(id);
      const source = parseSelection(selection);
      const clean: Contact = {
        fullName: contact.fullName.trim(),
        email: contact.email.trim(),
        phone: contact.phone?.trim() || null,
        contactMethod: contact.contactMethod,
        description: contact.description.trim(),
        acknowledged: contact.acknowledged,
      };
      if (validateContact(clean)) throw new ReferralError(422);
      const body = {
        ...clean,
        pathwayId: source.pathway.id,
        serviceId: source.service.id,
        selectionVersion: source.selectionVersion,
        expectedRevision: 0,
      };
      const record = parseReferral(
        object(await read(`/${id}`, "PUT", body, signal)).referral,
        uid,
        id,
      );
      if (
        record.selection.selectionVersion !== source.selectionVersion ||
        record.selection.pathway.id !== source.pathway.id ||
        record.selection.service.id !== source.service.id ||
        record.fullName !== clean.fullName ||
        record.email !== clean.email ||
        record.phone !== clean.phone ||
        record.contactMethod !== clean.contactMethod ||
        record.description !== clean.description
      )
        throw new ReferralError(502);
      return record;
    },
    async list(
      after: string | undefined,
      signal: AbortSignal,
    ): Promise<ReferralPage> {
      if (after) checkId(after);
      const result = object(
        await read(after ? `?after=${after}` : "", "GET", undefined, signal),
      );
      if (
        !Array.isArray(result.referrals) ||
        result.referrals.length > 50 ||
        (result.nextCursor !== null && !validId(result.nextCursor))
      )
        throw new ReferralError(502);
      const referrals = result.referrals.map((value): ReferralSummary => {
        const row = object(value);
        if (
          !validId(row.id) ||
          !validDate(row.savedAt) ||
          row.status !== "saved" ||
          row.deliveryStatus !== "not-sent"
        )
          throw new ReferralError(502);
        return {
          id: row.id,
          serviceName: text(row.serviceName),
          pathwayTitle: text(row.pathwayTitle),
          savedAt: row.savedAt,
          status: "saved",
          deliveryStatus: "not-sent",
        };
      });
      if (
        new Set(referrals.map((row) => row.id)).size !== referrals.length ||
        (result.nextCursor && result.nextCursor !== referrals.at(-1)?.id)
      )
        throw new ReferralError(502);
      return { referrals, nextCursor: result.nextCursor as string | null };
    },
  };
}
