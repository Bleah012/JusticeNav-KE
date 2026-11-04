import { apiOrigin } from "../auth/session";
import { validId } from "../assessments/assessmentApi";
import { validServiceId } from "../catalog/catalogApi";
import { parseReview } from "../pathways/pathwayApi";
import type { SourceReview, PreparationItem } from "../pathways/pathwayApi";

export const checklistStatuses = { "in-progress": "In progress", complete: "Complete", empty: "No items" } as const;
export type ChecklistStatus = keyof typeof checklistStatuses;
export type ChecklistTemplate = { pathwayId: string; pathwayTitle: string; sourceReview: SourceReview; items: PreparationItem[]; templateVersion: string };
export type Checklist = ChecklistTemplate & { id: string; uid: string; checkedIds: string[]; revision: number; status: ChecklistStatus; createdAt: string; updatedAt: string };
export type ChecklistSummary = { id: string; pathwayTitle: string; completedItems: number; totalItems: number; revision: number; status: ChecklistStatus; createdAt: string; updatedAt: string };
export type ChecklistPage = { checklists: ChecklistSummary[]; nextCursor: string | null };
export type ChecklistDraft = { id: string; template: ChecklistTemplate; record: Checklist | null };
type Query = { status?: ChecklistStatus; after?: string };
type User = { uid: string; getIdToken: () => Promise<string> };
export class ChecklistError extends Error {
  readonly status: number;
  constructor(status: number) { super("Checklist request could not be completed"); this.status = status; }
}
export function validStatus(value: unknown): value is ChecklistStatus { return typeof value === "string" && Object.hasOwn(checklistStatuses, value); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChecklistError(502);
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new ChecklistError(502);
  return value;
}
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new ChecklistError(502);
  return Number(value);
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 15 || value.some((id) => !validServiceId(id)) || new Set(value).size !== value.length) throw new ChecklistError(502);
  return value as string[];
}
export function parseTemplate(value: unknown, pathwayId?: string): ChecklistTemplate {
  const item = object(value);
  if (!validServiceId(item.pathwayId) || (pathwayId && item.pathwayId !== pathwayId) || typeof item.templateVersion !== "string" || !/^[a-f0-9]{64}$/.test(item.templateVersion) || !Array.isArray(item.items) || item.items.length > 15) throw new ChecklistError(502);
  const items = item.items.map((value) => { const entry = object(value); if (!validServiceId(entry.id)) throw new ChecklistError(502); return { id: entry.id, label: text(entry.label), note: text(entry.note) }; });
  ids(items.map((entry) => entry.id));
  return { pathwayId: item.pathwayId, pathwayTitle: text(item.pathwayTitle), sourceReview: parseReview(item.sourceReview), items, templateVersion: item.templateVersion };
}
export function parseSummary(value: unknown): ChecklistSummary {
  const item = object(value);
  const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  if (!validId(item.id) || !validStatus(item.status) || !date(item.createdAt) || !date(item.updatedAt) || Date.parse(item.updatedAt) < Date.parse(item.createdAt)) throw new ChecklistError(502);
  const completedItems = integer(item.completedItems, 0, 15), totalItems = integer(item.totalItems, 0, 15);
  if (completedItems > totalItems || item.status !== (totalItems === 0 ? "empty" : completedItems === totalItems ? "complete" : "in-progress")) throw new ChecklistError(502);
  return { id: item.id, pathwayTitle: text(item.pathwayTitle), completedItems, totalItems, revision: integer(item.revision, 1), status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt };
}
export function parseChecklist(value: unknown, uid: string, id: string): Checklist {
  const item = object(value), template = parseTemplate(item), checkedIds = ids(item.checkedIds);
  if (!validId(id) || item.id !== id || item.uid !== uid || checkedIds.some((id) => !template.items.some((entry) => entry.id === id))) throw new ChecklistError(502);
  const summary = parseSummary({ ...item, completedItems: checkedIds.length, totalItems: template.items.length });
  return { ...template, id, uid, checkedIds, status: summary.status, revision: summary.revision, createdAt: summary.createdAt, updatedAt: summary.updatedAt };
}
// Only validated opaque references and fixed filters enter URLs. Progress is a PUT body.
export function createChecklistApi({ baseUrl, uid, currentUser, request = fetch }: { baseUrl: string; uid: string; currentUser: () => User | null; request?: typeof fetch }) {
  async function read(path: string, method: "GET" | "PUT", body: unknown, signal: AbortSignal, query?: Query) {
    const user = currentUser();
    const active = () => !signal.aborted && currentUser() === user && user?.uid === uid;
    if (!user || !active()) throw new ChecklistError(401);
    const token = await user.getIdToken();
    if (!active()) throw new ChecklistError(401);
    const url = new URL(`${apiOrigin(baseUrl)}/api/v1/checklists${path}`);
    if (query?.status) url.searchParams.set("status", query.status);
    if (query?.after) url.searchParams.set("after", query.after);
    const response = await request(url.href, { method, headers: { Authorization: `Bearer ${token}`, ...(method === "PUT" ? { "Content-Type": "application/json" } : {}) }, ...(method === "PUT" ? { body: JSON.stringify(body) } : {}), signal, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!active()) throw new ChecklistError(401);
    if (!response.ok) throw new ChecklistError(response.status);
    const value: unknown = await response.json();
    if (!active()) throw new ChecklistError(401);
    return value;
  }
  function checkId(id: string) { if (!validId(id)) throw new ChecklistError(422); }
  return {
    async template(pathwayId: string, signal: AbortSignal) {
      if (!validServiceId(pathwayId)) throw new ChecklistError(422);
      return parseTemplate(await read(`/templates/${pathwayId}`, "GET", undefined, signal), pathwayId);
    },
    async get(id: string, signal: AbortSignal) {
      checkId(id); return parseChecklist(object(await read(`/${id}`, "GET", undefined, signal)).checklist, uid, id);
    },
    async save(id: string, template: ChecklistTemplate, checkedIds: string[], revision: number, signal: AbortSignal) {
      checkId(id); const validated = parseTemplate(template);
      const checked = ids(checkedIds);
      if (!Number.isSafeInteger(revision) || revision < 0 || checked.some((id) => !validated.items.some((item) => item.id === id))) throw new ChecklistError(422);
      const body = { pathwayId: validated.pathwayId, templateVersion: validated.templateVersion, checkedIds: [...checked], expectedRevision: revision };
      const result = parseChecklist(object(await read(`/${id}`, "PUT", body, signal)).checklist, uid, id);
      if (result.revision !== revision + 1 || result.pathwayId !== validated.pathwayId || result.templateVersion !== validated.templateVersion || result.checkedIds.length !== checked.length || result.checkedIds.some((id) => !checked.includes(id))) throw new ChecklistError(502);
      return result;
    },
    async list(query: Query, signal: AbortSignal): Promise<ChecklistPage> {
      if ((query.status && !validStatus(query.status)) || (query.after && !validId(query.after))) throw new ChecklistError(422);
      const result = object(await read("", "GET", undefined, signal, query));
      if (!Array.isArray(result.checklists) || result.checklists.length > 50 || (result.nextCursor !== null && !validId(result.nextCursor))) throw new ChecklistError(502);
      const checklists = result.checklists.map(parseSummary);
      if (new Set(checklists.map((record) => record.id)).size !== checklists.length || checklists.some((record) => query.status && record.status !== query.status) || (result.nextCursor && result.nextCursor !== checklists.at(-1)?.id)) throw new ChecklistError(502);
      return { checklists, nextCursor: result.nextCursor as string | null };
    },
  };
}
