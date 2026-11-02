import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  Info,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "../components/ui/Button";
import {
  isSavedDemonstrationReferral,
  referralDate,
  referralStatusLabels,
} from "../types/referralData";
import type { DemonstrationReferral } from "../types/referralData";
import "./SeekerPages.css";

export type SeekerDashboardSnapshot = {
  displayName: string | null;
  activeAssessments: number;
  openReferrals: number;
  checklist: { completed: number; total: number } | null;
  savedResources: number;
  activity: readonly {
    id: string;
    title: string;
    note: string | null;
    occurredAt: string;
  }[];
  referral: DemonstrationReferral | null;
};

type DashboardData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "ready"; snapshot: SeekerDashboardSnapshot };

// Reject invalid totals rather than showing invented or misleading progress.
function validSnapshot(snapshot: SeekerDashboardSnapshot): boolean {
  const counts = [
    snapshot.activeAssessments,
    snapshot.openReferrals,
    snapshot.savedResources,
  ];
  const checklist = snapshot.checklist;
  return (
    counts.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    (checklist === null ||
      (Number.isSafeInteger(checklist.completed) &&
        Number.isSafeInteger(checklist.total) &&
        checklist.completed >= 0 &&
        checklist.total >= checklist.completed))
  );
}

// Populate account details only from an authenticated, owner-scoped backend response.
export function SeekerDashboardPage({
  data = { status: "unavailable" },
}: {
  data?: DashboardData;
}) {
  const snapshot =
    data.status === "ready" && validSnapshot(data.snapshot)
      ? data.snapshot
      : null;
  const referral =
    snapshot?.referral && isSavedDemonstrationReferral(snapshot.referral)
      ? snapshot.referral
      : null;
  const activity =
    snapshot?.activity.filter(
      (event, index, all) =>
        event.id.trim() &&
        event.title.trim() &&
        referralDate(event.occurredAt) &&
        all.findIndex((candidate) => candidate.id === event.id) === index,
    ) ?? [];
  const checklist = snapshot?.checklist;
  const checklistProgress =
    checklist && checklist.total > 0
      ? `${Math.round((checklist.completed / checklist.total) * 100)}%`
      : null;
  const stats = [
    {
      label: "Active assessment",
      value: snapshot?.activeAssessments,
      icon: FileText,
    },
    { label: "Open referrals", value: snapshot?.openReferrals, icon: Mail },
    {
      label: "Checklist progress",
      value: checklistProgress,
      icon: ClipboardCheck,
    },
    {
      label: "Saved resources",
      value: snapshot?.savedResources,
      icon: ShieldCheck,
    },
  ];
  return (
    <>
      <header className="seeker-page__heading">
        <span className="seeker-page__eyebrow">Dashboard</span>
        <h1>
          {snapshot?.displayName?.trim()
            ? `Welcome, ${snapshot.displayName.trim()}`
            : "Your justice journey"}
        </h1>
        <p>Here’s what’s happening with your justice journey.</p>
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
        role={data.status === "error" ? "alert" : "status"}
      >
        <Info size={20} aria-hidden="true" />
        <div>
          <p>
            {snapshot
              ? "School-project demonstration only. Referral records do not confirm institutional delivery. AI processing and saving through the current forms remain unavailable."
              : data.status === "loading"
                ? "Loading your dashboard information."
                : data.status === "error"
                  ? "Your dashboard could not be loaded."
                  : "Your saved descriptions and answers can be reviewed in My Assessments. Referral records and journey statistics are currently unavailable. Your personal information can be managed on the Profile page. AI processing is not connected."}
          </p>
          {data.status === "error" && data.retry && (
            <Button variant="secondary" onClick={data.retry}>
              Try again
            </Button>
          )}
        </div>
      </div>
      <section className="seeker-dashboard__stats" aria-label="Journey summary">
        {stats.map(({ label, value, icon: Icon }) => (
          <article key={label}>
            <Icon size={22} aria-hidden="true" />
            <div>
              <h2>{label}</h2>
              <strong>{value ?? "Unavailable"}</strong>
              {label === "Checklist progress" &&
                checklistProgress &&
                checklist && (
                  <small>
                    {checklist.completed} of {checklist.total} complete
                  </small>
                )}
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
          <p>Your latest updates and next actions</p>
          {snapshot ? (
            activity.length ? (
              <ul className="seeker-dashboard__activity">
                {activity.map((event) => (
                  <li key={event.id}>
                    <strong>{event.title}</strong>
                    {event.note && <p>{event.note}</p>}
                    <time dateTime={event.occurredAt}>
                      {referralDate(event.occurredAt)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {snapshot.activity.length
                  ? "Activity information could not be displayed."
                  : "No recent activity to display."}
              </p>
            )
          ) : (
            <p>Activity information is currently unavailable.</p>
          )}
        </section>
        <section
          className="seeker-page__panel"
          aria-labelledby="dashboard-referral-title"
        >
          <h2 id="dashboard-referral-title">My referral</h2>
          {referral ? (
            <>
              <span className="seeker-page__badge">
                {referralStatusLabels[referral.status]} (demonstration)
              </span>
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
                  <dt>Last updated</dt>
                  <dd>
                    <time dateTime={referral.updatedAt}>
                      {referralDate(referral.updatedAt)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Next action</dt>
                  <dd>
                    {referral.nextAction || "No next action is recorded."}
                  </dd>
                </div>
              </dl>
              <Link
                className="btn btn-secondary btn-full"
                to={`/app/referrals/${encodeURIComponent(referral.id)}`}
              >
                Track referral
              </Link>
            </>
          ) : (
            <>
              <p>
                {snapshot && snapshot.referral === null
                  ? "No referral is selected for this dashboard."
                  : "Referral information is currently unavailable."}
              </p>
              <Link className="btn btn-secondary btn-full" to="/app/referrals">
                My Referrals
              </Link>
            </>
          )}
        </section>
      </div>
    </>
  );
}
