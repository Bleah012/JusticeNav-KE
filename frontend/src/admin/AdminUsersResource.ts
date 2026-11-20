import { AdminApiError } from "./adminApi";
import type {
  Account,
  AccountInput,
  AccountPage,
  createAdminUsersApi,
} from "./adminUsersApi";

export type UsersState = {
  status: "loading" | "ready" | "error" | "forbidden";
  page: AccountPage | null;
  busy: boolean;
  needsReload: boolean;
  message: string;
  created: Account | null;
};
export class AdminUsersResource {
  private state: UsersState = {
    status: "loading",
    page: null,
    busy: false,
    needsReload: false,
    message: "",
    created: null,
  };
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private pending?: string;
  private listeners = new Set<() => void>();
  private readonly api: ReturnType<typeof createAdminUsersApi>;
  private readonly after?: string;
  private readonly timeoutMs: number;
  constructor(
    api: ReturnType<typeof createAdminUsersApi>,
    after?: string,
    timeoutMs = 15000,
  ) {
    this.api = api;
    this.after = after;
    this.timeoutMs = timeoutMs;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<UsersState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async bounded<T>(operation: (signal: AbortSignal) => Promise<T>) {
    const abort = new AbortController();
    this.abort = abort;
    let cancel: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => reject(new AdminApiError(499));
      abort.signal.addEventListener("abort", cancel, { once: true });
    });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      return await Promise.race([operation(abort.signal), cancelled]);
    } finally {
      clearTimeout(timer);
      if (cancel) abort.signal.removeEventListener("abort", cancel);
    }
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
    this.publish({
      status: "loading",
      page: null,
      busy: false,
      created: null,
      message: "",
    });
  };
  private fail(error: unknown, writing: boolean) {
    const status = error instanceof AdminApiError ? error.status : 0;
    const denied = status === 401 || status === 403;
    this.publish({
      status: denied ? "forbidden" : this.state.page ? "ready" : "error",
      page: denied ? null : this.state.page,
      created: denied ? null : this.state.created,
      busy: false,
      needsReload: status !== 422,
      message: denied
        ? "Administrator access could not be confirmed."
        : status === 422
          ? "Check the account fields, password requirements and role confirmation."
          : status === 409
            ? "The email or creation reference already exists. Reload accounts and inspect before continuing."
            : writing
              ? "Account creation could not be confirmed. Reload accounts to inspect the result before trying again."
              : "Accounts could not be loaded. Check the API and Firebase Authentication permissions, then reload.",
    });
  }
  reload = async () => {
    if (!this.active || this.state.busy) return;
    this.abort?.abort();
    const ticket = ++this.epoch;
    this.publish({
      status: "loading",
      page: null,
      needsReload: true,
      message: "",
    });
    try {
      const pending = this.pending;
      const result = await this.bounded(async (signal) => {
        const recovered = pending
          ? await this.api.lookup(pending, signal)
          : undefined;
        return { recovered, page: await this.api.list(this.after, signal) };
      });
      if (!this.active || ticket !== this.epoch) return;
      this.pending = undefined;
      this.publish({
        status: "ready",
        page: result.page,
        needsReload: false,
        created: result.recovered ?? this.state.created,
        message: pending
          ? result.recovered
            ? "Account found. Inspect its role and status below. A disabled account may need setup checked in Firebase Console before it can sign in."
            : "No account was found for the last creation reference. Review the list and email before making a new attempt."
          : "",
      });
    } catch (error) {
      if (this.active && ticket === this.epoch) this.fail(error, false);
    }
  };
  create = async (id: string, input: AccountInput) => {
    if (
      !this.active ||
      this.state.status !== "ready" ||
      this.state.busy ||
      this.state.needsReload
    )
      return false;
    const ticket = ++this.epoch;
    this.pending = id;
    this.publish({ busy: true, created: null, message: "" });
    let confirmed = false;
    try {
      const created = await this.bounded((signal) =>
        this.api.create(id, input, signal),
      );
      if (!this.active || ticket !== this.epoch) return false;
      confirmed = true;
      this.pending = undefined;
      this.publish({ created });
      const page = await this.bounded((signal) =>
        this.api.list(this.after, signal),
      );
      if (!this.active || ticket !== this.epoch) return false;
      this.publish({
        status: "ready",
        page,
        busy: false,
        needsReload: false,
        message:
          "Account created. Sign in separately using the new account email and initial password.",
      });
      return true;
    } catch (error) {
      if (!this.active || ticket !== this.epoch) return false;
      if (confirmed)
        this.publish({
          status: "error",
          page: null,
          busy: false,
          needsReload: true,
          message:
            "The account was created, but the list could not be refreshed. Reload accounts.",
        });
      else this.fail(error, true);
      return confirmed;
    }
  };
}
