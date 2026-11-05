import { AdminApiError } from "./adminApi";

export type AdminState<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "forbidden" }
  | { status: "ready"; value: T };

// Bound admin reads to an account/page lifecycle; failures clear old records.
export class AdminResource<T> {
  private state: AdminState<T> = { status: "loading" };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private readonly loader: (signal: AbortSignal) => Promise<T>;
  private readonly allowForbidden: boolean;
  private readonly timeoutMs: number;
  constructor(
    loader: (signal: AbortSignal) => Promise<T>,
    allowForbidden = true,
    timeoutMs = 12000,
  ) {
    this.loader = loader;
    this.allowForbidden = allowForbidden;
    this.timeoutMs = timeoutMs;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: AdminState<T>) {
    this.state = state;
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
      onAbort = () => reject(new AdminApiError(499));
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          if (abort.signal.aborted) throw new AdminApiError(499);
          return this.loader(abort.signal);
        }),
        cancelled,
      ]);
      if (this.active && ticket === this.epoch)
        this.publish({ status: "ready", value });
    } catch (error) {
      if (this.active && ticket === this.epoch)
        this.publish({
          status:
            this.allowForbidden &&
            error instanceof AdminApiError &&
            [401, 403].includes(error.status)
              ? "forbidden"
              : "error",
        });
    } finally {
      clearTimeout(timer);
      if (onAbort) abort.signal.removeEventListener("abort", onAbort);
    }
  };
}
