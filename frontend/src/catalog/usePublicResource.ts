import { useEffect, useState, useSyncExternalStore } from "react";
import { PublicResource } from "./PublicResource";

// Route wrappers key identifier changes so an old service cannot appear on a new URL.
export function usePublicResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  allowNotFound = false,
) {
  const [resource] = useState(() => new PublicResource(loader, allowNotFound));
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return { state, retry: () => void resource.reload() };
}
