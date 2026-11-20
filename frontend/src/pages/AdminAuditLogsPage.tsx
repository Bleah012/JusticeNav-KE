import { useEffect, useState, useSyncExternalStore } from "react";
import { Info, Search } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { AdminResource } from "../admin/AdminResource";
import type { AdminState } from "../admin/AdminResource";
import {
  auditKinds,
  auditVerbs,
  auditParameters,
  createAuditApi,
  initialAuditFilters,
  formatAuditDate,
} from "../admin/auditApi";
import type {
  AuditEvent,
  AuditFilters,
  AuditPage,
  AuditVerb,
} from "../admin/auditApi";
import { AdminOperationsTable } from "../components/AdminOperationsTable";
import type { AdminColumn } from "../components/AdminOperationsTable";
import { AdminRecordDialog } from "../components/AdminRecordDialog";
import { AdminDataState } from "../components/AdminDataState";
import { Button } from "../components/ui/Button";
import "./AdminOperations.css";
import "./AdminAuditLogsPage.css";

function actionLabel(event: AuditEvent) {
  return `${auditKinds[event.targetKind]} · ${auditVerbs[event.action.split(".")[1] as AuditVerb]}`;
}

export function AuditLogsView({
  state,
  filters,
  page,
  onApply,
  onReload,
  onPrevious,
  onNext,
}: {
  state: AdminState<AuditPage>;
  filters: AuditFilters;
  page: number;
  onApply: (filters: AuditFilters) => void;
  onReload: () => void;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [filterError, setFilterError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const value = state.status === "ready" ? state.value : null;
  const selected = value?.events.find((event) => event.id === selectedId);
  const columns: AdminColumn<AuditEvent>[] = [
    {
      key: "time",
      label: "Time (Kenya)",
      render: (event) => (
        <time dateTime={event.occurredAt}>
          {formatAuditDate(event.occurredAt)}
        </time>
      ),
    },
    {
      key: "actor",
      label: "Actor UID",
      render: (event) => event.actorReference,
    },
    { key: "action", label: "Action", render: actionLabel },
    {
      key: "target",
      label: "Target",
      render: (event) => (
        <>
          {auditKinds[event.targetKind]}
          <small>{event.targetReference}</small>
        </>
      ),
    },
    { key: "revision", label: "Revision", render: (event) => event.revision },
    { key: "result", label: "Result", render: () => "Succeeded" },
    {
      key: "details",
      label: "Details",
      render: (event) => (
        <Button variant="ghost" onClick={() => setSelectedId(event.id)}>
          View event
        </Button>
      ),
    },
  ];
  const field = (name: keyof AuditFilters, value: string) =>
    setDraft((previous) => ({ ...previous, [name]: value }));
  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Audit logs</h1>
          <p>Review saved changes to Services, Pathways and Resources.</p>
        </div>
        <Button
          variant="secondary"
          onClick={onReload}
          disabled={state.status === "loading"}
        >
          Refresh audit logs
        </Button>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          Read-only catalogue history, newest first. These events record
          successful saved changes. Seeded catalogue entries, failed attempts,
          sign-ins and referral activity are outside this history. Opening or
          filtering this page does not create events. Private descriptions,
          contacts and review notes are excluded.
        </p>
      </div>
      <form
        className="audit-logs__filters"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            auditParameters(draft, null);
            setFilterError("");
            onApply({ ...draft, query: draft.query.trim() });
          } catch {
            setFilterError(
              "Check the date range. From must be on or before To.",
            );
          }
        }}
      >
        <label className="admin-pages__search">
          <Search size={18} aria-hidden="true" />
          <span className="admin-pages__sr-only">
            Search event, actor or target references
          </span>
          <input
            type="search"
            maxLength={200}
            autoComplete="off"
            placeholder="Event, actor or target reference…"
            value={draft.query}
            onChange={(event) => field("query", event.target.value)}
          />
        </label>
        <label>
          <span>Record type</span>
          <select
            aria-label="Record type"
            value={draft.kind}
            onChange={(event) => field("kind", event.target.value)}
          >
            <option value="all">All record types</option>
            {Object.entries(auditKinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Action</span>
          <select
            aria-label="Action"
            value={draft.action}
            onChange={(event) => field("action", event.target.value)}
          >
            <option value="all">All actions</option>
            {Object.entries(auditVerbs).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From date (Kenya)</span>
          <input
            type="date"
            value={draft.from}
            onChange={(event) => field("from", event.target.value)}
            aria-invalid={!!filterError || undefined}
            aria-describedby={filterError ? "audit-filter-error" : undefined}
          />
        </label>
        <label>
          <span>To date (Kenya)</span>
          <input
            type="date"
            value={draft.to}
            onChange={(event) => field("to", event.target.value)}
            aria-invalid={!!filterError || undefined}
            aria-describedby={filterError ? "audit-filter-error" : undefined}
          />
        </label>
        <div className="seeker-page__actions">
          <Button type="submit">Apply filters</Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setDraft(initialAuditFilters);
              setFilterError("");
              onApply(initialAuditFilters);
            }}
          >
            Clear filters
          </Button>
        </div>
      </form>
      {filterError && (
        <p
          id="audit-filter-error"
          role="alert"
          className="admin-operations__filter-error"
        >
          {filterError}
        </p>
      )}
      <p className="admin-operations__note">
        Filters apply across recorded history. Up to 25 matching events appear
        per page. A page can be empty while more history remains; use Next to
        continue. Refresh starts with the newest events.
      </p>
      <AdminOperationsTable
        title="Catalogue audit logs"
        subject="Audit information"
        records={value?.events ?? null}
        status={state.status}
        retry={onReload}
        columns={columns}
        rowKey={(event) => event.id}
        emptyTitle={
          value?.nextCursor
            ? "No matching events on this page. More history remains."
            : "No matching audit events."
        }
        paginate={false}
      />
      {value && (
        <div className="admin-pages__pagination">
          <span role="status">
            {value.events.length} event{value.events.length === 1 ? "" : "s"} on
            page {page}
          </span>
          <div>
            <Button
              variant="secondary"
              disabled={page === 1}
              onClick={onPrevious}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={!value.nextCursor}
              onClick={() => value.nextCursor && onNext(value.nextCursor)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      {selected && (
        <AdminRecordDialog
          title="Audit event"
          onClose={() => setSelectedId(null)}
        >
          <dl className="seeker-page__details">
            {[
              ["Event ID", selected.id],
              ["Time (Kenya)", formatAuditDate(selected.occurredAt)],
              ["Actor UID", selected.actorReference],
              ["Action", actionLabel(selected)],
              ["Target reference", selected.targetReference],
              ["Saved revision", selected.revision],
              ["Result", "Succeeded"],
            ].map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p className="admin-operations__note">
            Recorded event metadata remains available after a draft is deleted
            or a published entry is archived. This page cannot edit or delete
            events.
          </p>
        </AdminRecordDialog>
      )}
    </>
  );
}

export function AuditLogsReader({
  loader,
  ...props
}: Omit<Parameters<typeof AuditLogsView>[0], "state"> & {
  loader: (signal: AbortSignal) => Promise<AuditPage>;
}) {
  const [resource] = useState(() => new AdminResource(loader));
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  return <AuditLogsView {...props} state={state} />;
}

export function AuditLogsWorkspace({
  read,
}: {
  read: ReturnType<typeof createAuditApi>;
}) {
  const [filters, setFilters] = useState(initialAuditFilters);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  return (
    <AuditLogsReader
      key={JSON.stringify([filters, cursors[page], refresh])}
      loader={(signal) => read(filters, cursors[page], signal)}
      filters={filters}
      page={page + 1}
      onApply={(value) => {
        setFilters(value);
        setCursors([null]);
        setPage(0);
        setRefresh((value) => value + 1);
      }}
      onReload={() => {
        setCursors([null]);
        setPage(0);
        setRefresh((value) => value + 1);
      }}
      onPrevious={() => setPage((value) => Math.max(0, value - 1))}
      onNext={(cursor) => {
        setCursors((previous) => [...previous.slice(0, page + 1), cursor]);
        setPage((value) => value + 1);
      }}
    />
  );
}

export function AdminAuditLogsPage() {
  const { session } = useAuth();
  if (session.status !== "ready" || session.identity.role !== "admin")
    return <AdminDataState subject="Audit information" status="forbidden" />;
  return (
    <AuditLogsWorkspace
      key={session.identity.uid}
      read={createAuditApi({
        baseUrl: backendUrl,
        uid: session.identity.uid,
        currentUser: () => firebaseAuth().currentUser,
      })}
    />
  );
}
