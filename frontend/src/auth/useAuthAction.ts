import { useEffect, useRef, useState } from "react";
import { authError } from "./firebaseClient";
// Prevent duplicate mutations; ignore UI updates after leaving the form.
export function useAuthAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run(task: () => Promise<string>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await task();
      if (mounted.current) setMessage(result);
    } catch (cause) {
      if (mounted.current) setError(authError(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, setError, message, run };
}
