import { useState } from "react";
import {
  ClipboardCheck,
  ClipboardList,
  Clock,
  Info,
  Search,
} from "lucide-react";
import { AdminRecordDialog } from "../components/AdminRecordDialog";
import { Button } from "../components/ui/Button";
import { referralDate, referralStatusLabels } from "../types/referralData";
import { validProviderSnapshot } from "../types/workspaceData";
import type { ProviderDashboardData } from "../types/workspaceData";

// Show only consistent assignments for an active membership supplied by the backend.
export function ProviderDashboardPage({
  data = { status: "unavailable" },
}: {
  data?: ProviderDashboardData;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const snapshot =
    data.status === "ready" && validProviderSnapshot(data.value)
      ? data.value
      : null;
  const state =
    data.status === "ready" && !snapshot
      ? data.value.membership?.status !== "active"
        ? "forbidden"
        : "error"
      : data.status;
  const needle = query.trim().toLocaleLowerCase();
  const referrals = snapshot?.assignedReferrals ?? null;
  const visible =
    referrals
      ?.filter(
        (item) =>
          (!needle || item.id.toLocaleLowerCase().includes(needle)) &&
          (status === "all" || item.status === status),
      )
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)) ?? [];
  const selected = referrals?.find((item) => item.id === selectedId) ?? null;
  const metrics = [
    {
      label: "Assigned referrals",
      value: referrals?.length,
      icon: ClipboardList,
    },
    {
      label: "Under review",
      value: referrals?.filter((item) => item.status === "under-review").length,
      icon: Clock,
    },
    {
      label: "Action required",
      value: referrals?.filter((item) => item.status === "action-required")
        .length,
      icon: Info,
    },
    {
      label: "Completed",
      value: referrals?.filter((item) => item.status === "completed").length,
      icon: ClipboardCheck,
    },
  ];

  return (
    <>
      <header className="seeker-page__heading">
        <span className="seeker-page__eyebrow">Provider workspace</span>
        <h1>Provider dashboard</h1>
        <p>Review assigned demonstration referrals and their next actions.</p>
        {snapshot && <p>Service: {snapshot.membership?.serviceName}</p>}
      </header>
      <section
        className="seeker-dashboard__stats"
        aria-label="Assigned referral summary"
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
      <section
        id="provider-assigned-referrals"
        className="workspace-pages__assigned"
        aria-labelledby="provider-assigned-title"
      >
        <h2 id="provider-assigned-title">Assigned referrals</h2>
        <p>
          School-project demonstration records only. These do not confirm
          institutional delivery, acceptance or representation.
        </p>
        <form
          className="admin-pages__toolbar"
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          <label
            className="admin-pages__search"
            htmlFor="provider-referral-search"
          >
            <Search size={18} aria-hidden="true" />
            <span className="admin-pages__sr-only">
              Search assigned referral references
            </span>
            <input
              id="provider-referral-search"
              type="search"
              maxLength={200}
              autoComplete="off"
              placeholder="Search referral references…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              {Object.entries(referralStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </form>
        {referrals ? (
          visible.length ? (
            <ul className="workspace-pages__provider-list">
              {visible.map((item) => (
                <li key={item.id}>
                  <div>
                    <h3>{item.id}</h3>
                    <span className="seeker-page__badge">
                      {referralStatusLabels[item.status]}
                    </span>
                    <p>
                      {item.pathwayTitle ||
                        "Pathway information is unavailable."}
                    </p>
                    <time dateTime={item.updatedAt}>
                      {referralDate(item.updatedAt)}
                    </time>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => setSelectedId(item.id)}
                  >
                    View details
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="seeker-page__state">
              <ClipboardList size={28} aria-hidden="true" />
              <h2>
                {referrals.length
                  ? "No referrals match these filters."
                  : "No assigned referrals to display."}
              </h2>
              <p>
                No matching demonstration records were returned for this
                membership.
              </p>
            </div>
          )
        ) : (
          <div
            className="seeker-page__state"
            role={
              state === "error" || state === "forbidden" ? "alert" : "status"
            }
          >
            <Info size={28} aria-hidden="true" />
            <h2>
              {state === "loading"
                ? "Loading assigned referrals"
                : state === "forbidden"
                  ? "Access unavailable"
                  : state === "error"
                    ? "Provider information could not be loaded."
                    : "Provider information is currently unavailable."}
            </h2>
            <p>
              {state === "forbidden"
                ? "An active service membership and permission to view assigned referrals are required."
                : state === "loading"
                  ? "Please wait while the provider workspace is loaded."
                  : "Provider membership and assigned referral data are not connected."}
            </p>
            {data.status === "error" && data.retry && (
              <Button variant="secondary" onClick={data.retry}>
                Try again
              </Button>
            )}
          </div>
        )}
      </section>
      {selected && (
        <AdminRecordDialog
          title="Assigned referral details"
          onClose={() => setSelectedId(null)}
        >
          <p>
            Demonstration metadata only. Private assessment descriptions and
            contact details are not included in this view.
          </p>
          <dl className="seeker-page__details">
            <div>
              <dt>Referral ID</dt>
              <dd>{selected.id}</dd>
            </div>
            <div>
              <dt>Pathway</dt>
              <dd>{selected.pathwayTitle || "Not available"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{referralStatusLabels[selected.status]} (demonstration)</dd>
            </div>
            <div>
              <dt>Date saved</dt>
              <dd>{referralDate(selected.savedAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{referralDate(selected.updatedAt)}</dd>
            </div>
          </dl>
          <Button
            disabled
            title="Referral processing is currently unavailable."
          >
            Update status
          </Button>
        </AdminRecordDialog>
      )}
    </>
  );
}
