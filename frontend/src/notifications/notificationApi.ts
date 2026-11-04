import { apiOrigin } from "../auth/session";
import { validId, statusLabels } from "../assessments/assessmentApi";
import type { AssessmentStatus } from "../assessments/assessmentApi";
import { validDate } from "../referrals/referralApi";

export type Notification = { id: string; kind: "assessment" | "checklist" | "referral"; recordId: string; recordRevision: number; assessmentStatus: AssessmentStatus | null; createdAt: string; isRead: boolean; readAt: string | null };
export type NotificationPage = { uid: string; notifications: Notification[]; nextCursor: string | null };
export type NotificationQuery = { unread: boolean; after?: string };
type User = { uid: string; getIdToken: () => Promise<string> };
export class NotificationError extends Error {
  readonly status: number;
  constructor(status: number) { super("Notification request could not be completed"); this.status = status; }
}
export function validNotificationId(value: unknown): value is string { return typeof value === "string" && /^[0-9]{20}-[a-f0-9]{64}$/.test(value); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NotificationError(502);
  return value as Record<string, unknown>;
}
export function parseNotification(value: unknown): Notification {
  const row = object(value);
  if (!validNotificationId(row.id) || !validId(row.recordId) || !["assessment", "checklist", "referral"].includes(String(row.kind)) || !Number.isSafeInteger(row.recordRevision) || Number(row.recordRevision) < 1 || !validDate(row.createdAt) || typeof row.isRead !== "boolean") throw new NotificationError(502);
  if (row.kind === "assessment" ? typeof row.assessmentStatus !== "string" || !Object.hasOwn(statusLabels, row.assessmentStatus) : row.assessmentStatus !== null) throw new NotificationError(502);
  if (row.isRead ? !validDate(row.readAt) || Date.parse(row.readAt) < Date.parse(row.createdAt) : row.readAt !== null) throw new NotificationError(502);
  return { id: row.id, kind: row.kind as Notification["kind"], recordId: row.recordId, recordRevision: Number(row.recordRevision), assessmentStatus: row.assessmentStatus as AssessmentStatus | null, createdAt: row.createdAt, isRead: row.isRead, readAt: row.readAt as string | null };
}
export function parseNotificationPage(value: unknown, uid: string, query: NotificationQuery): NotificationPage {
  const data = object(value);
  if (data.uid !== uid || !Array.isArray(data.notifications) || data.notifications.length > 50 || data.nextCursor !== null && !validNotificationId(data.nextCursor)) throw new NotificationError(502);
  const notifications = data.notifications.map(parseNotification);
  if (new Set(notifications.map(row => row.id)).size !== notifications.length || notifications.some((row, index) => query.unread && row.isRead || query.after && row.id >= query.after || index > 0 && row.id >= notifications[index-1].id) || data.nextCursor && data.nextCursor !== notifications.at(-1)?.id) throw new NotificationError(502);
  return { uid, notifications, nextCursor: data.nextCursor as string | null };
}
export function notificationLink(item: Notification): string {
  if (item.kind === "assessment") return `/app/assessments/${item.recordId}/${item.assessmentStatus === "draft" ? "describe" : item.assessmentStatus === "awaiting-pathways" ? "results" : "clarify"}`;
  return item.kind === "checklist" ? `/app/checklists/${item.recordId}` : `/app/referrals/${item.recordId}`;
}
export const notificationTitles = { assessment: "Assessment saved", checklist: "Checklist progress saved", referral: "Project referral saved" } as const;
export function createNotificationApi({ baseUrl, uid, currentUser, request = fetch }: { baseUrl: string; uid: string; currentUser: () => User | null; request?: typeof fetch }) {
  async function read(path: string, method: "GET" | "PUT", body: unknown, signal: AbortSignal) {
    const user = currentUser();
    const active = () => !signal.aborted && currentUser() === user && user?.uid === uid;
    if (!user || !active()) throw new NotificationError(401);
    const token = await user.getIdToken();
    if (!active()) throw new NotificationError(401);
    const response = await request(`${apiOrigin(baseUrl)}/api/v1/notifications${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(method === "PUT" ? { "Content-Type": "application/json" } : {}) }, ...(method === "PUT" ? { body: JSON.stringify(body) } : {}), signal, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    if (!active()) throw new NotificationError(401);
    if (!response.ok) throw new NotificationError(response.status);
    const result: unknown = await response.json();
    if (!active()) throw new NotificationError(401);
    return result;
  }
  return {
    async list(query: NotificationQuery, signal: AbortSignal): Promise<NotificationPage> {
      if (typeof query.unread !== "boolean" || query.after !== undefined && !validNotificationId(query.after)) throw new NotificationError(422);
      const params = new URLSearchParams(); if (query.unread) params.set("unread", "true"); if (query.after) params.set("after", query.after);
      return parseNotificationPage(await read(params.size ? `?${params}` : "", "GET", undefined, signal), uid, query);
    },
    async markRead(ids: readonly string[], signal: AbortSignal): Promise<void> {
      if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some(id => !validNotificationId(id))) throw new NotificationError(422);
      const result = object(await read("/read", "PUT", { notificationIds: [...ids] }, signal));
      if (result.uid !== uid || !Array.isArray(result.notificationIds) || result.notificationIds.length !== ids.length || new Set(result.notificationIds).size !== ids.length || result.notificationIds.some(id => typeof id !== "string" || !ids.includes(id))) throw new NotificationError(502);
    },
  };
}
