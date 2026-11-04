import { useEffect, useState, useSyncExternalStore } from "react";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { createDashboardApi } from "./dashboardApi";
import { DashboardResource } from "./DashboardResource";
export function useDashboard(uid: string) {
  const [resource] = useState(
    () =>
      new DashboardResource(
        createDashboardApi({
          baseUrl: backendUrl,
          uid,
          currentUser: () => firebaseAuth().currentUser,
        }),
      ),
  );
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return { state, refresh: () => void resource.reload() };
}
