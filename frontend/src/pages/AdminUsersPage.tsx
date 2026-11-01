import { useState } from "react";
import { Info, Search, Users } from "lucide-react";
import { AdminOperationsTable } from "../components/AdminOperationsTable";
import type { AdminColumn } from "../components/AdminOperationsTable";
import { AdminRecordDialog } from "../components/AdminRecordDialog";
import { Button } from "../components/ui/Button";
import type { AdminData } from "../types/adminData";
import {
  userRoleLabels,
  userStatusLabels,
  validAdminUsers,
} from "../types/workspaceData";
import type { AdminUserSummary } from "../types/workspaceData";
import { referralDate } from "../types/referralData";
import "./WorkspacePages.css";

// Show limited account metadata without granting access to private assessments.
export function AdminUsersPage({
  data = { status: "unavailable" },
}: {
  data?: AdminData<readonly AdminUserSummary[]>;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const records =
    data.status === "ready" && validAdminUsers(data.value) ? data.value : null;
  const needle = query.trim().toLocaleLowerCase();
  const filtered = records
    ? records
        .filter(
          (item) =>
            (!needle || item.id.toLocaleLowerCase().includes(needle)) &&
            (role === "all" || item.role === role) &&
            (status === "all" || item.status === status),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    : null;
  const selected = records?.find((item) => item.id === selectedId) ?? null;
  const columns: AdminColumn<AdminUserSummary>[] = [
    { key: "id", label: "User reference", render: (item) => item.id },
    { key: "role", label: "Role", render: (item) => userRoleLabels[item.role] },
    {
      key: "status",
      label: "Status",
      render: (item) => (
        <span className="seeker-page__badge">
          {userStatusLabels[item.status]}
        </span>
      ),
    },
    {
      key: "created",
      label: "Created",
      render: (item) => (
        <time dateTime={item.createdAt}>{referralDate(item.createdAt)}</time>
      ),
    },
    {
      key: "signed-in",
      label: "Last sign-in",
      render: (item) =>
        item.lastSignInAt ? (
          <time dateTime={item.lastSignInAt}>
            {referralDate(item.lastSignInAt)}
          </time>
        ) : (
          "Not available"
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
            title="Account changes are currently unavailable."
          >
            Change role
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
          <h1>User management</h1>
          <p>Review account roles and status.</p>
        </div>
        <Button disabled title="User export is currently unavailable.">
          Export users
        </Button>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          Account changes and exports are currently unavailable. This view
          contains account metadata only; it does not provide access to private
          assessment descriptions or contact details.
        </p>
      </div>
      <section className="seeker-dashboard__stats" aria-label="Account summary">
        {[
          { label: "Users", value: records?.length },
          ...Object.entries(userStatusLabels).map(([value, label]) => ({
            label,
            value: records?.filter((item) => item.status === value).length,
          })),
        ].map((item) => (
          <article key={item.label}>
            <Users size={22} aria-hidden="true" />
            <div>
              <h2>{item.label}</h2>
              <strong>{item.value ?? "Unavailable"}</strong>
            </div>
          </article>
        ))}
      </section>
      <form
        className="admin-pages__toolbar"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="admin-pages__search" htmlFor="admin-users-search">
          <Search size={18} aria-hidden="true" />
          <span className="admin-pages__sr-only">Search user references</span>
          <input
            id="admin-users-search"
            type="search"
            autoComplete="off"
            maxLength={200}
            placeholder="Search user references…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>Role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="all">All roles</option>
            {Object.entries(userRoleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(userStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </form>
      <AdminOperationsTable
        key={JSON.stringify([query, role, status])}
        title="User management"
        subject="Account information"
        records={filtered}
        status={data.status}
        retry={data.status === "error" ? data.retry : undefined}
        columns={columns}
        rowKey={(item) => item.id}
        emptyTitle={
          records?.length
            ? "No users match these filters."
            : "No users to display."
        }
      />
      {selected && (
        <AdminRecordDialog
          title="Account details"
          onClose={() => setSelectedId(null)}
        >
          <dl className="seeker-page__details">
            <div>
              <dt>User reference</dt>
              <dd>{selected.id}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{userRoleLabels[selected.role]}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{userStatusLabels[selected.status]}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                <time dateTime={selected.createdAt}>
                  {referralDate(selected.createdAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>
                {selected.lastSignInAt
                  ? referralDate(selected.lastSignInAt)
                  : "Not available"}
              </dd>
            </div>
          </dl>
          <div className="workspace-pages__actions">
            <Button variant="secondary" disabled>
              Change role
            </Button>
            <Button variant="danger" disabled>
              Disable account
            </Button>
          </div>
        </AdminRecordDialog>
      )}
    </>
  );
}
