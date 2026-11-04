import { DashboardError } from "./dashboardApi";
import type { DashboardSnapshot } from "./dashboardApi";

export type DashboardState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: DashboardSnapshot };
export class DashboardResource {
  private value: DashboardState = { status: "loading" };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private readonly loader: (signal: AbortSignal) => Promise<DashboardSnapshot>;
  private readonly timeoutMs: number;
  constructor(
    loader: (signal: AbortSignal) => Promise<DashboardSnapshot>,
    timeoutMs = 15000,
  ) {
    this.loader = loader;
    this.timeoutMs = timeoutMs;
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: DashboardState) {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
  start = () => {
    this.active = true;
    void this.reload();
    return this.stop;
  };
  stop = () => {
    this.active = false;
    this.epoch++;
    this.abort?.abort();
    this.publish({ status: "loading" });
  };
  reload = async () => {
    if (!this.active) return;
    this.abort?.abort();
    const ticket = ++this.epoch,
      abort = new AbortController();
    this.abort = abort;
    this.publish({ status: "loading" });
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new DashboardError(499));
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          if (abort.signal.aborted) throw new DashboardError(499);
          return this.loader(abort.signal);
        }),
        cancelled,
      ]);
      if (this.active && ticket === this.epoch)
        this.publish({ status: "ready", value });
    } catch (error) {
      if (this.active && ticket === this.epoch)
        this.publish({
          status: "error",
          message:
            error instanceof DashboardError && [401, 403].includes(error.status)
              ? "Your session could not access this dashboard. Sign out and sign in again."
              : "Your dashboard could not be loaded. Check the API and Firestore connection, then try again.",
        });
    } finally {
      clearTimeout(timer);
      if (onAbort) abort.signal.removeEventListener("abort", onAbort);
    }
  };
}
