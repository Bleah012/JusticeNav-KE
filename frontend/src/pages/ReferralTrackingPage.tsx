import { Check, Info, Route } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "../components/ui/Button";
import {
  referralDate,
  referralStatusLabels,
  isSavedDemonstrationReferral,
  selectReferral,
} from "../types/referralData";
import type { ReferralData } from "../types/referralData";
import "./SeekerPages.css";

// Render only recorded history; do not manufacture pending stages or provider receipt.
export function ReferralTrackingPage({
  data = { status: "unavailable" },
}: {
  data?: ReferralData;
}) {
  const { referralId } = useParams();
  const referral = selectReferral(data, referralId);
  const records =
    data.status === "ready"
      ? data.referrals.filter(
          (item, index, all) =>
            isSavedDemonstrationReferral(item) &&
            all.findIndex((candidate) => candidate.id === item.id) === index &&
            all.filter((candidate) => candidate.id === item.id).length === 1,
        )
      : [];
  const listReady = !referralId && data.status === "ready";
  const history =
    referral?.history.filter(
      (event, index, all) =>
        event.id.trim() &&
        event.title.trim() &&
        referralDate(event.occurredAt) &&
        all.findIndex((candidate) => candidate.id === event.id) === index,
    ) ?? [];

  return (
    <>
      {referralId && (
        <Link className="referral-tracking__back" to="/app/referrals">
          Back to my referrals
        </Link>
      )}
      <header className="seeker-page__heading">
        <span className="seeker-page__eyebrow">
          {referral ? `Referral ${referral.id}` : "Referrals"}
        </span>
        <h1>{referralId ? "My referral" : "My Referrals"}</h1>
        <p>Track updates and see what may be needed next.</p>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          School-project demonstration only. Statuses describe records within
          this project. They do not confirm that an institution received or
          reviewed a request.
        </p>
      </div>
      {referral ? (
        <div className="referral-tracking__grid">
          <section
            className="seeker-page__panel"
            aria-labelledby="referral-progress-title"
          >
            <h2 id="referral-progress-title">Referral progress</h2>
            <span className="seeker-page__badge">
              {referralStatusLabels[referral.status]} (demonstration)
            </span>
            {history.length ? (
              <ol className="referral-tracking__timeline">
                {history.map((event) => (
                  <li key={event.id}>
                    <Check size={18} aria-hidden="true" />
                    <strong>{event.title}</strong>
                    <time dateTime={event.occurredAt}>
                      {referralDate(event.occurredAt)}
                    </time>
                    {event.note && <p>{event.note}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No referral history is available.</p>
            )}
          </section>
          <aside
            className="seeker-page__panel"
            aria-labelledby="referral-details-title"
          >
            <h2 id="referral-details-title">Referral details</h2>
            <dl className="seeker-page__details">
              <div>
                <dt>Service</dt>
                <dd>{referral.serviceName}</dd>
              </div>
              <div>
                <dt>Pathway</dt>
                <dd>{referral.pathwayTitle}</dd>
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
                <dt>Last updated</dt>
                <dd>
                  <time dateTime={referral.updatedAt}>
                    {referralDate(referral.updatedAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Next action</dt>
                <dd>{referral.nextAction || "No next action is recorded."}</dd>
              </div>
            </dl>
            <Link className="btn btn-secondary btn-full" to="/services">
              Explore justice services
            </Link>
          </aside>
        </div>
      ) : listReady ? (
        records.length ? (
          <ul className="referral-tracking__list">
            {records.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.id}</strong>
                  <p>{item.serviceName}</p>
                  <span className="seeker-page__badge">
                    {referralStatusLabels[item.status]} (demonstration)
                  </span>
                </div>
                <Link
                  className="btn btn-secondary"
                  to={`/app/referrals/${encodeURIComponent(item.id)}`}
                >
                  View details
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <section className="seeker-page__state">
            <Route size={30} aria-hidden="true" />
            <h2>
              {data.referrals.length
                ? "Referral information is currently unavailable."
                : "No saved referrals to display."}
            </h2>
            <p>
              {data.referrals.length
                ? "The supplied records could not be displayed."
                : "No demonstration-referral records were returned for this account."}
            </p>
          </section>
        )
      ) : (
        <section
          className="seeker-page__state"
          role={data.status === "error" ? "alert" : "status"}
        >
          <Route size={30} aria-hidden="true" />
          <h2>
            {data.status === "loading"
              ? "Loading referral information"
              : data.status === "not-found"
                ? "Referral not found"
                : "Referral information is currently unavailable."}
          </h2>
          <p>
            {data.status === "loading"
              ? "Please wait while your records are loaded."
              : data.status === "error"
                ? "Referral information could not be loaded."
                : data.status === "not-found"
                  ? "The requested referral could not be found."
                  : "No saved referral is loaded. Account services and referral tracking are not connected."}
          </p>
          {data.status === "error" && data.retry && (
            <Button variant="secondary" onClick={data.retry}>
              Try again
            </Button>
          )}
        </section>
      )}
    </>
  );
}
