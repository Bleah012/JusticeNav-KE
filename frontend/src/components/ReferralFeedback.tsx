import { Button } from "./ui/Button";
import type { ReferralState } from "../referrals/ReferralResource";
export function ReferralFeedback<T>({
  state,
  reload,
}: {
  state: ReferralState<T>;
  reload: () => void;
}) {
  if (state.status === "loading")
    return <p role="status">Loading referral information...</p>;
  if (state.status === "error")
    return (
      <section role="alert">
        <h2>Referral information could not be opened</h2>
        <p>{state.message}</p>
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      </section>
    );
  return (
    <>
      {state.error && (
        <section role="alert">
          <p>{state.error}</p>
          {state.needsReload && (
            <Button variant="secondary" onClick={reload}>
              Reload saved request
            </Button>
          )}
        </section>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
    </>
  );
}
