import { useEffect, useState, useSyncExternalStore } from "react";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { AssessmentError, createAssessmentApi, createAssessmentRequest } from "./assessmentApi";
import type { Assessment, AssessmentStatus } from "./assessmentApi";
import { AssessmentResource } from "./AssessmentResource";
function apiFor(uid: string) {
  return createAssessmentApi(uid, createAssessmentRequest({ baseUrl: backendUrl, currentUser: () => firebaseAuth().currentUser }));
}
// Callers key their account child by UID and route/filter so drafts cannot cross accounts.
export function useAssessmentRecord(uid: string, id: string, isNew: boolean) {
  const [api] = useState(() => apiFor(uid));
  const [resource] = useState(() => {
    let first = isNew;
    return new AssessmentResource<Assessment | null>(async (signal) => {
      if (first) {
        first = false;
        return null;
      }
      try {
        return await api.get(id, signal);
      }
      catch (error) {
        if (isNew && error instanceof AssessmentError && error.status === 404)
          return null;
        throw error;
      }
    });
  });
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => resource.start(), [resource]);
  return { state, resource, api };
}
export function useAssessmentList(uid: string, status?: AssessmentStatus, after?: string) {
  const [resource] = useState(() => new AssessmentResource((signal) => apiFor(uid).list({ status, after }, signal)));
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => resource.start(), [resource]);
  return { state, resource };
}
