import { apiOrigin } from "../auth/session";
import type { DirectoryService } from "../pages/JusticeServicesPage";
import type { ServiceProfile } from "../pages/ServiceProfilePage";
import type { ResourceItem, ResourceCategory } from "../pages/ResourcesPage";

const officialHosts = new Set([
  "judiciary.go.ke",
  "www.judiciary.go.ke",
  "cak.go.ke",
  "www.cak.go.ke",
  "nlas.go.ke",
  "www.nlas.go.ke",
]);
export class CatalogError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Public catalogue information could not be loaded");
    this.status = status;
  }
}
export function validServiceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}
export function checkedDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const stamp = Date.parse(value);
  return (
    Number.isFinite(stamp) &&
    new Date(stamp).toISOString().slice(0, 10) === value
  );
}
export function officialSource(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^https:\/\/[a-z.]+(?:\/[^?#\s\\]*)?$/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      officialHosts.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CatalogError(502);
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000)
    throw new CatalogError(502);
  return value;
}
function nullable(value: unknown): string | null {
  return value === null ? null : text(value);
}
function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new CatalogError(502);
  return value.map(text);
}
function link(value: unknown) {
  const item = object(value);
  if (!officialSource(item.url)) throw new CatalogError(502);
  return { name: text(item.name), url: item.url };
}
export function parseDirectoryService(value: unknown): DirectoryService {
  const item = object(value),
    review = object(item.sourceReview);
  if (
    !validServiceId(item.id) ||
    !checkedDate(review.checkedOn) ||
    !Array.isArray(review.sources) ||
    review.sources.length < 1 ||
    review.sources.length > 8
  )
    throw new CatalogError(502);
  return {
    id: item.id,
    name: text(item.name),
    serviceType: text(item.serviceType),
    location: text(item.location),
    description: text(item.description),
    eligibility: nullable(item.eligibility),
    accessMethods: strings(item.accessMethods, 10),
    deliveryModes: strings(item.deliveryModes, 5),
    sourceReview: {
      checkedOn: review.checkedOn,
      sources: review.sources.map(link),
    },
  };
}
export function parseService(
  value: unknown,
  expectedId: string,
): ServiceProfile {
  const item = object(value),
    common = parseDirectoryService(item),
    contact = object(item.contact);
  if (
    common.id !== expectedId ||
    !officialSource(item.officialWebsite) ||
    !Array.isArray(item.accessSteps) ||
    item.accessSteps.length > 10
  )
    throw new CatalogError(502);
  return {
    ...common,
    about: nullable(item.about),
    offeredServices: strings(item.offeredServices, 15),
    whoMayQualify: nullable(item.whoMayQualify),
    officialWebsite: item.officialWebsite,
    accessSteps: item.accessSteps.map((value) => {
      const step = object(value);
      return {
        title: text(step.title),
        description: nullable(step.description),
      };
    }),
    contact: {
      access: nullable(contact.access),
      coverage: nullable(contact.coverage),
      hours: nullable(contact.hours),
      address: nullable(contact.address),
      phone: nullable(contact.phone),
      email: nullable(contact.email),
    },
  };
}
export function parseResource(value: unknown): ResourceItem {
  const item = object(value),
    source = object(item.source);
  const categories = strings(item.categories, 4);
  if (
    !validServiceId(item.id) ||
    !checkedDate(source.checkedOn) ||
    categories.length === 0 ||
    new Set(categories).size !== categories.length ||
    categories.some(
      (category) =>
        !["preparation", "self-representation", "consumer", "civil"].includes(
          category,
        ),
    )
  )
    throw new CatalogError(502);
  return {
    id: item.id,
    title: text(item.title),
    description: text(item.description),
    categories: categories as ResourceCategory[],
    source: { ...link(source), checkedOn: source.checkedOn },
  };
}
function unique<T extends { id: string }>(records: T[]): T[] {
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw new CatalogError(502);
  return records;
}
// Public reads never attach a bearer token, cookies, a search query or a request body.
export function createCatalogApi(
  baseUrl: string,
  request: typeof fetch = fetch,
) {
  async function read(path: string, signal: AbortSignal) {
    if (signal.aborted) throw new CatalogError(499);
    const response = await request(`${apiOrigin(baseUrl)}/api/v1/${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    if (signal.aborted) throw new CatalogError(499);
    if (!response.ok) throw new CatalogError(response.status);
    const value: unknown = await response.json();
    if (signal.aborted) throw new CatalogError(499);
    const result = object(value);
    if (result.schemaVersion !== 1) throw new CatalogError(502);
    return result;
  }
  return {
    async services(signal: AbortSignal): Promise<DirectoryService[]> {
      const result = await read("services", signal);
      if (
        !checkedDate(result.checkedOn) ||
        !Array.isArray(result.services) ||
        result.services.length > 50
      )
        throw new CatalogError(502);
      const records = unique(result.services.map(parseDirectoryService));
      if (
        records.some(
          (record) =>
            !record.sourceReview ||
            record.sourceReview.checkedOn > String(result.checkedOn),
        )
      )
        throw new CatalogError(502);
      return records;
    },
    async service(id: string, signal: AbortSignal): Promise<ServiceProfile> {
      if (!validServiceId(id)) throw new CatalogError(404);
      const result = await read(`services/${encodeURIComponent(id)}`, signal);
      return parseService(result.service, id);
    },
    async resources(signal: AbortSignal): Promise<ResourceItem[]> {
      const result = await read("resources", signal);
      if (
        !checkedDate(result.checkedOn) ||
        !Array.isArray(result.resources) ||
        result.resources.length > 100
      )
        throw new CatalogError(502);
      const records = unique(result.resources.map(parseResource));
      if (
        records.some(
          (record) =>
            !record.source.checkedOn ||
            record.source.checkedOn > String(result.checkedOn),
        )
      )
        throw new CatalogError(502);
      return records;
    },
  };
}
