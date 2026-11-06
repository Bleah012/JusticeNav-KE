import { Link, useParams, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { validId } from "../assessments/assessmentApi";
import { useReferralList, useReferralRecord } from "../referrals/useReferrals";
import { referralTime } from "../referrals/referralApi";
import { DemoReferralProgress } from "../components/DemoReferralWorkflow";
import { ReferralDetails } from "../components/ReferralDetails";
import { ReferralFeedback } from "../components/ReferralFeedback";
import "./SeekerPages.css";
function Detail({
  uid,
  id,
  seeker,
}: {
  uid: string;
  id: string;
  seeker: boolean;
}) {
  const { state, resource } = useReferralRecord(uid, id);
  return state.status === "ready" ? (
    <div className="referral-tracking__grid">
      <section className="seeker-page__panel">
        <h2>Referral progress</h2>
        <ol className="referral-tracking__timeline">
          <li>
            <strong>Request saved in JusticeNav KE</strong>
            <time dateTime={state.value.savedAt}>
              {referralTime(state.value.savedAt)}
            </time>
            <p>The original request is saved privately in your account.</p>
          </li>
        </ol>
      </section>
      <section className="seeker-page__panel">
        <h2>Referral details</h2>
        <ReferralDetails record={state.value} privateDetails />
      </section>
      {seeker && <DemoReferralProgress uid={uid} referralId={id} />}
    </div>
  ) : (
    <ReferralFeedback state={state} reload={() => void resource.reload()} />
  );
}
function List({ uid, after }: { uid: string; after?: string }) {
  const { state, resource } = useReferralList(uid, after);
  return (
    <>
      {state.status === "ready" ? (
        <>
          {state.value.referrals.length ? (
            <ul className="referral-tracking__list">
              {state.value.referrals.map((record) => (
                <li key={record.id}>
                  <div>
                    <strong>{record.serviceName}</strong>
                    <p>{record.pathwayTitle}</p>
                    <p>Saved in JusticeNav KE · Not sent to an institution</p>
                    <time dateTime={record.savedAt}>
                      {referralTime(record.savedAt)}
                    </time>
                  </div>
                  <Link
                    className="btn btn-secondary"
                    to={`/app/referrals/${record.id}`}
                  >
                    View details
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <section className="seeker-page__state">
              <h2>No saved referrals to display</h2>
              <p>
                {after
                  ? "No further records were returned."
                  : "Requests you save in this account will appear here."}
              </p>
            </section>
          )}
          <nav aria-label="Referral result pages">
            {after && (
              <Link className="btn btn-secondary" to="/app/referrals">
                First page
              </Link>
            )}
            {state.value.nextCursor && (
              <Link
                className="btn btn-secondary"
                to={`/app/referrals?after=${state.value.nextCursor}`}
              >
                Next page
              </Link>
            )}
          </nav>
        </>
      ) : (
        <ReferralFeedback state={state} reload={() => void resource.reload()} />
      )}
    </>
  );
}
export function ReferralTrackingPage() {
  const { session } = useAuth(),
    { referralId } = useParams();
  const [params] = useSearchParams();
  const after = params.get("after");
  const invalid =
    (referralId !== undefined && !validId(referralId)) ||
    (after !== null && !validId(after));
  return (
    <>
      {referralId && (
        <Link className="referral-tracking__back" to="/app/referrals">
          Back to my referrals
        </Link>
      )}
      <header className="seeker-page__heading">
        <span className="seeker-page__eyebrow">Referrals</span>
        <h1>{referralId ? "My referral" : "My Referrals"}</h1>
        <p>Track saved requests and see what is recorded.</p>
      </header>
      <div className="seeker-page__notice">
        <p>
          Track saved school-project requests and review your demonstration
          progress in each referral.
        </p>
      </div>
      {invalid ? (
        <section>
          <h2>Referral not found</h2>
          <Link to="/app/referrals">My Referrals</Link>
        </section>
      ) : session.status !== "ready" ? (
        <p role="status">Verify your session to view referral records.</p>
      ) : referralId ? (
        <Detail
          key={`${session.identity.uid}:${referralId}`}
          uid={session.identity.uid}
          id={referralId}
          seeker={session.identity.role === "seeker"}
        />
      ) : (
        <List
          key={`${session.identity.uid}:${after ?? "first"}`}
          uid={session.identity.uid}
          after={after ?? undefined}
        />
      )}
      <Link className="btn btn-primary" to="/app/referrals/new">
        New referral request
      </Link>
    </>
  );
}
