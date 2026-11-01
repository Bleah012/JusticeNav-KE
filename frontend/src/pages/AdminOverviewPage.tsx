import { Mail, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Link } from "react-router";
import { AdminDataState } from "../components/AdminDataState";
import { Button } from "../components/ui/Button";
import {
  formatAdminDate,
  formatAdminMonth,
  validAdminCatalog,
  verificationLabels,
} from "../types/adminData";
import type { AdminData, AdminOverviewSnapshot } from "../types/adminData";

const statusLabels = {
  saved: "Saved",
  "under-review": "Under review",
  "action-required": "Action required",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Require real aggregate values and reviewed metadata before displaying analytics.
function validSnapshot(value: AdminOverviewSnapshot): boolean {
  const counts = [
    value.totalUsers,
    value.activeAssessments,
    value.activeReferrals,
    value.verifiedServices,
  ];
  return (
    counts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
    new Set(value.referralVolume.map((item) => item.month)).size ===
      value.referralVolume.length &&
    value.referralVolume.every(
      (item) =>
        formatAdminMonth(item.month) &&
        Number.isSafeInteger(item.count) &&
        item.count >= 0,
    ) &&
    new Set(value.referralStatuses.map((item) => item.status)).size ===
      value.referralStatuses.length &&
    value.referralStatuses.every(
      (item) =>
        Object.hasOwn(statusLabels, item.status) &&
        Number.isSafeInteger(item.count) &&
        item.count >= 0,
    ) &&
    validAdminCatalog(value.reviewServices, "service") &&
    value.reviewServices.every((item) => item.verification !== "verified")
  );
}

// Render administrative aggregates without sample users, counts or trend percentages.
export function AdminOverviewPage({
  data = { status: "unavailable" },
}: {
  data?: AdminData<AdminOverviewSnapshot>;
}) {
  const snapshot =
    data.status === "ready" && validSnapshot(data.value) ? data.value : null;
  const metrics = [
    { label: "Total users", value: snapshot?.totalUsers, icon: Users },
    {
      label: "Active assessments",
      value: snapshot?.activeAssessments,
      icon: Sparkles,
    },
    { label: "Active referrals", value: snapshot?.activeReferrals, icon: Mail },
    {
      label: "Verified services",
      value: snapshot?.verifiedServices,
      icon: ShieldCheck,
    },
  ];
  const volume = snapshot
    ? [...snapshot.referralVolume].sort((a, b) =>
        a.month.localeCompare(b.month),
      )
    : [];
  const maxVolume = Math.max(1, ...volume.map((item) => item.count));

  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Platform overview</h1>
          <p>
            Monitor service quality, referral activity and information
            verification.
          </p>
        </div>
        <Button disabled title="Report generation is currently unavailable.">
          Generate report
        </Button>
      </header>
      {!snapshot && (
        <AdminDataState
          subject="Platform information"
          status={data.status === "ready" ? "error" : data.status}
          retry={data.status === "error" ? data.retry : undefined}
        />
      )}
      <section
        className="seeker-dashboard__stats"
        aria-label="Platform summary"
      >
        {metrics.map(({ label, value, icon: Icon }) => (
          <article key={label}>
            <Icon size={22} aria-hidden="true" />
            <div>
              <h2>{label}</h2>
              <strong>{value ?? "Unavailable"}</strong>
            </div>
          </article>
        ))}
      </section>
      <div className="admin-pages__charts">
        <section
          className="seeker-page__panel"
          aria-labelledby="referral-volume-title"
        >
          <h2 id="referral-volume-title">Referral volume</h2>
          <p>School-project demonstration referrals</p>
          {snapshot ? (
            volume.length ? (
              <ul
                className="admin-pages__volume"
                aria-label="Referral totals by month"
              >
                {volume.map((item) => (
                  <li key={item.month}>
                    <strong>{item.count}</strong>
                    <span
                      className="admin-pages__bar"
                      style={{ height: `${(item.count / maxVolume) * 140}px` }}
                      aria-hidden="true"
                    />
                    <span>{formatAdminMonth(item.month)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No referral volume records were returned.</p>
            )
          ) : (
            <p>Referral volume information is currently unavailable.</p>
          )}
        </section>
        <section
          className="seeker-page__panel"
          aria-labelledby="referral-status-title"
        >
          <h2 id="referral-status-title">Referral status</h2>
          <p>Statuses within the school-project demonstration.</p>
          {snapshot ? (
            snapshot.referralStatuses.length ? (
              <dl className="seeker-page__details">
                {snapshot.referralStatuses.map((item) => (
                  <div key={item.status}>
                    <dt>{statusLabels[item.status]}</dt>
                    <dd>{item.count}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>No referral status records were returned.</p>
            )
          ) : (
            <p>Referral status information is currently unavailable.</p>
          )}
        </section>
      </div>
      <section
        className="seeker-page__panel admin-pages__review"
        aria-labelledby="review-information-title"
      >
        <div className="admin-pages__panel-head">
          <div>
            <h2 id="review-information-title">Information requiring review</h2>
            <p>Sources needing a verification review.</p>
          </div>
          <Link to="/admin/verification">View all</Link>
        </div>
        {snapshot ? (
          snapshot.reviewServices.length ? (
            <ul className="admin-pages__review-list">
              {snapshot.reviewServices.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span className="seeker-page__badge">
                    {verificationLabels[item.verification]}
                  </span>
                  <span>
                    {formatAdminDate(item.verifiedOn) || "Not verified"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No services requiring review were returned.</p>
          )
        ) : (
          <p>Verification review information is currently unavailable.</p>
        )}
      </section>
    </>
  );
}
