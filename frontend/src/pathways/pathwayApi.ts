import { apiOrigin } from "../auth/session";
import {
  CatalogError,
  checkedDate,
  officialSource,
  validServiceId,
} from "../catalog/catalogApi";
import { validId } from "../assessments/assessmentApi";

export type SourceReview = {
  checkedOn: string;
  sources: { name: string; url: string }[];
};
export type PreparationItem = { id: string; label: string; note: string };
export type Pathway = {
  id: string;
  title: string;
  category: string;
  serviceId: string;
  overview: string;
  whoMayUse: string;
  matters: string[];
  requirements: string[];
  startingSteps: { title: string; description: string | null }[];
  nextStages: string[];
  sourceReview: SourceReview;
  preparation: PreparationItem[];
};
export type Preparation = {
  pathwayId: string;
  pathwayTitle: string;
  sourceReview: SourceReview;
  items: PreparationItem[];
};
export type Navigation = {
  assessmentId: string;
  uid: string;
  revision: number;
  method: "selected-category-v1";
  selectedIssue: "consumer" | "money-debt" | "other";
  checkedOn: string;
  pathways: { pathway: Pathway; reason: string }[];
};
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
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new CatalogError(502);
  return value;
}
function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new CatalogError(502);
  return items;
}
export function parseReview(value: unknown): SourceReview {
  const item = object(value);
  if (!checkedDate(item.checkedOn)) throw new CatalogError(502);
  const sources = array(item.sources, 8).map((value) => {
    const source = object(value);
    if (!officialSource(source.url)) throw new CatalogError(502);
    return { name: text(source.name), url: source.url };
  });
  if (!sources.length) throw new CatalogError(502);
  return { checkedOn: item.checkedOn, sources };
}
function preparationItems(value: unknown): PreparationItem[] {
  return unique(
    array(value, 15).map((value) => {
      const item = object(value);
      if (!validServiceId(item.id)) throw new CatalogError(502);
      return { id: item.id, label: text(item.label), note: text(item.note) };
    }),
  );
}
export function parsePathway(value: unknown, expectedId?: string): Pathway {
  const item = object(value);
  if (
    !validServiceId(item.id) ||
    !validServiceId(item.serviceId) ||
    (expectedId && item.id !== expectedId)
  )
    throw new CatalogError(502);
  return {
    id: item.id,
    title: text(item.title),
    category: text(item.category),
    serviceId: item.serviceId,
    overview: text(item.overview),
    whoMayUse: text(item.whoMayUse),
    matters: array(item.matters, 10).map(text),
    requirements: array(item.requirements, 10).map(text),
    startingSteps: array(item.startingSteps, 10).map((value) => {
      const step = object(value);
      return {
        title: text(step.title),
        description: step.description === null ? null : text(step.description),
      };
    }),
    nextStages: array(item.nextStages, 10).map(text),
    sourceReview: parseReview(item.sourceReview),
    preparation: preparationItems(item.preparation),
  };
}
function envelope(value: unknown) {
  const result = object(value);
  if (result.schemaVersion !== 1) throw new CatalogError(502);
  return result;
}
export function parseNavigation(
  value: unknown,
  uid: string,
  id: string,
): Navigation {
  const result = envelope(value);
  if (
    !validId(id) ||
    result.assessmentId !== id ||
    result.uid !== uid ||
    !Number.isSafeInteger(result.revision) ||
    Number(result.revision) < 1 ||
    result.method !== "selected-category-v1" ||
    !checkedDate(result.checkedOn) ||
    !["consumer", "money-debt", "other"].includes(String(result.selectedIssue))
  )
    throw new CatalogError(502);
  const selectedIssue = result.selectedIssue as Navigation["selectedIssue"];
  const expected = {
    consumer: ["cak-consumer-complaint", "small-claims-information"],
    "money-debt": ["small-claims-information"],
    other: [],
  }[selectedIssue];
  const pathways = array(result.pathways, 3).map((value) => {
    const entry = object(value);
    return { pathway: parsePathway(entry.pathway), reason: text(entry.reason) };
  });
  if (
    JSON.stringify(pathways.map((entry) => entry.pathway.id)) !==
      JSON.stringify(expected) ||
    pathways.some(
      (entry) =>
        entry.pathway.sourceReview.checkedOn > String(result.checkedOn),
    )
  )
    throw new CatalogError(502);
  return {
    assessmentId: id,
    uid,
    revision: Number(result.revision),
    method: "selected-category-v1",
    selectedIssue,
    checkedOn: result.checkedOn,
    pathways,
  };
}
async function json(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new CatalogError(499);
  if (!response.ok) throw new CatalogError(response.status);
  const value: unknown = await response.json();
  if (signal.aborted) throw new CatalogError(499);
  return value;
}
// Public pathway reads contain no account, bearer token, query data or request body.
export function createPathwayApi(
  baseUrl: string,
  request: typeof fetch = fetch,
) {
  async function read(path: string, signal: AbortSignal) {
    if (signal.aborted) throw new CatalogError(499);
    return envelope(
      await json(
        await request(`${apiOrigin(baseUrl)}/api/v1/pathways${path}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
        }),
        signal,
      ),
    );
  }
  function checkId(id: string) {
    if (!validServiceId(id)) throw new CatalogError(404);
  }
  return {
    async list(signal: AbortSignal): Promise<Pathway[]> {
      const result = await read("", signal);
      if (!checkedDate(result.checkedOn)) throw new CatalogError(502);
      const records = unique(
        array(result.pathways, 30).map((value) => parsePathway(value)),
      );
      if (
        records.some(
          (item) => item.sourceReview.checkedOn > String(result.checkedOn),
        )
      )
        throw new CatalogError(502);
      return records;
    },
    async get(id: string, signal: AbortSignal): Promise<Pathway> {
      checkId(id);
      return parsePathway(
        (await read(`/${encodeURIComponent(id)}`, signal)).pathway,
        id,
      );
    },
    async preparation(id: string, signal: AbortSignal): Promise<Preparation> {
      checkId(id);
      const result = await read(
        `/${encodeURIComponent(id)}/preparation`,
        signal,
      );
      if (result.pathwayId !== id) throw new CatalogError(502);
      return {
        pathwayId: id,
        pathwayTitle: text(result.pathwayTitle),
        sourceReview: parseReview(result.sourceReview),
        items: preparationItems(result.items),
      };
    },
  };
}
type TokenUser = { uid: string; getIdToken: () => Promise<string> };
// An opaque assessment ID is the only variable URL segment. The server reads saved answers.
export function createNavigationRequest({
  baseUrl,
  currentUser,
  request = fetch,
}: {
  baseUrl: string;
  currentUser: () => TokenUser | null;
  request?: typeof fetch;
}) {
  return async (
    uid: string,
    id: string,
    signal: AbortSignal,
  ): Promise<Navigation> => {
    if (!validId(id)) throw new CatalogError(422);
    const user = currentUser();
    const active = () =>
      !signal.aborted && currentUser() === user && user?.uid === uid;
    if (!user || !active()) throw new CatalogError(401);
    const token = await user.getIdToken();
    if (!active()) throw new CatalogError(401);
    const response = await request(
      `${apiOrigin(baseUrl)}/api/v1/assessments/${id}/pathways`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      },
    );
    if (!active()) throw new CatalogError(401);
    const result = await json(response, signal);
    if (!active()) throw new CatalogError(401);
    return parseNavigation(result, uid, id);
  };
}
