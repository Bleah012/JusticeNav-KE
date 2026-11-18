import { apiOrigin } from "../auth/session";
import {
  checkedDate,
  parseService,
  validServiceId,
} from "../catalog/catalogApi";
import type { ServiceProfile } from "../pages/ServiceProfilePage";
import { AdminApiError } from "./adminApi";

export type Publication = "draft" | "published" | "archived";
export type ServiceRecord = {
  service: ServiceProfile;
  publication: Publication;
  revision: number;
  everPublished: boolean;
  reviewNote: string;
  updatedAt: string | null;
  updatedBy: string | null;
};
export type ServiceList = {
  records: ServiceRecord[];
  protectedServiceIds: string[];
};
export type ServiceCommand =
  | {
      type: "save";
      service: ServiceProfile;
      expectedRevision: number;
      publication: Publication;
      reviewed: boolean;
      reviewNote: string;
    }
  | {
      type: "publication";
      id: string;
      expectedRevision: number;
      publication: "published" | "archived";
      reviewed: boolean;
      reviewNote: string;
    }
  | { type: "delete"; id: string; expectedRevision: number };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdminApiError(502);
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 1): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new AdminApiError(502);
  return Number(value);
}
export function parseServiceRecord(value: unknown): ServiceRecord {
  const row = object(value),
    source = object(row.service);
  if (!validServiceId(source.id)) throw new AdminApiError(502);
  const service = parseService(source, source.id);
  if (
    !service.sourceReview ||
    !checkedDate(service.sourceReview.checkedOn) ||
    service.sourceReview.checkedOn > new Date().toISOString().slice(0, 10) ||
    typeof row.publication !== "string" ||
    !["draft", "published", "archived"].includes(String(row.publication)) ||
    typeof row.everPublished !== "boolean" ||
    (row.publication !== "draft" && !row.everPublished) ||
    typeof row.reviewNote !== "string" ||
    row.reviewNote.length > 1000 ||
    (row.updatedAt !== null &&
      (typeof row.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(row.updatedAt)))) ||
    (row.updatedBy !== null &&
      (typeof row.updatedBy !== "string" || !row.updatedBy.trim()))
  )
    throw new AdminApiError(502);
  return {
    service,
    publication: row.publication as Publication,
    revision: integer(row.revision),
    everPublished: row.everPublished,
    reviewNote: row.reviewNote,
    updatedAt: row.updatedAt as string | null,
    updatedBy: row.updatedBy as string | null,
  };
}
function envelope(value: unknown, uid: string) {
  const row = object(value);
  if (row.schemaVersion !== 1 || row.uid !== uid || row.role !== "admin")
    throw new AdminApiError(502);
  return row;
}
export function parseServiceList(value: unknown, uid: string): ServiceList {
  const row = envelope(value, uid);
  if (
    !Array.isArray(row.records) ||
    row.records.length > 50 ||
    !Array.isArray(row.protectedServiceIds) ||
    row.protectedServiceIds.length > 50 ||
    row.protectedServiceIds.some((id) => !validServiceId(id))
  )
    throw new AdminApiError(502);
  const records = row.records.map(parseServiceRecord),
    protectedServiceIds = row.protectedServiceIds as string[];
  if (
    new Set(records.map((item) => item.service.id)).size !== records.length ||
    new Set(protectedServiceIds).size !== protectedServiceIds.length
  )
    throw new AdminApiError(502);
  return { records, protectedServiceIds };
}

// Whitelist write fields and verify the exact record/revision before claiming success.
export function prepareServiceCommand(command: ServiceCommand) {
  if (!command || !["save", "publication", "delete"].includes(command.type))
    throw new AdminApiError(422);
  const id = command.type === "save" ? command.service.id : command.id;
  if (
    !validServiceId(id) ||
    !Number.isSafeInteger(command.expectedRevision) ||
    command.expectedRevision < 0 ||
    (command.type !== "save" && command.expectedRevision === 0)
  )
    throw new AdminApiError(422);
  if (command.type === "delete")
    return {
      id,
      path: id,
      method: "DELETE",
      body: { expectedRevision: command.expectedRevision },
    };
  if (
    typeof command.reviewed !== "boolean" ||
    typeof command.reviewNote !== "string" ||
    command.reviewNote.length > 1000
  )
    throw new AdminApiError(422);
  if (
    !["draft", "published", "archived"].includes(command.publication) ||
    (command.type === "publication" &&
      !["published", "archived"].includes(command.publication)) ||
    (command.expectedRevision === 0 && command.publication !== "draft")
  )
    throw new AdminApiError(422);
  const common = {
    expectedRevision: command.expectedRevision,
    reviewed: command.reviewed,
    reviewNote: command.reviewNote.trim(),
  };
  if (
    command.publication === "published" &&
    (!common.reviewed || !common.reviewNote)
  )
    throw new AdminApiError(422);
  let service: ServiceProfile | undefined;
  if (command.type === "save") {
    try {
      service = parseService(command.service, id);
      if (
        !service.sourceReview ||
        service.sourceReview.checkedOn > new Date().toISOString().slice(0, 10)
      )
        throw new Error();
    } catch {
      throw new AdminApiError(422);
    }
  }
  return {
    id,
    path: command.type === "save" ? id : `${id}/publication`,
    method: "PUT",
    body:
      command.type === "save"
        ? { ...common, service }
        : { ...common, publication: command.publication },
  };
}

type User = { uid: string; getIdToken: () => Promise<string> };
export function createServiceManagementApi({
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
  async function send(
    path: string,
    method: string,
    body: unknown,
    signal: AbortSignal,
  ) {
    const user = currentUser();
    const active = () =>
      !signal.aborted && user && user.uid === uid && currentUser() === user;
    if (!user || !active()) throw new AdminApiError(401);
    const token = await user.getIdToken();
    if (!active()) throw new AdminApiError(401);
    const response = await request(
      `${apiOrigin(baseUrl)}/api/v1/admin/service-records${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
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
    return envelope(result, uid);
  }
  return {
    async read(signal: AbortSignal) {
      return parseServiceList(await send("", "GET", undefined, signal), uid);
    },
    async write(command: ServiceCommand, signal: AbortSignal): Promise<void> {
      const prepared = prepareServiceCommand(command);
      const result = await send(
        `/${prepared.path}`,
        prepared.method,
        prepared.body,
        signal,
      );
      if (command.type === "delete") {
        if (
          result.deletedId !== prepared.id ||
          result.revision !== command.expectedRevision + 1
        )
          throw new AdminApiError(502);
      } else {
        const saved = parseServiceRecord(result.record);
        if (
          saved.service.id !== prepared.id ||
          saved.revision !== command.expectedRevision + 1 ||
          saved.publication !== command.publication ||
          saved.updatedBy !== uid ||
          (command.type === "save" &&
            JSON.stringify(saved.service) !==
              JSON.stringify(parseService(command.service, prepared.id)))
        )
          throw new AdminApiError(502);
      }
    },
  };
}
