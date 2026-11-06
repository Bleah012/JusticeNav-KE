import { validId } from "../assessments/assessmentApi";
import { validServiceId } from "../catalog/catalogApi";
import {
  createReferralTransport,
  ReferralError,
  validDate,
} from "./referralApi";

export const demoStatusLabels = {
  shared: "Awaiting demo assignment",
  assigned: "Assigned to a demo provider",
  "under-review": "Demo review in progress",
  completed: "Demo review completed",
  withdrawn: "Sharing withdrawn",
} as const;

type Status = keyof typeof demoStatusLabels;
export type DemoRole = "admin" | "provider";
export type DemoRecord = {
  id: string;
  serviceId: string;
  serviceName: string;
  pathwayTitle: string;
  status: Status;
  revision: number;
  history: { status: Status; at: string }[];
};
export type DemoPage = { referrals: DemoRecord[]; nextCursor: string | null };

const transitions: Record<Status, readonly Status[]> = {
  shared: ["assigned", "withdrawn"],
  assigned: ["under-review", "withdrawn"],
  "under-review": ["completed", "withdrawn"],
  completed: ["withdrawn"],
  withdrawn: [],
};

export function validDemoId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export function validProviderUid(value: string) {
  return /^\S{1,128}$/.test(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReferralError(502);
  return value as Record<string, unknown>;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000)
    throw new ReferralError(502);
  return value;
}
function state(value: unknown): Status {
  if (typeof value !== "string" || !Object.hasOwn(demoStatusLabels, value))
    throw new ReferralError(502);
  return value as Status;
}
export function parseDemoRecord(value: unknown): DemoRecord {
  const row = object(value);
  if (
    !validDemoId(row.id) ||
    !validServiceId(row.serviceId) ||
    !Array.isArray(row.history) ||
    row.history.length < 1 ||
    row.history.length > 5 ||
    row.revision !== row.history.length
  ) {
    throw new ReferralError(502);
  }
  const history = row.history.map((value) => {
    const event = object(value);
    if (!validDate(event.at)) throw new ReferralError(502);
    return { status: state(event.status), at: event.at };
  });
  const status = state(row.status);
  if (history[0].status !== "shared" || history.at(-1)?.status !== status)
    throw new ReferralError(502);
  for (let i = 1; i < history.length; i++) {
    const previous = history[i - 1],
      event = history[i];
    if (
      !transitions[previous.status].includes(event.status) ||
      Date.parse(event.at) < Date.parse(previous.at)
    )
      throw new ReferralError(502);
  }
  return {
    id: row.id,
    serviceId: row.serviceId,
    serviceName: label(row.serviceName),
    pathwayTitle: label(row.pathwayTitle),
    status,
    revision: history.length,
    history,
  };
}
function envelope(value: unknown, uid: string) {
  const data = object(value);
  if (data.uid !== uid) throw new ReferralError(502);
  return data;
}
export function parseDemoPage(
  value: unknown,
  uid: string,
  role: DemoRole,
  after?: string,
): DemoPage {
  const data = envelope(value, uid);
  if (
    !Array.isArray(data.referrals) ||
    data.referrals.length > 20 ||
    (data.nextCursor !== null && !validDemoId(data.nextCursor))
  )
    throw new ReferralError(502);
  const referrals = data.referrals.map(parseDemoRecord);
  for (const [index, record] of referrals.entries()) {
    const previous = index ? referrals[index - 1].id : after;
    if (
      (previous && record.id <= previous) ||
      (role === "admin"
        ? record.status !== "shared"
        : !["assigned", "under-review", "completed"].includes(record.status))
    )
      throw new ReferralError(502);
  }
  if (
    data.nextCursor !== null &&
    (referrals.length !== 20 || data.nextCursor !== referrals.at(-1)?.id)
  )
    throw new ReferralError(502);
  return { referrals, nextCursor: data.nextCursor };
}
function confirmed(
  data: Record<string, unknown>,
  expected: Status,
  revision: number,
  key?: string,
) {
  const row = parseDemoRecord(data.referral);
  if (
    row.status !== expected ||
    row.revision !== revision ||
    (key && row.id !== key)
  )
    throw new ReferralError(502);
  return row;
}
function checkRevision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5)
    throw new ReferralError(422);
}
export function createDemoReferralApi(
  options: Parameters<typeof createReferralTransport>[0],
) {
  const read = createReferralTransport(options, "demo");
  const { uid } = options;
  async function owner(
    id: string,
    suffix: string,
    method: "GET" | "PUT",
    body: unknown,
    signal: AbortSignal,
  ) {
    if (!validId(id)) throw new ReferralError(422);
    const data = envelope(
      await read(`/mine/${id}${suffix}`, method, body, signal),
      uid,
    );
    if (data.referralId !== id) throw new ReferralError(502);
    return data;
  }
  return {
    async mine(id: string, signal: AbortSignal) {
      const data = await owner(id, "", "GET", undefined, signal);
      return data.referral === null ? null : parseDemoRecord(data.referral);
    },
    async share(id: string, signal: AbortSignal) {
      const data = await owner(
        id,
        "/share",
        "PUT",
        { confirmed: true, consentVersion: "demo-metadata-v1" },
        signal,
      );
      return confirmed(data, "shared", 1);
    },
    async withdraw(id: string, row: DemoRecord, signal: AbortSignal) {
      checkRevision(row.revision);
      const data = await owner(
        id,
        "/withdraw",
        "PUT",
        { expectedRevision: row.revision },
        signal,
      );
      return confirmed(data, "withdrawn", row.revision + 1, row.id);
    },
    async list(role: DemoRole, after: string | undefined, signal: AbortSignal) {
      if (
        (role !== "admin" && role !== "provider") ||
        (after !== undefined && !validDemoId(after))
      )
        throw new ReferralError(422);
      const query = after ? `?after=${after}` : "";
      return parseDemoPage(
        await read(`/${role}${query}`, "GET", undefined, signal),
        uid,
        role,
        after,
      );
    },
    async assign(row: DemoRecord, providerUid: string, signal: AbortSignal) {
      if (
        !validDemoId(row.id) ||
        !validProviderUid(providerUid) ||
        row.status !== "shared"
      )
        throw new ReferralError(422);
      checkRevision(row.revision);
      const data = envelope(
        await read(
          `/admin/${row.id}/assign`,
          "PUT",
          { expectedRevision: row.revision, providerUid },
          signal,
        ),
        uid,
      );
      return confirmed(data, "assigned", row.revision + 1, row.id);
    },
    async progress(
      row: DemoRecord,
      status: "under-review" | "completed",
      signal: AbortSignal,
    ) {
      if (
        !validDemoId(row.id) ||
        (status !== "under-review" && status !== "completed") ||
        !transitions[row.status].includes(status)
      )
        throw new ReferralError(422);
      checkRevision(row.revision);
      const data = envelope(
        await read(
          `/provider/${row.id}/status`,
          "PUT",
          { expectedRevision: row.revision, status },
          signal,
        ),
        uid,
      );
      return confirmed(data, status, row.revision + 1, row.id);
    },
  };
}
