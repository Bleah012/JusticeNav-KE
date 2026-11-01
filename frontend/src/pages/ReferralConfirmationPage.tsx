import { Check, Info } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "../components/ui/Button";
import {
  referralDate,
  referralStatusLabels,
  selectReferral,
} from "../types/referralData";
import type { ReferralData } from "../types/referralData";
import "./SeekerPages.css";

// Show a receipt only for a matching saved backend record, never from a URL flag.
export function ReferralConfirmationPage({
  data = { status: "unavailable" },
}: {
  data?: ReferralData;
}) {
  const { referralId } = useParams();
  const referral = selectReferral(data, referralId);
  return (
    <main id="main-content" className="referral-confirmation">
      {referral ? (
        <>
          <div className="referral-confirmation__mark">
            <Check size={38} aria-hidden="true" />
          </div>
          <span className="seeker-page__badge">
            Demonstration referral saved
          </span>
          <h1>Your demonstration request has been saved</h1>
          <p>
            This confirms a saved school-project record. It does not confirm
            delivery to an institution, acceptance or legal representation.
          </p>
          <dl className="seeker-page__details">
            <div>
              <dt>Referral ID</dt>
              <dd>{referral.id}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{referralStatusLabels[referral.status]} (demonstration)</dd>
            </div>
            <div>
              <dt>Date saved</dt>
              <dd>
                <time dateTime={referral.savedAt}>
                  {referralDate(referral.savedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Next expected action</dt>
              <dd>{referral.nextAction || "No next action is recorded."}</dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <span className="seeker-page__badge">Referral confirmation</span>
          <h1>
            {data.status === "loading"
              ? "Loading referral confirmation"
              : "Referral confirmation is unavailable"}
          </h1>
          <div role={data.status === "error" ? "alert" : "status"}>
            <p>
              {data.status === "not-found"
                ? "The requested referral could not be found."
                : data.status === "error"
                  ? "The referral confirmation could not be loaded."
                  : data.status === "loading"
                    ? "Please wait while the saved record is loaded."
                    : "No saved demonstration-referral record is loaded. Opening this page does not submit or save a request."}
            </p>
            {data.status === "error" && data.retry && (
              <Button variant="secondary" onClick={data.retry}>
                Try again
              </Button>
            )}
          </div>
        </>
      )}
      <div className="seeker-page__actions">
        {referral ? (
          <Link
            className="btn btn-primary"
            to={`/app/referrals/${encodeURIComponent(referral.id)}`}
          >
            Track my referral
          </Link>
        ) : (
          <Button disabled title="A saved referral is required.">
            Track my referral
          </Button>
        )}
        <Link className="btn btn-secondary" to="/app">
          Return to dashboard
        </Link>
      </div>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          School-project demonstration only. Institutional delivery and
          notification services are not connected.
        </p>
      </div>
    </main>
  );
}
