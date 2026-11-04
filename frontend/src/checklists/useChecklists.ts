import { useEffect, useState, useSyncExternalStore } from "react";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { ChecklistError, createChecklistApi, parseTemplate } from "./checklistApi";
import type { ChecklistDraft, ChecklistStatus } from "./checklistApi";
import { ChecklistResource } from "./ChecklistResource";

function apiFor(uid: string) { return createChecklistApi({ baseUrl: backendUrl, uid, currentUser: () => firebaseAuth().currentUser }); }
export function useChecklistEditor(uid: string, id: string, pathwayId?: string) {
  const [api] = useState(() => apiFor(uid));
  const [resource] = useState(() => {
    let initial = true;
    return new ChecklistResource<ChecklistDraft>(async (signal) => {
      const templateOnly = initial && pathwayId !== undefined;
      initial = false;
      if (!templateOnly) {
        try {
          const record = await api.get(id, signal);
          return { id, record, template: parseTemplate(record) };
        } catch (error) {
          if (!(pathwayId && error instanceof ChecklistError && error.status === 404)) throw error;
        }
      }
      if (!pathwayId) throw new ChecklistError(404);
      return { id, record: null, template: await api.template(pathwayId, signal) };
    });
  });
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => resource.start(), [resource]);
  return { api, resource, state };
}
export function useChecklistList(uid: string, status?: ChecklistStatus, after?: string) {
  const [resource] = useState(() => new ChecklistResource((signal) => apiFor(uid).list({ status, after }, signal)));
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => resource.start(), [resource]);
  return { resource, state };
}
