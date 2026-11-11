import { apiOrigin } from "../auth/session";
export const statusLabels = { draft: "Draft", "needs-clarification": "Needs clarification", "awaiting-pathways": "Awaiting pathways" } as const;
export type AssessmentStatus = keyof typeof statusLabels;
export type Answers = {
  issue: "consumer" | "money-debt" | "other" | null;
  timeframe: "recent" | "months" | "older" | "unsure" | null;
  contact: "yes" | "no" | "unsure" | null;
};
export type AssessmentSummary = {
  id: string;
  status: AssessmentStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Assessment = AssessmentSummary & {
  uid: string;
  description: string;
  answers: Answers;
};
export type AssessmentPage = {
  assessments: AssessmentSummary[];
  nextCursor: string | null;
};
export type Update = {
  step: "describe";
  description: string;
  proceed: boolean;
} | {
  step: "clarify";
  answers: Answers;
  proceed: boolean;
};
type User = {
  uid: string;
  getIdToken: () => Promise<string>;
};
type Query = {
  status?: AssessmentStatus;
  after?: string;
};
type Request = (uid: string, id: string | null, method: "GET" | "PUT", body: unknown, signal: AbortSignal, query?: Query & { suggestionRevision?: number }) => Promise<unknown>;
export class AssessmentError extends Error {
  readonly status: number;
  constructor(status: number) { super("Assessment request could not be completed"); this.status = status; }
}
export function validId(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{32}$/.test(value); }
export function validStatus(value: unknown): value is AssessmentStatus { return typeof value === "string" && Object.hasOwn(statusLabels, value); }
// Only opaque identifiers and fixed status/cursor options can enter an assessment URL.
export function createAssessmentRequest({ baseUrl, currentUser, request = fetch }: {
  baseUrl: string;
  currentUser: () => User | null;
  request?: typeof fetch;
}): Request {
  return async (uid, id, method, body, signal, query = {}) => {
    if ((id !== null && !validId(id)) || (method === "PUT" && id === null) || (query.status && !validStatus(query.status)) || (query.after && !validId(query.after)))
      throw new AssessmentError(422);
    const revision = query.suggestionRevision;
    if (revision !== undefined && (method !== "GET" || id === null ||
      !Number.isSafeInteger(revision) || revision < 1 || query.status || query.after))
      throw new AssessmentError(422);
    const user = currentUser();
    if (!user || user.uid !== uid || signal.aborted)
      throw new AssessmentError(401);
    const token = await user.getIdToken();
    if (signal.aborted || currentUser() !== user)
      throw new AssessmentError(401);
    const url = new URL(`${apiOrigin(baseUrl)}/api/v1/assessments${id ? `/${id}` : ""}`);
    if (revision !== undefined) {
      url.pathname += "/issue-suggestion";
      url.searchParams.set("revision", String(revision));
    }
    if (query.status)
      url.searchParams.set("status", query.status);
    if (query.after)
      url.searchParams.set("after", query.after);
    const response = await request(url.href, { method, headers: { Authorization: `Bearer ${token}`, ...(method === "PUT" ? { "Content-Type": "application/json" } : {}) }, ...(method === "PUT" ? { body: JSON.stringify(body) } : {}), signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    if (signal.aborted || currentUser() !== user)
      throw new AssessmentError(401);
    if (!response.ok)
      throw new AssessmentError(response.status);
    const result: unknown = await response.json();
    if (signal.aborted || currentUser() !== user)
      throw new AssessmentError(401);
    return result;
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid assessment response");
  return value as Record<string, unknown>;
}
function summary(value: unknown): AssessmentSummary {
  const item = object(value);
  const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  if (!validId(item.id) || !validStatus(item.status) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1 || !date(item.createdAt) || !date(item.updatedAt) || Date.parse(item.updatedAt) < Date.parse(item.createdAt))
    throw new Error("Invalid assessment response");
  return { id: item.id, status: item.status, revision: Number(item.revision), createdAt: item.createdAt, updatedAt: item.updatedAt };
}
export function parseAssessment(value: unknown, uid: string, id: string): Assessment {
  const item = object(value), basic = summary(item), answers = object(item.answers);
  if (item.uid !== uid || basic.id !== id || typeof item.description !== "string" || !item.description.trim() || item.description.length > 1500 ||
    ![null, "consumer", "money-debt", "other"].includes(answers.issue as null) || ![null, "recent", "months", "older", "unsure"].includes(answers.timeframe as null) || ![null, "yes", "no", "unsure"].includes(answers.contact as null))
    throw new Error("Invalid assessment response");
  if (Boolean(answers.issue && answers.timeframe && answers.contact) !== (basic.status === "awaiting-pathways"))
    throw new Error("Invalid saved progress");
  return { ...basic, uid, description: item.description, answers: { issue: answers.issue, timeframe: answers.timeframe, contact: answers.contact } as Answers };
}
export function createAssessmentApi(uid: string, request: Request) {
  return {
    async get(id: string, signal: AbortSignal): Promise<Assessment> {
      const result = object(await request(uid, id, "GET", undefined, signal));
      return parseAssessment(result.assessment, uid, id);
    },
    async suggestIssue(id: string, revision: number, signal: AbortSignal): Promise<Answers["issue"]> {
      const result = object(await request(uid, id, "GET", undefined, signal, { suggestionRevision: revision }));
      const issue = result.issue;
      if (result.assessmentId !== id || result.revision !== revision ||
        (issue !== null && issue !== "consumer" && issue !== "money-debt" && issue !== "other"))
        throw new AssessmentError(502);
      return issue;
    },
    async save(id: string, update: Update, revision: number, signal: AbortSignal): Promise<Assessment> {
      // Whitelist fields even when callers supply extra identity, status or result properties.
      const body = update.step === "describe" ? { step: update.step, description: update.description, proceed: update.proceed, expectedRevision: revision } : { step: update.step, answers: { issue: update.answers.issue, timeframe: update.answers.timeframe, contact: update.answers.contact }, proceed: update.proceed, expectedRevision: revision };
      const result = parseAssessment(object(await request(uid, id, "PUT", body, signal)).assessment, uid, id);
      if (result.revision !== revision + 1)
        throw new Error("Unexpected saved revision");
      return result;
    },
    async list(query: Query, signal: AbortSignal): Promise<AssessmentPage> {
      const result = object(await request(uid, null, "GET", undefined, signal, query));
      if (!Array.isArray(result.assessments) || result.assessments.length > 50 || (result.nextCursor !== null && !validId(result.nextCursor)))
        throw new Error("Invalid assessment list");
      const assessments = result.assessments.map(summary);
      if (new Set(assessments.map((item) => item.id)).size !== assessments.length || assessments.some((item) => query.status && item.status !== query.status))
        throw new Error("Invalid assessment list");
      if (result.nextCursor && result.nextCursor !== assessments.at(-1)?.id)
        throw new Error("Invalid cursor");
      return { assessments, nextCursor: result.nextCursor as string | null };
    },
  };
}
