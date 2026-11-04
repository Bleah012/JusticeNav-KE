import { useEffect, useState, useSyncExternalStore } from "react";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { createReferralApi, ReferralError } from "./referralApi";
import type { ReferralDraft } from "./referralApi";
import { ReferralResource } from "./ReferralResource";

function apiFor(uid: string) {
  return createReferralApi({
    baseUrl: backendUrl,
    uid,
    currentUser: () => firebaseAuth().currentUser,
  });
}
export function useReferralEditor(uid: string, id: string, pathwayId: string) {
  const [api] = useState(() => apiFor(uid));
  const [resource] = useState(() => {
    return new ReferralResource<ReferralDraft>(async (signal) => {
      {
        try {
          const record = await api.get(id, signal);
          if (record.selection.pathway.id !== pathwayId)
            throw new ReferralError(409);
          return { id, record, selection: record.selection };
        } catch (error) {
          if (!(error instanceof ReferralError && error.status === 404))
            throw error;
        }
      }
      return {
        id,
        record: null,
        selection: await api.selection(pathwayId, signal),
      };
    });
  });
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return { api, resource, state };
}
export function useReferralRecord(uid: string, id: string) {
  const [resource] = useState(
    () => new ReferralResource((signal) => apiFor(uid).get(id, signal)),
  );
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return { resource, state };
}
export function useReferralList(uid: string, after?: string) {
  const [resource] = useState(
    () => new ReferralResource((signal) => apiFor(uid).list(after, signal)),
  );
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return { resource, state };
}
