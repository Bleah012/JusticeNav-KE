import { ClipboardCheck, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { validId } from "../assessments/assessmentApi";
import { checklistStatuses, validStatus } from "../checklists/checklistApi";
import type { ChecklistStatus } from "../checklists/checklistApi";
import { useChecklistList } from "../checklists/useChecklists";
import { ChecklistFeedback } from "../components/ChecklistFeedback";
import { Button } from "../components/ui/Button";
import type { ChecklistSummary } from "../checklists/checklistApi";
import { referralDate as formatDate } from "../types/referralData";
import "./SeekerPages.css";
import "./AccountPages.css";
import "./SeekerTools.css";
import "./MyChecklistsPage.css";

function ChecklistList({
  uid,
  status,
  after,
}: {
  uid: string;
  status?: ChecklistStatus;
  after?: string;
}) {
  const editor = useChecklistList(uid, status, after);
  return <ChecklistListView {...editor} status={status} after={after} />;
}

export function ChecklistListView({
  state,
  resource,
  api,
  status,
  after,
}: ReturnType<typeof useChecklistList> & {
  status?: ChecklistStatus;
  after?: string;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const busy = state.status === "ready" && (state.saving || state.needsReload);
  async function remove(record: ChecklistSummary) {
    if (state.status !== "ready" || busy) return;
    if (
      !window.confirm(
        `Delete the saved checklist for "${record.pathwayTitle}" (${record.id.slice(0, 8)})? This permanently removes its saved preparation progress. Your assessments and referrals are kept.`,
      )
    )
      return;
    setDeletingId(record.id);
    try {
      await resource.mutate(async (previous, signal) => {
        await api.remove(record.id, record.revision, signal);
        return previous;
      }, "delete");
    } finally {
      setDeletingId(null);
    }
  }
  function page(cursor?: string) {
    const next = new URLSearchParams(params);
    if (cursor) next.set("after", cursor);
    else next.delete("after");
    setParams(next);
  }
  return (
    <>
      <div className="account-pages__toolbar">
        <Button
          variant="secondary"
          disabled={
            state.status === "loading" ||
            (state.status === "ready" && state.saving)
          }
          onClick={() => void resource.reload()}
        >
          Reload checklists
        </Button>
      </div>
      {state.status !== "ready" ? (
        <ChecklistFeedback
          state={state}
          reload={() => void resource.reload()}
        />
      ) : (
        <>
          {state.notice && <p role="status">{state.notice}</p>}
          {state.error && (
            <p className="assessment-entry__error" role="alert">
              {state.error}
            </p>
          )}
          {state.needsReload && (
            <p>
              Reload checklists to check the saved list before another deletion.
            </p>
          )}
          <p role="status">
            {state.value.checklists.length}{" "}
            {state.value.checklists.length === 1 ? "checklist" : "checklists"}{" "}
            on this page
          </p>
          {state.value.checklists.length ? (
            <ul
              className="account-pages__assessments"
              aria-label="Saved checklists"
            >
              {state.value.checklists.map((record) => (
                <li key={record.id}>
                  <ClipboardCheck size={24} aria-hidden="true" />
                  <div>
                    <h2>{record.pathwayTitle} preparation</h2>
                    <span className="seeker-page__badge">
                      {checklistStatuses[record.status]}
                    </span>
                    <div className="seeker-tools__checklist-progress">
                      <p>
                        {record.completedItems} of {record.totalItems} items
                        complete
                      </p>
                      {record.totalItems > 0 && (
                        <progress
                          value={record.completedItems}
                          max={record.totalItems}
                          aria-label={`${record.completedItems} of ${record.totalItems} preparation items saved complete`}
                        />
                      )}
                    </div>
                    <p>
                      Last updated{" "}
                      <time dateTime={record.updatedAt}>
                        {formatDate(new Date(record.updatedAt).toISOString())}
                      </time>
                    </p>
                  </div>
                  <div className="my-checklists__actions">
                    <Link
                      className="btn btn-secondary"
                      to={`/app/checklists/${record.id}`}
                    >
                      View checklist
                    </Link>
                    <Button
                      variant="danger"
                      disabled={busy}
                      aria-label={`Delete checklist ${record.pathwayTitle} ${record.id.slice(0, 8)}`}
                      onClick={() => void remove(record)}
                    >
                      {deletingId === record.id && state.saving
                        ? "Deleting..."
                        : "Delete checklist"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <section className="seeker-page__state">
              <ClipboardCheck size={30} aria-hidden="true" />
              <h2>
                {status
                  ? "No checklists match this status."
                  : "No saved checklists to display."}
              </h2>
              <p>
                {status
                  ? "Choose another status to see your checklists."
                  : "Create a checklist from a pathway and save your preparation progress."}
              </p>
            </section>
          )}
          {state.value.nextCursor && (
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => page(state.value.nextCursor ?? undefined)}
            >
              Next page
            </button>
          )}
        </>
      )}
      {after && (
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => page()}
        >
          First page
        </button>
      )}
    </>
  );
}
export function MyChecklistsPage() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status"),
    rawAfter = params.get("after");
  const status = validStatus(rawStatus) ? rawStatus : undefined;
  const after = validId(rawAfter) ? rawAfter : undefined;
  return (
    <>
      <header className="seeker-page__heading account-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Preparation</span>
          <h1>My Checklists</h1>
          <p>Review your saved preparation checklists and progress.</p>
        </div>
        <Link className="btn btn-primary" to="/app/checklists/new">
          <Plus size={18} aria-hidden="true" />
          Create checklist
        </Link>
      </header>
      <div className="account-pages__toolbar">
        <label htmlFor="checklist-status-filter">Status</label>
        <select
          id="checklist-status-filter"
          value={status ?? "all"}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.delete("after");
            if (event.target.value === "all") next.delete("status");
            else next.set("status", event.target.value);
            setParams(next, { replace: true });
          }}
        >
          <option value="all">All checklists</option>
          {Object.entries(checklistStatuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {session.status === "ready" ? (
        <ChecklistList
          key={`${session.identity.uid}:${status ?? "all"}:${after ?? "first"}`}
          uid={session.identity.uid}
          status={status}
          after={after}
        />
      ) : (
        <p role="status">Verify your session to load saved checklists.</p>
      )}
    </>
  );
}
