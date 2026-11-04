import { NotificationError } from "./notificationApi";
import type { NotificationPage } from "./notificationApi";
export type NotificationState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: NotificationPage; saving: boolean; notice: string };
export class NotificationResource {
  private value: NotificationState = { status: "loading" };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private readonly loader: (signal: AbortSignal) => Promise<NotificationPage>;
  private readonly marker: (ids: readonly string[], signal: AbortSignal) => Promise<void>;
  private readonly timeoutMs: number;
  constructor(loader: (signal: AbortSignal) => Promise<NotificationPage>, marker: (ids: readonly string[], signal: AbortSignal) => Promise<void>, timeoutMs = 15000) { this.loader = loader; this.marker = marker; this.timeoutMs = timeoutMs; }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: NotificationState) { this.value = value; this.listeners.forEach(listener => listener()); }
  private invalidate() { this.epoch++; this.abort?.abort(); }
  private async deadline<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController(); this.abort = abort;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => { onAbort = () => reject(new NotificationError(499)); abort.signal.addEventListener("abort", onAbort, { once: true }); });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try { return await Promise.race([Promise.resolve().then(() => { if (abort.signal.aborted) throw new NotificationError(499); return operation(abort.signal); }), cancelled]); }
    finally { clearTimeout(timer); if (onAbort) abort.signal.removeEventListener("abort", onAbort); }
  }
  start = () => { this.active = true; void this.reload(); return this.stop; };
  stop = () => { this.active = false; this.invalidate(); this.publish({ status: "loading" }); };
  reload = async () => {
    if (!this.active || this.value.status === "ready" && this.value.saving) return;
    this.invalidate(); const ticket = this.epoch; this.publish({ status: "loading" });
    try { const value = await this.deadline(this.loader); if (this.active && ticket === this.epoch) this.publish({ status: "ready", value, saving: false, notice: "" }); }
    catch (error) { if (this.active && ticket === this.epoch) this.publish({ status: "error", message: error instanceof NotificationError && [401,403].includes(error.status) ? "Your session could not access notifications. Sign out and sign in again." : error instanceof NotificationError && error.status === 404 ? "This notification page could not be found for your account. Return to the first page." : "Notifications could not be loaded. Check the API and Firestore connection, then retry." }); }
  };
  markRead = async (ids: readonly string[]) => {
    const previous = this.value;
    if (!this.active || previous.status !== "ready" || previous.saving || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !previous.value.notifications.some(row => row.id === id && !row.isRead))) return;
    const selected = [...ids];
    this.invalidate(); const ticket = this.epoch;
    this.publish({ ...previous, saving: true, notice: "" });
    let confirmed = false;
    try {
      const value = await this.deadline(async signal => { await this.marker(selected, signal); confirmed = true; return this.loader(signal); });
      if (this.active && ticket === this.epoch) this.publish({ status: "ready", value, saving: false, notice: "Read status saved for the selected updates." });
    } catch (error) {
      if (this.active && ticket === this.epoch) this.publish({ status: "error", message: error instanceof NotificationError && [401,403].includes(error.status) ? "Your session could not update notifications. Sign out and sign in again." : confirmed ? "Read status was saved, but the list could not be refreshed. Reload notifications." : "Read status could not be confirmed. Reload notifications before trying again." });
    }
  };
}
