import { useEffect, useState, useSyncExternalStore } from "react";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { createNotificationApi } from "./notificationApi";
import type { NotificationQuery } from "./notificationApi";
import { NotificationResource } from "./NotificationResource";
export function useNotifications(uid: string, query: NotificationQuery) {
  const [resource] = useState(() => { const api = createNotificationApi({ baseUrl: backendUrl, uid, currentUser: () => firebaseAuth().currentUser }); return new NotificationResource(signal => api.list(query, signal), (ids, signal) => api.markRead(ids, signal)); });
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => resource.start(), [resource]);
  return { state, refresh: () => void resource.reload(), markRead: (ids: readonly string[]) => void resource.markRead(ids) };
}
