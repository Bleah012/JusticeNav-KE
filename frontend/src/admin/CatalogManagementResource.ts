import { AdminApiError } from "./adminApi";

export type CatalogManagementState<Value> = {
  status: "loading" | "ready" | "error" | "forbidden";
  value: Value | null;
  busy: boolean;
  needsReload: boolean;
  message: string;
};
export type ManagementApi<Value, Command> = {
  read: (signal: AbortSignal) => Promise<Value>;
  write: (command: Command, signal: AbortSignal) => Promise<void>;
};

// Serialize mutations and require a fresh read after conflicts or uncertain outcomes.
export class CatalogManagementResource<
  Value,
  Command extends { type: string },
> {
  private state: CatalogManagementState<Value> = {
    status: "loading",
    value: null,
    busy: false,
    needsReload: false,
    message: "",
  };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private readonly api: ManagementApi<Value, Command>;
  private readonly timeoutMs: number;
  private readonly subject: string;
  constructor(
    api: ManagementApi<Value, Command>,
    timeoutMs = 12000,
    subject = "service",
  ) {
    this.subject = subject;
    this.api = api;
    this.timeoutMs = timeoutMs;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<CatalogManagementState<Value>>) {
    if (patch.message)
      patch.message = patch.message
        .replaceAll(
          "Service",
          this.subject[0].toUpperCase() + this.subject.slice(1),
        )
        .replaceAll("service", this.subject);
    this.state = { ...this.state, ...patch };
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
    this.publish({ status: "loading", value: null, busy: false });
  };
  private async bounded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const abort = new AbortController();
    this.abort = abort;
    let cancelled: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      cancelled = () => reject(new AdminApiError(499));
      abort.signal.addEventListener("abort", cancelled, { once: true });
    });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      return await Promise.race([operation(abort.signal), timeout]);
    } finally {
      clearTimeout(timer);
      if (cancelled) abort.signal.removeEventListener("abort", cancelled);
    }
  }
  reload = async () => {
    if (!this.active || this.state.busy) return;
    this.abort?.abort();
    const ticket = ++this.epoch;
    this.publish({
      status: "loading",
      value: null,
      message: "",
      needsReload: true,
    });
    try {
      const value = await this.bounded((signal) => this.api.read(signal));
      if (this.active && ticket === this.epoch)
        this.publish({ status: "ready", value, needsReload: false });
    } catch (error) {
      if (this.active && ticket === this.epoch) this.fail(error, false);
    }
  };
  private fail(error: unknown, writing: boolean) {
    const status = error instanceof AdminApiError ? error.status : 0;
    if ([401, 403].includes(status)) {
      this.publish({
        status: "forbidden",
        value: null,
        busy: false,
        needsReload: true,
        message: "Administrator access could not be confirmed.",
      });
      return;
    }
    this.publish({
      status: this.state.value ? "ready" : "error",
      busy: false,
      needsReload: status !== 422,
      message:
        status === 422
          ? "Check the required fields and source-review confirmation."
          : status === 409
            ? "This service changed or the action is protected. Reload services before continuing."
            : writing
              ? "The change could not be confirmed. Reload services and inspect the record before trying again."
              : "Services could not be loaded. Check the API and Firestore connection, then reload.",
    });
  }
  change = async (command: Command): Promise<boolean> => {
    if (
      !this.active ||
      this.state.status !== "ready" ||
      this.state.busy ||
      this.state.needsReload
    )
      return false;
    const ticket = ++this.epoch;
    this.publish({ busy: true, message: "" });
    let confirmed = false;
    try {
      await this.bounded((signal) => this.api.write(command, signal));
      if (!this.active || ticket !== this.epoch) return false;
      confirmed = true;
      const value = await this.bounded((signal) => this.api.read(signal));
      if (!this.active || ticket !== this.epoch) return false;
      this.publish({
        status: "ready",
        value,
        busy: false,
        needsReload: false,
        message:
          command.type === "delete"
            ? "Draft deleted."
            : "Service change saved.",
      });
      return true;
    } catch (error) {
      if (!this.active || ticket !== this.epoch) return false;
      if (confirmed)
        this.publish({
          status: "error",
          value: null,
          busy: false,
          needsReload: true,
          message:
            "The change was saved, but the list could not be refreshed. Reload services.",
        });
      else this.fail(error, true);
      return confirmed;
    }
  };
}
