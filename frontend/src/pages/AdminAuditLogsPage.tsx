import { useState } from "react";
import { Info, Search } from "lucide-react";
import { AdminOperationsTable } from "../components/AdminOperationsTable";
import type { AdminColumn } from "../components/AdminOperationsTable";
import { AdminRecordDialog } from "../components/AdminRecordDialog";
import { Button } from "../components/ui/Button";
import { formatAdminDate } from "../types/adminData";
import type { AdminData } from "../types/adminData";
import {
  auditActions,
  auditOutcomeLabels,
  kenyaDateKey,
  validAdminAuditEvents,
} from "../types/adminOperationsData";
import type { AdminAuditEvent } from "../types/adminOperationsData";
import { referralDate } from "../types/referralData";
import "./AdminOperations.css";

// List recorded server metadata without inventing, appending or changing audit history.
export function AdminAuditLogsPage({
  data = { status: "unavailable" },
}: {
  data?: AdminData<readonly AdminAuditEvent[]>;
}) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const records =
    data.status === "ready" && validAdminAuditEvents(data.value)
      ? data.value
      : null;
  const invalidRange = Boolean(
    (from && !formatAdminDate(from)) ||
    (to && !formatAdminDate(to)) ||
    (from && to && from > to),
  );
  const needle = query.trim().toLocaleLowerCase();
  const filtered = records
    ? records
        .filter((item) => {
          const day = kenyaDateKey(item.occurredAt);
          return (
            (!needle ||
              `${item.id} ${item.targetReference ?? ""}`
                .toLocaleLowerCase()
                .includes(needle)) &&
            (action === "all" || item.action === action) &&
            (outcome === "all" || item.outcome === outcome) &&
            (!from || Boolean(day && day >= from)) &&
            (!to || Boolean(day && day <= to))
          );
        })
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    : null;
  const selected = records?.find((item) => item.id === selectedId) ?? null;
  const columns: AdminColumn<AdminAuditEvent>[] = [
    {
      key: "time",
      label: "Time (Kenya)",
      render: (item) => (
        <time dateTime={item.occurredAt}>{referralDate(item.occurredAt)}</time>
      ),
    },
    {
      key: "actor",
      label: "Actor",
      render: (item) => item.actorReference || "Not available",
    },
    {
      key: "action",
      label: "Action",
      render: (item) => auditActions[item.action].label,
    },
    {
      key: "target",
      label: "Target",
      render: (item) => (
        <>
          {item.targetKind}
          <small>{item.targetReference || "Not available"}</small>
        </>
      ),
    },
    {
      key: "outcome",
      label: "Result",
      render: (item) => (
        <span className="seeker-page__badge">
          {auditOutcomeLabels[item.outcome]}
        </span>
      ),
    },
    {
      key: "details",
      label: "Details",
      render: (item) => (
        <Button variant="ghost" onClick={() => setSelectedId(item.id)}>
          View event
        </Button>
      ),
    },
  ];

  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Audit logs</h1>
          <p>Review recorded administrative actions and their outcomes.</p>
        </div>
        <Button disabled title="Audit export is currently unavailable.">
          Export logs
        </Button>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          This is a read-only audit view. Export is currently unavailable.
          Opening or filtering this page does not create or modify audit events.
          Private assessment descriptions and contact details are not shown.
        </p>
      </div>
      <form
        className="admin-pages__toolbar"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="admin-pages__search" htmlFor="admin-audit-search">
          <Search size={18} aria-hidden="true" />
          <span className="admin-pages__sr-only">
            Search event or target references
          </span>
          <input
            id="admin-audit-search"
            type="search"
            maxLength={200}
            autoComplete="off"
            placeholder="Search event or target references…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Action</span>
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="all">All actions</option>
            {Object.entries(auditActions).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Result</span>
          <select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
          >
            <option value="all">All results</option>
            {Object.entries(auditOutcomeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From date (Kenya)</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-invalid={invalidRange || undefined}
            aria-describedby={invalidRange ? "audit-date-error" : undefined}
          />
        </label>
        <label>
          <span>To date (Kenya)</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-invalid={invalidRange || undefined}
            aria-describedby={invalidRange ? "audit-date-error" : undefined}
          />
        </label>
      </form>
      {invalidRange ? (
        <p
          id="audit-date-error"
          className="admin-operations__filter-error"
          role="alert"
        >
          Enter valid dates with the from date on or before the to date.
        </p>
      ) : (
        <AdminOperationsTable
          key={JSON.stringify([query, action, outcome, from, to])}
          title="Audit logs"
          subject="Audit information"
          records={filtered}
          status={data.status}
          retry={data.status === "error" ? data.retry : undefined}
          columns={columns}
          rowKey={(item) => item.id}
          emptyTitle={
            records?.length
              ? "No audit events match these filters."
              : "No audit events to display."
          }
        />
      )}
      {selected && (
        <AdminRecordDialog
          title="Audit event"
          onClose={() => setSelectedId(null)}
        >
          <dl className="seeker-page__details">
            <div>
              <dt>Event ID</dt>
              <dd>{selected.id}</dd>
            </div>
            <div>
              <dt>Time (Kenya)</dt>
              <dd>
                <time dateTime={selected.occurredAt}>
                  {referralDate(selected.occurredAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Actor reference</dt>
              <dd>{selected.actorReference || "Not available"}</dd>
            </div>
            <div>
              <dt>Action</dt>
              <dd>{auditActions[selected.action].label}</dd>
            </div>
            <div>
              <dt>Target type</dt>
              <dd>{selected.targetKind}</dd>
            </div>
            <div>
              <dt>Target reference</dt>
              <dd>{selected.targetReference || "Not available"}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd>{auditOutcomeLabels[selected.outcome]}</dd>
            </div>
          </dl>
          <p className="admin-operations__note">
            Read-only event metadata. Audit events cannot be edited or deleted
            from this page.
          </p>
        </AdminRecordDialog>
      )}
    </>
  );
}
