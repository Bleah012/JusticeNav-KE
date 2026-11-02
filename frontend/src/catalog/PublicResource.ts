import { CatalogError } from "./catalogApi";

export type PublicState<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not-found" }
  | { status: "ready"; value: T };

// Bound public reads to their page/identifier, with a timeout and explicit retry.
export class PublicResource<T> {
  private state: PublicState<T> = { status: "loading" };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private readonly loader: (signal: AbortSignal) => Promise<T>;
  private readonly allowNotFound: boolean;
  private readonly timeoutMs: number;
  constructor(
    loader: (signal: AbortSignal) => Promise<T>,
    allowNotFound = false,
    timeoutMs = 12000,
  ) {
    this.loader = loader;
    this.allowNotFound = allowNotFound;
    this.timeoutMs = timeoutMs;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: PublicState<T>) {
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
      onAbort = () => reject(new CatalogError(499));
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          if (abort.signal.aborted) throw new CatalogError(499);
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
            this.allowNotFound &&
            error instanceof CatalogError &&
            error.status === 404
              ? "not-found"
              : "error",
        });
    } finally {
      clearTimeout(timer);
      if (onAbort) abort.signal.removeEventListener("abort", onAbort);
    }
  };
}
