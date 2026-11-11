import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  Info,
  Mail,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../auth/useAuth";
import { statusLabels } from "../assessments/assessmentApi";
import { referralTime } from "../referrals/referralApi";
import { useDashboard } from "../dashboard/useDashboard";
import { activityLink } from "../dashboard/dashboardApi";
import type { DashboardState } from "../dashboard/DashboardResource";
import { Button } from "../components/ui/Button";
import "./SeekerPages.css";

const activityTitles = {
  assessment: "Assessment saved",
  checklist: "Checklist progress saved",
  referral: "Project referral saved",
};
export function DashboardView({
  state,
  refresh,
}: {
  state: DashboardState;
  refresh: () => void;
}) {
  const snapshot = state.status === "ready" ? state.value : null;
  const checklist = snapshot?.latestChecklist,
    referral = snapshot?.latestReferral;
  const loading = state.status === "loading";
  const missing = loading ? "Loading..." : "Unavailable";
  const stats = [
    {
      label: "Saved assessments",
      value: snapshot?.counts.assessments ?? missing,
      icon: FileText,
      to: "/app/assessments",
    },
    {
      label: "Saved referrals",
      value: snapshot?.counts.referrals ?? missing,
      icon: Mail,
      to: "/app/referrals",
    },
    {
      label: "Checklist progress",
      value: !snapshot
        ? missing
        : !checklist
          ? "No saved checklist"
          : checklist.totalItems === 0
            ? "No items"
            : `${Math.round((checklist.completedItems / checklist.totalItems) * 100)}%`,
      icon: ClipboardCheck,
      to: checklist ? `/app/checklists/${checklist.id}` : "/app/checklists",
    },
    {
      label: "Saved checklists",
      value: snapshot?.counts.checklists ?? missing,
      icon: ClipboardCheck,
      to: "/app/checklists",
    },
  ];
  return (
    <>
      <header className="seeker-page__heading seeker-dashboard__heading">
        <div>
          <span className="seeker-page__eyebrow">Dashboard</span>
          <h1>Your justice journey</h1>
          <p>Here’s what’s happening with your justice journey.</p>
        </div>
        <Button variant="secondary" disabled={loading} onClick={refresh}>
          {loading ? "Loading..." : "Refresh dashboard"}
        </Button>
      </header>
      <section
        className="seeker-dashboard__cta"
        aria-labelledby="dashboard-help-title"
      >
        <div>
          <span className="seeker-page__badge">
            <Sparkles size={16} aria-hidden="true" />
            AI-assisted navigation
          </span>
          <h2 id="dashboard-help-title">What do you need help with?</h2>
          <p>
            Describe what happened in your own words. You don’t need legal
            terms.
          </p>
          <Link className="btn btn-primary" to="/app/assessments/new">
            Describe my problem
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
        <div className="seeker-dashboard__journey">
          <span>Tell us what happened</span>
          <ArrowRight size={18} aria-hidden="true" />
          <span>See your options</span>
          <ArrowRight size={18} aria-hidden="true" />
          <span>Take the next step</span>
        </div>
      </section>
      <div
        className="seeker-page__notice"
        role={state.status === "error" ? "alert" : "status"}
      >
        <Info size={20} aria-hidden="true" />
        <div>
          <p>
            {state.status === "error"
              ? state.message
              : loading
                ? "Loading your saved-record summary."
                : "These totals describe your saved records in JusticeNav KE. Saved referrals are project requests, not institutional submissions or open cases."}
          </p>
          {state.status === "error" && (
            <Button variant="secondary" onClick={refresh}>
              Try again
            </Button>
          )}
        </div>
      </div>
      {snapshot && (
        <p className="seeker-dashboard__refreshed">
          Last refreshed (Kenya):{" "}
          <time dateTime={snapshot.refreshedAt}>
            {referralTime(snapshot.refreshedAt)}
          </time>
          . Refresh after changes to see updated records.
        </p>
      )}
      <section
        className="seeker-dashboard__stats"
        aria-label="Journey summary"
        aria-busy={loading}
      >
        {stats.map(({ label, value, icon: Icon, to }) => (
          <article key={label}>
            <Icon size={22} aria-hidden="true" />
            <div>
              <h2>{label}</h2>
              <strong>{value}</strong>
              {label === "Checklist progress" && checklist && (
                <small>
                  Latest updated checklist: {checklist.pathwayTitle}.{" "}
                  {checklist.completedItems} of {checklist.totalItems} items
                  complete.
                </small>
              )}
              <Link className="seeker-dashboard__stat-link" to={to}>
                {label === "Checklist progress"
                  ? "View checklist"
                  : `View ${label.toLowerCase()}`}
              </Link>
            </div>
          </article>
        ))}
      </section>
      <div className="seeker-dashboard__grid">
        <section
          className="seeker-page__panel"
          aria-labelledby="dashboard-activity-title"
        >
          <h2 id="dashboard-activity-title">Recent activity</h2>
          <p>
            The latest save per record, with the six most recent shown. This is
            not a complete history.
          </p>
          {snapshot ? (
            snapshot.activity.length ? (
              <ul className="seeker-dashboard__activity">
                {snapshot.activity.map((event) => (
                  <li key={`${event.kind}:${event.id}`}>
                    <Link to={activityLink(event)}>
                      <strong>{activityTitles[event.kind]}</strong>
                    </Link>
                    {event.kind === "assessment" && event.assessmentStatus && (
                      <p>{statusLabels[event.assessmentStatus]}</p>
                    )}
                    <time dateTime={event.occurredAt}>
                      {referralTime(event.occurredAt)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No saved activity to display. Start an assessment to begin your
                journey.
              </p>
            )
          ) : (
            <p>
              {loading
                ? "Loading recent saves..."
                : "Activity information is currently unavailable."}
            </p>
          )}
        </section>
        <section
          className="seeker-page__panel"
          aria-labelledby="dashboard-referral-title"
        >
          <h2 id="dashboard-referral-title">My referral</h2>
          {referral ? (
            <>
              <span className="seeker-page__badge">Saved in JusticeNav KE</span>
              <dl className="seeker-page__details">
                <div>
                  <dt>Referral ID</dt>
                  <dd>{referral.id}</dd>
                </div>
                <div>
                  <dt>Service</dt>
                  <dd>{referral.serviceName}</dd>
                </div>
                <div>
                  <dt>Pathway</dt>
                  <dd>{referral.pathwayTitle}</dd>
                </div>
                <div>
                  <dt>Date saved (Kenya)</dt>
                  <dd>
                    <time dateTime={referral.savedAt}>
                      {referralTime(referral.savedAt)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Institutional delivery</dt>
                  <dd>Not sent to an institution</dd>
                </div>
              </dl>
              <p>
                Your most recently saved project request. No institutional
                review or next action is recorded.
              </p>
              <Link
                className="btn btn-secondary btn-full"
                to={`/app/referrals/${referral.id}`}
              >
                Track referral
              </Link>
            </>
          ) : (
            <p>
              {snapshot
                ? "No saved referral requests in this account."
                : loading
                  ? "Loading saved referral..."
                  : "Referral information is currently unavailable."}
            </p>
          )}
          <Link className="btn btn-ghost btn-full" to="/app/referrals">
            My Referrals
          </Link>
        </section>
      </div>
    </>
  );
}
function AccountDashboard({ uid }: { uid: string }) {
  const { state, refresh } = useDashboard(uid);
  return <DashboardView state={state} refresh={refresh} />;
}
export function SeekerDashboardPage() {
  const { session } = useAuth();
  return session.status === "ready" ? (
    <AccountDashboard key={session.identity.uid} uid={session.identity.uid} />
  ) : (
    <p role="status">Verify your session to view the dashboard.</p>
  );
}
