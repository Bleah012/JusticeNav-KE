import { apiOrigin } from "../auth/session";
import {
  checkedDate,
  parseDirectoryService,
  validServiceId,
} from "../catalog/catalogApi";
import { parsePathway } from "../pathways/pathwayApi";
import type { DirectoryService } from "../pages/JusticeServicesPage";
import type { Pathway } from "../pathways/pathwayApi";
export type AdminKind = "overview" | "services" | "pathways";
export type AdminOverview = {
  kind: "overview";
  services: number;
  pathways: number;
  resources: number;
  catalogCheckedOn: string;
  pathwaysCheckedOn: string;
};
export type AdminService = Omit<DirectoryService, "sourceReview"> & {
  sourceReview: NonNullable<DirectoryService["sourceReview"]>;
};
export type AdminServices = {
  kind: "services";
  checkedOn: string;
  services: AdminService[];
};
export type AdminPathways = {
  kind: "pathways";
  checkedOn: string;
  pathways: Pathway[];
  serviceIds: string[];
};
export type AdminValue = AdminOverview | AdminServices | AdminPathways;
export class AdminApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Administrative read could not be completed");
    this.status = status;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdminApiError(502);
  return value as Record<string, unknown>;
}
function date(value: unknown): string {
  if (!checkedDate(value) || value > new Date().toISOString().slice(0, 10))
    throw new AdminApiError(502);
  return value;
}
function count(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max)
    throw new AdminApiError(502);
  return Number(value);
}
function array<T>(
  value: unknown,
  max: number,
  parse: (value: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > max) throw new AdminApiError(502);
  return value.map(parse);
}
function unique<
  T extends {
    id: string;
  },
>(rows: T[]): T[] {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new AdminApiError(502);
  return rows;
}
export function parseAdmin(
  value: unknown,
  uid: string,
  kind: AdminKind,
): AdminValue {
  const data = object(value);
  if (
    data.schemaVersion !== 1 ||
    data.uid !== uid ||
    data.role !== "admin" ||
    data.readOnly !== true
  )
    throw new AdminApiError(502);
  if (kind === "overview")
    return {
      kind,
      services: count(data.services, 50),
      pathways: count(data.pathways, 30),
      resources: count(data.resources, 100),
      catalogCheckedOn: date(data.catalogCheckedOn),
      pathwaysCheckedOn: date(data.pathwaysCheckedOn),
    };
  const checkedOn = date(data.checkedOn);
  if (kind === "services") {
    const services = unique(
      array(data.services, 50, (value) => {
        const row = parseDirectoryService(value);
        if (!row.sourceReview) throw new AdminApiError(502);
        return { ...row, sourceReview: row.sourceReview };
      }),
    );
    if (services.some((row) => row.sourceReview.checkedOn > checkedOn))
      throw new AdminApiError(502);
    return { kind, checkedOn, services };
  }
  const serviceIds = array(data.serviceIds, 50, (value) => {
    if (!validServiceId(value)) throw new AdminApiError(502);
    return value;
  });
  const pathways = unique(
    array(data.pathways, 30, (value) => parsePathway(value)),
  );
  if (
    new Set(serviceIds).size !== serviceIds.length ||
    pathways.some(
      (row) =>
        !serviceIds.includes(row.serviceId) ||
        row.sourceReview.checkedOn > checkedOn,
    )
  )
    throw new AdminApiError(502);
  return { kind, checkedOn, pathways, serviceIds };
}
type User = {
  uid: string;
  getIdToken: () => Promise<string>;
};
export function createAdminApi({
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
  return async (kind: AdminKind, signal: AbortSignal): Promise<AdminValue> => {
    if (!["overview", "services", "pathways"].includes(kind))
      throw new AdminApiError(422);
    const user = currentUser();
    const active = () =>
      !signal.aborted && !!user && user.uid === uid && currentUser() === user;
    if (!user || !active()) throw new AdminApiError(401);
    const token = await user.getIdToken();
    if (!active()) throw new AdminApiError(401);
    const response = await request(
      `${apiOrigin(baseUrl)}/api/v1/admin/${kind}`,
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
    const value: unknown = await response.json();
    if (!active()) throw new AdminApiError(401);
    return parseAdmin(value, uid, kind);
  };
}
