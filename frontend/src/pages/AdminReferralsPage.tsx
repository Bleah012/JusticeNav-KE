import { useState } from "react";
import { Info, Search } from "lucide-react";
import { AdminOperationsTable } from "../components/AdminOperationsTable";
import type { AdminColumn } from "../components/AdminOperationsTable";
import { AdminRecordDialog } from "../components/AdminRecordDialog";
import { Button } from "../components/ui/Button";
import type { AdminData } from "../types/adminData";
import { validAdminReferrals } from "../types/adminOperationsData";
import type { AdminReferralSummary } from "../types/adminOperationsData";
import { referralDate, referralStatusLabels } from "../types/referralData";
import "./AdminOperations.css";

// Display authorized demonstration metadata without exposing intake descriptions.
export function AdminReferralsPage({
  data = { status: "unavailable" },
}: {
  data?: AdminData<readonly AdminReferralSummary[]>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [service, setService] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const records =
    data.status === "ready" && validAdminReferrals(data.value)
      ? data.value
      : null;
  const services = records
    ? [...new Set(records.map((item) => item.serviceName))].sort((a, b) =>
        a.localeCompare(b),
      )
    : [];
  const needle = query.trim().toLocaleLowerCase();
  const filtered = records
    ? records
        .filter(
          (item) =>
            (!needle ||
              `${item.id} ${item.serviceName}`
                .toLocaleLowerCase()
                .includes(needle)) &&
            (status === "all" || item.status === status) &&
            (service === "all" || item.serviceName === service),
        )
        .sort((a, b) =>
          sort === "newest"
            ? Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
            : Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
        )
    : null;
  const selected = records?.find((item) => item.id === selectedId) ?? null;
  const columns: AdminColumn<AdminReferralSummary>[] = [
    { key: "id", label: "Referral ID", render: (item) => item.id },
    {
      key: "user",
      label: "User",
      render: (item) => item.seekerReference || "Not available",
    },
    { key: "service", label: "Service", render: (item) => item.serviceName },
    {
      key: "status",
      label: "Status",
      render: (item) => (
        <span className="seeker-page__badge">
          {referralStatusLabels[item.status]}
        </span>
      ),
    },
    {
      key: "updated",
      label: "Updated",
      render: (item) => (
        <time dateTime={item.updatedAt}>{referralDate(item.updatedAt)}</time>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (item) => (
        <div className="admin-pages__row-actions">
          <Button variant="ghost" onClick={() => setSelectedId(item.id)}>
            View
          </Button>
          <Button
            variant="ghost"
            disabled
            title="Referral changes are currently unavailable."
          >
            Update status
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Referral management</h1>
          <p>Monitor referrals and service-provider responses.</p>
        </div>
        <Button disabled title="Referral export is currently unavailable.">
          Export referrals
        </Button>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          School-project demonstration only. Statuses describe project records
          and do not confirm institutional receipt or review. Referral changes
          and exports are currently unavailable.
        </p>
      </div>
      <form
        className="admin-pages__toolbar"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="admin-pages__search" htmlFor="admin-referrals-search">
          <Search size={18} aria-hidden="true" />
          <span className="admin-pages__sr-only">Search referrals</span>
          <input
            id="admin-referrals-search"
            type="search"
            maxLength={200}
            autoComplete="off"
            placeholder="Search referrals…"
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
        <label>
          <span>Service</span>
          <select
            value={service}
            onChange={(event) => setService(event.target.value)}
          >
            <option value="all">All services</option>
            {services.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Updated</span>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </form>
      <AdminOperationsTable
        key={JSON.stringify([query, status, service, sort])}
        title="Referral management"
        subject="Referral information"
        records={filtered}
        status={data.status}
        retry={data.status === "error" ? data.retry : undefined}
        columns={columns}
        rowKey={(item) => item.id}
        emptyTitle={
          records?.length
            ? "No referrals match these filters."
            : "No referrals to display."
        }
      />
      {selected && (
        <AdminRecordDialog
          title="Referral details"
          onClose={() => setSelectedId(null)}
        >
          <p className="admin-operations__note">
            Demonstration metadata only. No private problem description or
            contact details are shown.
          </p>
          <dl className="seeker-page__details">
            <div>
              <dt>Referral ID</dt>
              <dd>{selected.id}</dd>
            </div>
            <div>
              <dt>User reference</dt>
              <dd>{selected.seekerReference || "Not available"}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{selected.serviceName}</dd>
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
              <dd>
                <time dateTime={selected.savedAt}>
                  {referralDate(selected.savedAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>
                <time dateTime={selected.updatedAt}>
                  {referralDate(selected.updatedAt)}
                </time>
              </dd>
            </div>
          </dl>
          <Button disabled title="Referral changes are currently unavailable.">
            Update status
          </Button>
        </AdminRecordDialog>
      )}
    </>
  );
}
