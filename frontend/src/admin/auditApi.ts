import { apiOrigin } from "../auth/session";
import { checkedDate, validServiceId } from "../catalog/catalogApi";
import { AdminApiError } from "./adminApi";

export const auditKinds = {
  service: "Service",
  pathway: "Pathway",
  resource: "Resource",
} as const;
export const auditVerbs = {
  create: "Created",
  update: "Updated",
  publish: "Published",
  archive: "Archived",
  delete: "Deleted draft",
} as const;
export type AuditKind = keyof typeof auditKinds;
export type AuditVerb = keyof typeof auditVerbs;
export type AuditFilters = {
  kind: "all" | AuditKind;
  action: "all" | AuditVerb;
  query: string;
  from: string;
  to: string;
};
export const initialAuditFilters: AuditFilters = {
  kind: "all",
  action: "all",
  query: "",
  from: "",
  to: "",
};
export type AuditEvent = {
  id: string;
  occurredAt: string;
  actorReference: string;
  action: `${AuditKind}.${AuditVerb}`;
  targetKind: AuditKind;
  targetReference: string;
  revision: number;
  outcome: "succeeded";
};
export type AuditPage = { events: AuditEvent[]; nextCursor: string | null };

export function formatAuditDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(date);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdminApiError(502);
  return value as Record<string, unknown>;
}
function cursorValid(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,2048}$/.test(value);
}
function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}
export function auditParameters(filters: AuditFilters, cursor: string | null) {
  if (
    !filters ||
    (filters.kind !== "all" && !Object.hasOwn(auditKinds, filters.kind)) ||
    (filters.action !== "all" && !Object.hasOwn(auditVerbs, filters.action)) ||
    typeof filters.query !== "string" ||
    filters.query.length > 200 ||
    hasControlCharacters(filters.query) ||
    typeof filters.from !== "string" ||
    typeof filters.to !== "string" ||
    (filters.from && !checkedDate(filters.from)) ||
    (filters.to && (!checkedDate(filters.to) || filters.to === "9999-12-31")) ||
    (filters.from && filters.to && filters.from > filters.to) ||
    (cursor !== null && !cursorValid(cursor))
  )
    throw new AdminApiError(422);
  const params = new URLSearchParams({
    kind: filters.kind,
    action: filters.action,
    query: filters.query.trim(),
  });
  if (filters.from) params.set("from_date", filters.from);
  if (filters.to) params.set("to_date", filters.to);
  if (cursor) params.set("cursor", cursor);
  return params;
}
export function parseAuditPage(
  value: unknown,
  uid: string,
  filters: AuditFilters,
  cursor: string | null,
): AuditPage {
  const row = object(value);
  if (
    row.schemaVersion !== 1 ||
    row.uid !== uid ||
    row.role !== "admin" ||
    row.readOnly !== true ||
    !Array.isArray(row.events) ||
    row.events.length > 25 ||
    (row.nextCursor !== null &&
      (!cursorValid(row.nextCursor) || row.nextCursor === cursor))
  )
    throw new AdminApiError(502);
  const events = row.events.map((value): AuditEvent => {
    const event = object(value);
    const kind = event.targetKind;
    if (
      typeof kind !== "string" ||
      !Object.hasOwn(auditKinds, kind) ||
      typeof event.id !== "string" ||
      !new RegExp(`^${kind}:[a-f0-9]{32}$`).test(event.id) ||
      typeof event.action !== "string" ||
      !Object.keys(auditVerbs).some(
        (verb) => event.action === `${kind}.${verb}`,
      ) ||
      typeof event.occurredAt !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(event.occurredAt) ||
      !Number.isFinite(Date.parse(event.occurredAt)) ||
      new Date(event.occurredAt).toISOString() !==
        `${event.occurredAt.slice(0, 23)}Z` ||
      typeof event.actorReference !== "string" ||
      !event.actorReference.trim() ||
      event.actorReference.length > 128 ||
      hasControlCharacters(event.actorReference) ||
      !validServiceId(event.targetReference) ||
      !Number.isSafeInteger(event.revision) ||
      Number(event.revision) < 1 ||
      event.outcome !== "succeeded"
    )
      throw new AdminApiError(502);
    const day = new Date(Date.parse(event.occurredAt) + 10800000)
      .toISOString()
      .slice(0, 10);
    if (
      (filters.kind !== "all" && kind !== filters.kind) ||
      (filters.action !== "all" &&
        event.action !== `${kind}.${filters.action}`) ||
      (filters.from && day < filters.from) ||
      (filters.to && day > filters.to) ||
      (filters.query.trim() &&
        !`${event.id} ${event.actorReference} ${event.targetReference}`
          .toLowerCase()
          .includes(filters.query.trim().toLowerCase()))
    )
      throw new AdminApiError(502);
    return {
      id: event.id,
      occurredAt: event.occurredAt,
      actorReference: event.actorReference,
      action: event.action as AuditEvent["action"],
      targetKind: kind as AuditKind,
      targetReference: event.targetReference,
      revision: Number(event.revision),
      outcome: "succeeded",
    };
  });
  const keys = events.map(
    (event) =>
      `${event.occurredAt}|${event.targetKind}|${event.id.split(":")[1]}`,
  );
  if (
    new Set(events.map((event) => event.id)).size !== events.length ||
    keys.some((key, index) => index > 0 && key >= keys[index - 1])
  )
    throw new AdminApiError(502);
  return { events, nextCursor: row.nextCursor as string | null };
}

type User = { uid: string; getIdToken: () => Promise<string> };
export function createAuditApi({
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
  return async (
    filters: AuditFilters,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<AuditPage> => {
    const params = auditParameters(filters, cursor);
    const user = currentUser();
    const active = () =>
      !signal.aborted && !!user && user.uid === uid && currentUser() === user;
    if (!user || !active()) throw new AdminApiError(401);
    const token = await user.getIdToken();
    if (!active()) throw new AdminApiError(401);
    const response = await request(
      `${apiOrigin(baseUrl)}/api/v1/admin/audit-logs?${params}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      },
    );
    if (!active()) throw new AdminApiError(401);
    if (!response.ok) throw new AdminApiError(response.status);
    const result: unknown = await response.json();
    if (!active()) throw new AdminApiError(401);
    return parseAuditPage(result, uid, filters, cursor);
  };
}
