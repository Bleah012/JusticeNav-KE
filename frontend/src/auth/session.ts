export type Role = "seeker" | "provider" | "admin";
export type Identity = {
  uid: string;
  role: Role;
  emailVerified: boolean;
};
export type Session =
  | {
      status: "loading" | "guest" | "unconfigured";
      hasSession: false;
    }
  | {
      status: "verifying" | "signing-out";
      hasSession: true;
    }
  | {
      status: "ready";
      hasSession: true;
      identity: Identity;
    }
  | {
      status: "error";
      hasSession: boolean;
      message: string;
    };
export const initialSession: Session = { status: "loading", hasSession: false };
export const unavailableMessage =
  "Firebase authentication is not configured. Please check the local setup.";
export function workspaceFor(role: Role): string {
  return role === "admin"
    ? "/admin"
    : role === "provider"
      ? "/provider"
      : "/app";
}
// Only accept a complete backend identity belonging to the current Firebase user.
export function parseIdentity(value: unknown, uid: string): Identity {
  const item = value as Partial<Identity> | null;
  if (
    !item ||
    item.uid !== uid ||
    !["seeker", "provider", "admin"].includes(item.role ?? "") ||
    typeof item.emailVerified !== "boolean"
  ) {
    throw new Error("Invalid identity response");
  }
  return { uid, role: item.role as Role, emailVerified: item.emailVerified };
}
export function apiOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Invalid API origin");
  }
  return url.origin;
}
export class IdentityError extends Error {}
// Keep bearer tokens in request memory; never follow redirects with identity requests.
export async function requestIdentity(
  baseUrl: string,
  uid: string,
  token: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Identity> {
  const response = await request(`${apiOrigin(baseUrl)}/api/v1/auth/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (response.status === 401)
    throw new IdentityError(
      "Your session could not be verified. Sign out and sign in again.",
    );
  if (response.status === 403)
    throw new IdentityError(
      "This account does not have an allowed application role. Contact the project administrator.",
    );
  if (!response.ok)
    throw new IdentityError(
      "Firebase is signed in, but backend verification is unavailable. Check the API and its Firebase credentials, then retry.",
    );
  return parseIdentity(await response.json(), uid);
}
type SessionUser = {
  uid: string;
};
type Dependencies<U extends SessionUser> = {
  subscribe: (next: (user: U | null) => void, error: () => void) => () => void;
  verify: (user: U, signal: AbortSignal) => Promise<Identity>;
  signOut: () => Promise<void>;
};
// Invalidate older requests on token changes, sign-out and StrictMode cleanup.
export class SessionController<U extends SessionUser> {
  private value: Session = initialSession;
  private listeners = new Set<() => void>();
  private user: U | null = null;
  private active = false;
  private epoch = 0;
  private abort?: AbortController;
  private unsubscribe?: () => void;
  private signingOut?: Promise<void>;
  private lifecycle = 0;
  private readonly dependencies: Dependencies<U>;
  constructor(dependencies: Dependencies<U>) {
    this.dependencies = dependencies;
  }
  snapshot = (): Session => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: Session) {
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
  private invalidate() {
    this.epoch++;
    this.abort?.abort();
    this.abort = undefined;
  }
  start = () => {
    this.active = true;
    const lifecycle = ++this.lifecycle;
    this.publish(initialSession);
    this.unsubscribe = this.dependencies.subscribe(
      (user) => {
        if (this.active && lifecycle === this.lifecycle) this.receive(user);
      },
      () => {
        if (!this.active || lifecycle !== this.lifecycle) return;
        this.invalidate();
        this.publish({
          status: "error",
          hasSession: Boolean(this.user),
          message:
            "Authentication could not be loaded. Reload the page to retry.",
        });
      },
    );
    return this.stop;
  };
  stop = () => {
    this.active = false;
    this.unsubscribe?.();
    this.invalidate();
  };
  setupFailed = () => {
    this.stop();
    this.publish({ status: "unconfigured", hasSession: false });
  };
  private receive = (user: U | null) => {
    if (!this.active) return;
    this.invalidate();
    this.user = user;
    if (!user) {
      this.publish({ status: "guest", hasSession: false });
      return;
    }
    if (this.signingOut) return;
    this.publish({ status: "verifying", hasSession: true });
    const ticket = this.epoch;
    const abort = new AbortController();
    this.abort = abort;
    const timeout = setTimeout(() => abort.abort(), 15000);
    let onAbort: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Verification cancelled"));
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    const verification = Promise.resolve().then(() => {
      if (abort.signal.aborted) throw new Error("Verification cancelled");
      return this.dependencies.verify(user, abort.signal);
    });
    void Promise.race([verification, cancelled])
      .then((identity) => {
        if (this.active && ticket === this.epoch)
          this.publish({
            status: "ready",
            hasSession: true,
            identity: parseIdentity(identity, user.uid),
          });
      })
      .catch((error: unknown) => {
        if (this.active && ticket === this.epoch)
          this.publish({
            status: "error",
            hasSession: true,
            message:
              error instanceof IdentityError
                ? error.message
                : "Backend identity verification failed or timed out. Check the API connection and retry.",
          });
      })
      .finally(() => {
        clearTimeout(timeout);
        abort.signal.removeEventListener("abort", onAbort);
      });
  };
  retry = () => {
    if (!this.signingOut) this.receive(this.user);
  };
  signOut = (): Promise<void> => {
    if (this.signingOut) return this.signingOut;
    this.invalidate();
    this.publish({ status: "signing-out", hasSession: true });
    this.signingOut = Promise.resolve()
      .then(() => this.dependencies.signOut())
      .then(() => {
        this.user = null;
        if (this.active) this.publish({ status: "guest", hasSession: false });
      })
      .catch(() => {
        if (this.active)
          this.publish({
            status: "error",
            hasSession: true,
            message:
              "Sign-out could not be completed. Retry signing out before leaving this shared device.",
          });
      })
      .finally(() => {
        this.signingOut = undefined;
      });
    return this.signingOut;
  };
}
