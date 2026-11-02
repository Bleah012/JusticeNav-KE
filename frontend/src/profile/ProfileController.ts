import { ProfileApiError } from "../api/authenticatedRequest";
import type { ProfileApi, ProfileFields, SavedProfile } from "./profileModel";
export type ProfileState =
  | {
      status: "loading";
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "ready";
      profile: SavedProfile | null;
      saving: boolean;
      notice: string;
      error: string;
      needsReload: boolean;
    };
function loadError(cause: unknown) {
  if (cause instanceof ProfileApiError && cause.status === 401)
    return "Your session could not be verified. Sign out and sign in again.";
  if (cause instanceof ProfileApiError && cause.status === 403)
    return "Your account cannot access this profile.";
  return "Your profile could not be loaded. Check the API and Firestore setup, then retry.";
}
// Own the request lifecycle so obsolete responses cannot cross account or page boundaries.
export class ProfileController {
  private readonly api: ProfileApi;
  private readonly timeoutMs: number;
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private value: ProfileState = { status: "loading" };
  private listeners = new Set<() => void>();
  constructor(api: ProfileApi, timeoutMs = 15000) {
    this.api = api;
    this.timeoutMs = timeoutMs;
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: ProfileState) {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
  private invalidate() {
    this.epoch++;
    this.abort?.abort();
    this.abort = undefined;
  }
  private async deadline<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const abort = new AbortController();
    this.abort = abort;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Request cancelled or timed out"));
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (abort.signal.aborted) throw new Error("Request cancelled");
          return operation(abort.signal);
        }),
        cancelled,
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) abort.signal.removeEventListener("abort", onAbort);
    }
  }
  start = () => {
    this.active = true;
    void this.reload();
    return this.stop;
  };
  stop = () => {
    this.active = false;
    this.invalidate();
    this.publish({ status: "loading" });
  };
  reload = async () => {
    if (!this.active || (this.value.status === "ready" && this.value.saving))
      return;
    this.invalidate();
    const ticket = this.epoch;
    this.publish({ status: "loading" });
    try {
      const profile = await this.deadline((signal) => this.api.load(signal));
      if (this.active && ticket === this.epoch)
        this.publish({
          status: "ready",
          profile,
          saving: false,
          notice: "",
          error: "",
          needsReload: false,
        });
    } catch (cause) {
      if (this.active && ticket === this.epoch)
        this.publish({ status: "error", message: loadError(cause) });
    }
  };
  save = async (fields: ProfileFields) => {
    const previous = this.value;
    if (
      !this.active ||
      previous.status !== "ready" ||
      previous.saving ||
      previous.needsReload
    )
      return;
    this.invalidate();
    const ticket = this.epoch;
    this.publish({ ...previous, saving: true, notice: "", error: "" });
    try {
      const profile = await this.deadline((signal) =>
        this.api.save(fields, previous.profile?.revision ?? 0, signal),
      );
      if (this.active && ticket === this.epoch)
        this.publish({
          status: "ready",
          profile,
          saving: false,
          notice: "Your profile changes were saved.",
          error: "",
          needsReload: false,
        });
    } catch (cause) {
      if (!this.active || ticket !== this.epoch) return;
      if (
        cause instanceof ProfileApiError &&
        [401, 403].includes(cause.status)
      ) {
        this.publish({ status: "error", message: loadError(cause) });
        return;
      }
      const conflict = cause instanceof ProfileApiError && cause.status === 409;
      const invalid = cause instanceof ProfileApiError && cause.status === 422;
      const error = conflict
        ? "This profile changed in another tab or request. Reload the latest saved version before saving again."
        : invalid
          ? "The profile was rejected. Check your name, phone number and preferred language."
          : "The save could not be confirmed. Reload the profile to check its latest saved version before trying again.";
      this.publish({
        ...previous,
        saving: false,
        notice: "",
        error,
        needsReload: !invalid,
      });
    }
  };
}
