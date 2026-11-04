import { ChecklistError } from "./checklistApi";
export type ChecklistState<T> = {
  status: "loading";
} | {
  status: "error";
  message: string;
} | {
  status: "ready";
  value: T;
  saving: boolean;
  needsReload: boolean;
  error: string;
  notice: string;
};
function loadError(error: unknown) {
  if (error instanceof ChecklistError && error.status === 404)
    return "This checklist or pathway could not be found for your account. Return to My Checklists.";
  if (error instanceof ChecklistError && [401, 403].includes(error.status))
    return "Your session could not access this checklist. Sign out and sign in again.";
  return "Checklist information could not be loaded. Check the API and Firestore connection, then retry.";
}
// Bound requests to this account/page lifecycle, including SDKs that ignore cancellation.
export class ChecklistResource<T> {
  private value: ChecklistState<T> = { status: "loading" };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private readonly loader: (signal: AbortSignal) => Promise<T>;
  private readonly timeoutMs: number;
  constructor(loader: (signal: AbortSignal) => Promise<T>, timeoutMs = 15000) { this.loader = loader; this.timeoutMs = timeoutMs; }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: ChecklistState<T>) { this.value = value; this.listeners.forEach((listener) => listener()); }
  private invalidate() { this.epoch++; this.abort?.abort(); }
  private async deadline<R>(operation: (signal: AbortSignal) => Promise<R>): Promise<R> {
    const abort = new AbortController();
    this.abort = abort;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => { onAbort = () => reject(new Error("Cancelled or timed out")); abort.signal.addEventListener("abort", onAbort, { once: true }); });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      return await Promise.race([Promise.resolve().then(() => { if (abort.signal.aborted)
          throw new Error("Cancelled"); return operation(abort.signal); }), cancelled]);
    }
    finally {
      clearTimeout(timer);
      if (onAbort)
        abort.signal.removeEventListener("abort", onAbort);
    }
  }
  start = () => { this.active = true; void this.reload(); return this.stop; };
  stop = () => { this.active = false; this.invalidate(); this.publish({ status: "loading" }); };
  reload = async () => {
    if (!this.active || (this.value.status === "ready" && this.value.saving))
      return;
    this.invalidate();
    const ticket = this.epoch;
    this.publish({ status: "loading" });
    try {
      const value = await this.deadline(this.loader);
      if (this.active && ticket === this.epoch)
        this.publish({ status: "ready", value, saving: false, needsReload: false, error: "", notice: "" });
    }
    catch (error) {
      if (this.active && ticket === this.epoch)
        this.publish({ status: "error", message: loadError(error) });
    }
  };
  mutate = async (operation: (value: T, signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const previous = this.value;
    if (!this.active || previous.status !== "ready" || previous.saving || previous.needsReload)
      return;
    this.invalidate();
    const ticket = this.epoch;
    this.publish({ ...previous, saving: true, error: "", notice: "" });
    try {
      const value = await this.deadline((signal) => operation(previous.value, signal));
      if (!this.active || ticket !== this.epoch)
        return;
      this.publish({ status: "ready", value, saving: false, needsReload: false, error: "", notice: "Your checklist was saved." });
      return value;
    }
    catch (cause) {
      if (!this.active || ticket !== this.epoch)
        return;
      if (cause instanceof ChecklistError && [401, 403, 404].includes(cause.status)) {
        this.publish({ status: "error", message: loadError(cause) });
        return;
      }
      const invalid = cause instanceof ChecklistError && cause.status === 422;
      const conflict = cause instanceof ChecklistError && cause.status === 409;
      this.publish({ ...previous, saving: false, notice: "", needsReload: !invalid, error: invalid ? "Check the preparation items before saving again." : conflict ? "This checklist or source template changed. Reload its saved version before saving again. Your edits remain in this form until you reload." : "The save could not be confirmed. Reload to check the saved version before trying again. You can also check My Checklists." });
    }
  };
}
