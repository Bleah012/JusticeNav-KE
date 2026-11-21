import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../auth/useAuth";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { AdminResource } from "../admin/AdminResource";
import type { AdminState } from "../admin/AdminResource";
import {
  createAdminDashboardApi,
  demoTotal,
} from "../dashboard/workspaceDashboardApi";
import type { AdminDashboard } from "../dashboard/workspaceDashboardApi";
import { CatalogueOverview } from "../components/ConnectedAdminCatalog";
import { AdminDataState } from "../components/AdminDataState";
import { DashboardChart } from "../dashboard/DashboardChart";
import { dashboardPalette } from "../dashboard/dashboardChartData";
import { referralTime } from "../referrals/referralApi";

export function AdminDashboardView({
  state,
  refresh,
}: {
  state: AdminState<AdminDashboard>;
  refresh: () => void;
}) {
  const value = state.status === "ready" ? state.value : null;
  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Platform overview</h1>
          <p>
            Published catalogue, Firebase account and school demonstration
            totals.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={state.status === "loading"}
          onClick={refresh}
        >
          Refresh dashboard
        </button>
      </header>
      {value ? (
        <>
          <p>
            Last refreshed (Kenya): {referralTime(value.refreshedAt)}. Refresh
            after account, catalogue or referral changes. These are separate
            reads, not a single database snapshot.
          </p>
          <section
            className="seeker-dashboard__stats"
            aria-label="Platform account summary"
          >
            {[
              ["Total accounts", value.accounts.total],
              ["Active accounts", value.accounts.active],
              ["Providers", value.accounts.provider],
              ["Administrators", value.accounts.admin],
            ].map(([label, count]) => (
              <article key={label}>
                <div>
                  <h2>{label}</h2>
                  <strong>{count.toLocaleString("en-KE")}</strong>
                </div>
              </article>
            ))}
          </section>
          <CatalogueOverview value={value.catalog} />
          <div className="dashboard-metrics">
            <section className="dashboard-metrics__card">
              <h2>Account roles</h2>
              <p>
                All Firebase Authentication accounts, including disabled
                accounts. Disabled: {value.accounts.disabled}.
              </p>
              <DashboardChart
                kind="bar"
                points={[
                  {
                    label: "Seekers",
                    value: value.accounts.seeker,
                    color: dashboardPalette.green,
                  },
                  {
                    label: "Providers",
                    value: value.accounts.provider,
                    color: dashboardPalette.blue,
                  },
                  {
                    label: "Admins",
                    value: value.accounts.admin,
                    color: dashboardPalette.amber,
                  },
                  {
                    label: "Unsupported",
                    value: value.accounts.unsupported,
                    color: dashboardPalette.unfilled,
                  },
                ]}
                emptyLabel="No accounts are recorded."
              />
            </section>
            <section className="dashboard-metrics__card">
              <h2>Demonstration referrals</h2>
              {value.demonstrations ? (
                <>
                  <p>
                    {demoTotal(value.demonstrations)} shared demonstration
                    histories across all pages. These are school-project
                    statuses, not institutional delivery.
                  </p>
                  <DashboardChart
                    kind="bar"
                    points={[
                      {
                        label: "Waiting",
                        value: value.demonstrations.shared,
                        color: dashboardPalette.blue,
                      },
                      {
                        label: "Assigned",
                        value: value.demonstrations.assigned,
                        color: dashboardPalette.blue,
                      },
                      {
                        label: "Review",
                        value: value.demonstrations.underReview,
                        color: dashboardPalette.amber,
                      },
                      {
                        label: "Completed",
                        value: value.demonstrations.completed,
                        color: dashboardPalette.green,
                      },
                      {
                        label: "Withdrawn",
                        value: value.demonstrations.withdrawn,
                        color: dashboardPalette.unfilled,
                      },
                    ]}
                    emptyLabel="No demonstration sharing is recorded."
                  />
                </>
              ) : (
                <p>Demonstration totals are unavailable in this environment.</p>
              )}
            </section>
          </div>
        </>
      ) : (
        <AdminDataState
          subject="Dashboard totals"
          status={state.status === "ready" ? "error" : state.status}
          retry={refresh}
        />
      )}
    </>
  );
}
function Connected({ uid }: { uid: string }) {
  const [resource] = useState(
    () =>
      new AdminResource(
        createAdminDashboardApi({
          baseUrl: backendUrl,
          uid,
          currentUser: () => firebaseAuth().currentUser,
        }),
      ),
  );
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return (
    <AdminDashboardView state={state} refresh={() => void resource.reload()} />
  );
}
export function AdminOverviewPage() {
  const { session } = useAuth();
  return session.status === "ready" && session.identity.role === "admin" ? (
    <Connected key={session.identity.uid} uid={session.identity.uid} />
  ) : (
    <p role="alert">Administrator access is required.</p>
  );
}
