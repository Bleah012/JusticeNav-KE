import { useEffect, useState, useSyncExternalStore } from "react";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { createAdminApi } from "./adminApi";
import type { AdminKind } from "./adminApi";
import { AdminResource } from "./AdminResource";
export function useAdminCatalog(uid: string, kind: AdminKind) {
  const [resource] = useState(() => {
    const api = createAdminApi({
      baseUrl: backendUrl,
      uid,
      currentUser: () => firebaseAuth().currentUser,
    });
    return new AdminResource((signal) => api(kind, signal));
  });
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return { state, refresh: () => void resource.reload() };
}
