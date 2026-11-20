import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { createAdminUsersApi, validateAccount } from "../admin/adminUsersApi";
import type { Account, AccountInput } from "../admin/adminUsersApi";
import { AdminUsersResource } from "../admin/AdminUsersResource";
import { useAdminCatalog } from "../admin/useAdminCatalog";
import { AdminOperationsTable } from "../components/AdminOperationsTable";
import type { AdminColumn } from "../components/AdminOperationsTable";
import { AdminRecordDialog } from "../components/AdminRecordDialog";
import { referralTime } from "../referrals/referralApi";
import "./AdminUsersPage.css";

const roles = {
  seeker: "Seeker",
  provider: "Service provider",
  admin: "Administrator",
  unsupported: "Unsupported role",
};
const blank = (): AccountInput => ({
  name: "",
  email: "",
  password: "",
  role: "provider",
  serviceId: null,
  confirmed: false,
});
function AccountDetails({ account }: { account: Account }) {
  return (
    <dl className="seeker-page__details">
      <div>
        <dt>Name</dt>
        <dd>{account.name ?? "Not set"}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>{account.email ?? "Not set"}</dd>
      </div>
      <div>
        <dt>Role</dt>
        <dd>{roles[account.role]}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{account.disabled ? "Disabled" : "Active"}</dd>
      </div>
      {account.role === "provider" && (
        <div>
          <dt>Provider service</dt>
          <dd>{account.serviceId ?? "Not configured"}</dd>
        </div>
      )}
      <div>
        <dt>User reference</dt>
        <dd>{account.id}</dd>
      </div>
      <div>
        <dt>Created</dt>
        <dd>{referralTime(account.createdAt)}</dd>
      </div>
      <div>
        <dt>Last sign-in</dt>
        <dd>
          {account.lastSignInAt
            ? referralTime(account.lastSignInAt)
            : "Not yet recorded"}
        </dd>
      </div>
    </dl>
  );
}
function Users({ uid, after }: { uid: string; after?: string }) {
  const [api] = useState(() =>
    createAdminUsersApi({
      baseUrl: backendUrl,
      uid,
      currentUser: () => firebaseAuth().currentUser,
    }),
  );
  const [resource] = useState(() => new AdminUsersResource(api, after));
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => resource.start(), [resource]);
  const services = useAdminCatalog(uid, "services");
  const choices =
    services.state.status === "ready" &&
    services.state.value.kind === "services"
      ? services.state.value.services
      : null;
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(blank),
    [validation, setValidation] = useState("");
  const [query, setQuery] = useState(""),
    [role, setRole] = useState("all"),
    [selected, setSelected] = useState<Account | null>(null);
  const busy = state.busy || state.needsReload || state.status !== "ready";
  const needle = query.trim().toLocaleLowerCase();
  const rows =
    state.page?.users.filter(
      (row) =>
        (!needle ||
          [row.name, row.email, row.id].some((value) =>
            value?.toLocaleLowerCase().includes(needle),
          )) &&
        (role === "all" || row.role === role),
    ) ?? null;
  const columns: AdminColumn<Account>[] = [
    {
      key: "name",
      label: "Account",
      render: (row) => (
        <>
          <strong>{row.name ?? "Name not set"}</strong>
          <p>{row.email ?? "Email not set"}</p>
        </>
      ),
    },
    { key: "role", label: "Role", render: (row) => roles[row.role] },
    {
      key: "service",
      label: "Provider service",
      render: (row) =>
        row.role === "provider"
          ? (choices?.find((item) => item.id === row.serviceId)?.name ??
            row.serviceId ??
            "Not configured")
          : "Not applicable",
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (row.disabled ? "Disabled" : "Active"),
    },
    {
      key: "view",
      label: "Details",
      render: (row) => (
        <button className="btn btn-secondary" onClick={() => setSelected(row)}>
          View account
        </button>
      ),
    },
  ];
  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>User management</h1>
          <p>Create school-project provider and administrator accounts.</p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={state.busy || state.status === "loading"}
          onClick={() => {
            setSelected(null);
            void resource.reload();
          }}
        >
          Reload accounts
        </button>
      </header>
      <div className="seeker-page__notice">
        <p>
          Public registration creates seeker accounts. Administrators can create
          separate provider and admin accounts here. This page shows sign-in
          account metadata; private assessments and referral contact details are
          not included.
        </p>
      </div>
      {state.message && (
        <p role={state.needsReload ? "alert" : "status"}>{state.message}</p>
      )}
      {state.created && (
        <section
          className="seeker-page__panel"
          aria-label="Last account result"
        >
          <h2>Last account result</h2>
          <AccountDetails account={state.created} />
        </section>
      )}
      {state.status !== "forbidden" && (
        <section className="seeker-page__panel admin-users__create">
          <h2>Create an account</h2>
          {!open ? (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                setDraft(blank());
                setValidation("");
                setOpen(true);
              }}
            >
              New account
            </button>
          ) : (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const payload = {
                  ...draft,
                  name: draft.name.trim(),
                  email: draft.email.trim(),
                };
                const error = validateAccount(payload);
                setValidation(error);
                if (error) return;
                if (
                  payload.role === "provider" &&
                  !choices?.some((item) => item.id === payload.serviceId)
                ) {
                  setValidation("Choose a currently published service.");
                  return;
                }
                setDraft((current) => ({
                  ...current,
                  password: "",
                  confirmed: false,
                }));
                const confirmed = await resource.create(
                  crypto.randomUUID().replaceAll("-", ""),
                  payload,
                );
                if (confirmed) {
                  setDraft(blank());
                  setOpen(false);
                }
              }}
            >
              <fieldset disabled={busy} className="admin-users__fields">
                <legend>New account details</legend>
                <label>
                  Full name
                  <input
                    required
                    maxLength={120}
                    value={draft.name}
                    autoComplete="off"
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    maxLength={254}
                    value={draft.email}
                    autoComplete="off"
                    onChange={(event) =>
                      setDraft({ ...draft, email: event.target.value })
                    }
                  />
                </label>
                <label>
                  Role
                  <select
                    value={draft.role}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        role: event.target.value as AccountInput["role"],
                        serviceId: null,
                        confirmed: false,
                      })
                    }
                  >
                    <option value="provider">Service provider</option>
                    <option value="admin">Administrator</option>
                  </select>
                </label>
                {draft.role === "provider" && (
                  <label>
                    Provider service
                    <select
                      required
                      value={draft.serviceId ?? ""}
                      disabled={!choices}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          serviceId: event.target.value || null,
                          confirmed: false,
                        })
                      }
                    >
                      <option value="">Choose a published service</option>
                      {choices?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Initial password
                  <input
                    required
                    type="password"
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    value={draft.password}
                    onChange={(event) =>
                      setDraft({ ...draft, password: event.target.value })
                    }
                  />
                </label>
                <p>
                  Use 12–128 characters and follow your Firebase project
                  password policy. The password is cleared after submission and
                  is not displayed again. No welcome email is sent; the new user
                  signs in separately with these details.
                </p>
                <label className="admin-users__confirmation">
                  <input
                    type="checkbox"
                    checked={draft.confirmed}
                    onChange={(event) =>
                      setDraft({ ...draft, confirmed: event.target.checked })
                    }
                  />
                  <span>
                    {draft.role === "admin"
                      ? "I confirm this new administrator should manage accounts, catalogue content and demonstration assignments."
                      : "I confirm this provider should review demonstrations assigned to the selected service."}
                  </span>
                </label>
              </fieldset>
              {draft.role === "provider" && (!choices || !choices.length) && (
                <p role="status">
                  {services.state.status === "loading"
                    ? "Loading published services…"
                    : choices
                      ? "No published services are available."
                      : "Published services could not be loaded."}{" "}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={state.busy}
                    onClick={services.refresh}
                  >
                    Reload services
                  </button>
                </p>
              )}
              {validation && <p role="alert">{validation}</p>}
              <div className="admin-users__actions">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={
                    busy || (draft.role === "provider" && !choices?.length)
                  }
                >
                  {state.busy ? "Creating…" : "Create account"}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={state.busy}
                  onClick={() => {
                    setDraft(blank());
                    setOpen(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      <section
        className="admin-users__filters"
        aria-label="Filter accounts on this page"
      >
        <label>
          Search this page
          <input
            type="search"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email or user reference"
          />
        </label>
        <label>
          Filter role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="all">All roles</option>
            {Object.entries(roles).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <p>
        {state.page
          ? `${state.page.users.length} accounts loaded on this page. Filters apply to this page only.`
          : state.status === "loading"
            ? "Loading account information…"
            : "Account information is unavailable."}
      </p>
      <AdminOperationsTable
        key={`${query}:${role}`}
        title="Accounts"
        subject="Account information"
        records={rows}
        status={state.status === "forbidden" ? "error" : state.status}
        retry={() => void resource.reload()}
        columns={columns}
        rowKey={(row) => row.id}
        emptyTitle={
          state.page?.users.length
            ? "No accounts match these filters."
            : "No accounts to display."
        }
        paginate={false}
      />
      <nav className="admin-users__actions" aria-label="Account pages">
        {after && (
          <Link className="btn btn-secondary" to="/admin/users">
            First page
          </Link>
        )}
        {state.page?.nextCursor && !state.busy && (
          <Link
            className="btn btn-secondary"
            to={`/admin/users?${new URLSearchParams({ after: state.page.nextCursor })}`}
          >
            Next page
          </Link>
        )}
      </nav>
      {selected && state.status === "ready" && !state.needsReload && (
        <AdminRecordDialog
          title="Account details"
          onClose={() => setSelected(null)}
        >
          <AccountDetails account={selected} />
        </AdminRecordDialog>
      )}
    </>
  );
}
export function AdminUsersPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const after = params.get("after") ?? undefined;
  if (session.status !== "ready" || session.identity.role !== "admin")
    return <p role="alert">Administrator access is required.</p>;
  return (
    <Users
      key={`${session.identity.uid}:${after ?? "first"}`}
      uid={session.identity.uid}
      after={after}
    />
  );
}
