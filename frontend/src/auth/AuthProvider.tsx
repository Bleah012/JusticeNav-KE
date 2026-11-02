import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { onIdTokenChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { backendUrl, firebaseAuth, firebaseConfigured } from "./firebaseClient";
import { initialSession, requestIdentity, SessionController } from "./session";
import { AuthContext } from "./useAuth";
const unconfigured = { status: "unconfigured", hasSession: false } as const;
export function AuthProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(
    () =>
      new SessionController<User>({
        subscribe: (next, failed) =>
          onIdTokenChanged(firebaseAuth(), next, failed),
        verify: async (user, signal) =>
          requestIdentity(
            backendUrl,
            user.uid,
            await user.getIdToken(),
            signal,
          ),
        signOut: () => signOut(firebaseAuth()),
      }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
    () => initialSession,
  );
  useEffect(() => {
    if (!firebaseConfigured) return;
    try {
      return controller.start();
    } catch {
      controller.setupFailed();
    }
  }, [controller]);
  const session = !firebaseConfigured ? unconfigured : state;
  return (
    <AuthContext.Provider
      value={{ session, retry: controller.retry, logout: controller.signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
