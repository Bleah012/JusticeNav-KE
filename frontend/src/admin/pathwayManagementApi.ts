import { apiOrigin } from "../auth/session";
import { reviewToday } from "../catalog/reviewDate";
import { checkedDate, validServiceId } from "../catalog/catalogApi";
import { parsePathway } from "../pathways/pathwayApi";
import type { Pathway } from "../pathways/pathwayApi";
import { AdminApiError } from "./adminApi";

export type Publication = "draft" | "published" | "archived";
export type PathwayRecord = {
  pathway: Pathway;
  publication: Publication;
  revision: number;
  everPublished: boolean;
  reviewNote: string;
  updatedAt: string | null;
  updatedBy: string | null;
};
export type PathwayList = {
  records: PathwayRecord[];
  protectedPathwayIds: string[];
  publishedServices: { id: string; name: string }[];
};
export type PathwayCommand =
  | {
      type: "save";
      pathway: Pathway;
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
export function parsePathwayRecord(value: unknown): PathwayRecord {
  const row = object(value),
    source = object(row.pathway);
  if (!validServiceId(source.id)) throw new AdminApiError(502);
  const pathway = parsePathway(source, source.id);
  if (
    !pathway.sourceReview ||
    !checkedDate(pathway.sourceReview.checkedOn) ||
    pathway.sourceReview.checkedOn > reviewToday() ||
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
    pathway,
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
export function parsePathwayList(value: unknown, uid: string): PathwayList {
  const row = envelope(value, uid);
  if (
    !Array.isArray(row.records) ||
    row.records.length > 30 ||
    !Array.isArray(row.protectedPathwayIds) ||
    row.protectedPathwayIds.length > 50 ||
    row.protectedPathwayIds.some((id) => !validServiceId(id)) ||
    !Array.isArray(row.publishedServices) ||
    row.publishedServices.length > 50
  )
    throw new AdminApiError(502);
  const records = row.records.map(parsePathwayRecord),
    protectedPathwayIds = row.protectedPathwayIds as string[];
  if (
    new Set(records.map((item) => item.pathway.id)).size !== records.length ||
    new Set(protectedPathwayIds).size !== protectedPathwayIds.length
  )
    throw new AdminApiError(502);
  const publishedServices = (row.publishedServices as unknown[]).map(
    (value) => {
      const service = object(value);
      if (
        !validServiceId(service.id) ||
        typeof service.name !== "string" ||
        !service.name.trim() ||
        service.name.length > 2000
      )
        throw new AdminApiError(502);
      return { id: service.id, name: service.name };
    },
  );
  if (
    new Set(publishedServices.map((row) => row.id)).size !==
      publishedServices.length ||
    records.some(
      (row) =>
        row.publication === "published" &&
        !publishedServices.some(
          (service) => service.id === row.pathway.serviceId,
        ),
    )
  )
    throw new AdminApiError(502);
  return { records, protectedPathwayIds, publishedServices };
}

// Whitelist write fields and verify the exact record/revision before claiming success.
export function preparePathwayCommand(command: PathwayCommand) {
  if (!command || !["save", "publication", "delete"].includes(command.type))
    throw new AdminApiError(422);
  const id = command.type === "save" ? command.pathway.id : command.id;
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
  let pathway: Pathway | undefined;
  if (command.type === "save") {
    try {
      pathway = parsePathway(command.pathway, id);
      if (
        !pathway.sourceReview ||
        pathway.sourceReview.checkedOn > reviewToday()
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
        ? { ...common, pathway }
        : { ...common, publication: command.publication },
  };
}

type User = { uid: string; getIdToken: () => Promise<string> };
export function createPathwayManagementApi({
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
      `${apiOrigin(baseUrl)}/api/v1/admin/pathway-records${path}`,
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
      return parsePathwayList(await send("", "GET", undefined, signal), uid);
    },
    async write(command: PathwayCommand, signal: AbortSignal): Promise<void> {
      const prepared = preparePathwayCommand(command);
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
        const saved = parsePathwayRecord(result.record);
        if (
          saved.pathway.id !== prepared.id ||
          saved.revision !== command.expectedRevision + 1 ||
          saved.publication !== command.publication ||
          saved.updatedBy !== uid ||
          (command.type === "save" &&
            JSON.stringify(saved.pathway) !==
              JSON.stringify(parsePathway(command.pathway, prepared.id)))
        )
          throw new AdminApiError(502);
      }
    },
  };
}
