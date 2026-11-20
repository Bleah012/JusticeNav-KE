import { FileText, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { AssessmentFeedback } from "../components/AssessmentFeedback";
import {
  statusLabels,
  validId,
  validStatus,
} from "../assessments/assessmentApi";
import type {
  AssessmentStatus,
  AssessmentSummary,
} from "../assessments/assessmentApi";
import { useAssessmentList } from "../assessments/useAssessment";
import { referralDate as formatDate } from "../types/referralData";
import { Button } from "../components/ui/Button";
import "./SeekerPages.css";
import "./AccountPages.css";
import "./MyAssessmentsPage.css";
function AssessmentList({
  uid,
  status,
  after,
}: {
  uid: string;
  status?: AssessmentStatus;
  after?: string;
}) {
  const editor = useAssessmentList(uid, status, after);
  return <AssessmentListView {...editor} status={status} after={after} />;
}

export function AssessmentListView({
  state,
  resource,
  api,
  status,
  after,
}: ReturnType<typeof useAssessmentList> & {
  status?: AssessmentStatus;
  after?: string;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const busy = state.status === "ready" && (state.saving || state.needsReload);
  async function remove(record: AssessmentSummary) {
    if (state.status !== "ready" || busy) return;
    if (
      !window.confirm(
        `Delete assessment ${record.id.slice(0, 8)}? This permanently removes its saved description and answers. Saved checklists and referrals are kept.`,
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
    const next = new URLSearchParams(searchParams);
    if (cursor) next.set("after", cursor);
    else next.delete("after");
    setSearchParams(next);
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
          Reload assessments
        </Button>
      </div>
      {state.status === "ready" ? (
        <>
          {state.notice && <p role="status">{state.notice}</p>}
          {state.error && (
            <p className="assessment-entry__error" role="alert">
              {state.error}
            </p>
          )}
          {state.needsReload && (
            <p>
              Reload assessments to check the saved list before another
              deletion.
            </p>
          )}
          <p role="status">
            {state.value.assessments.length}{" "}
            {state.value.assessments.length === 1
              ? "assessment"
              : "assessments"}{" "}
            on this page
          </p>
          {state.value.assessments.length ? (
            <ul
              className="account-pages__assessments"
              aria-label="Saved assessments"
            >
              {state.value.assessments.map((record) => (
                <li key={record.id}>
                  <FileText size={24} aria-hidden="true" />
                  <div>
                    <h2>Assessment {record.id.slice(0, 8)}</h2>
                    <span className="seeker-page__badge">
                      {statusLabels[record.status]}
                    </span>
                    <p>
                      Last updated{" "}
                      <time dateTime={record.updatedAt}>
                        {formatDate(new Date(record.updatedAt).toISOString())}
                      </time>
                    </p>
                  </div>
                  <div className="my-assessments__actions">
                    <Link
                      className="btn btn-secondary"
                      to={`/app/assessments/${record.id}/${record.status === "draft" ? "describe" : record.status === "awaiting-pathways" ? "results" : "clarify"}`}
                    >
                      View assessment
                    </Link>
                    <Button
                      variant="danger"
                      disabled={busy}
                      aria-label={`Delete assessment ${record.id.slice(0, 8)}`}
                      onClick={() => void remove(record)}
                    >
                      {deletingId === record.id && state.saving
                        ? "Deleting..."
                        : "Delete assessment"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <section className="seeker-page__state">
              <FileText size={30} aria-hidden="true" />
              <h2>
                {status
                  ? "No assessments match this status."
                  : "No saved assessments to display."}
              </h2>
              <p>
                {status
                  ? "Choose another status to see your assessments."
                  : "Start a new assessment to save your own description."}
              </p>
            </section>
          )}
          <div className="account-pages__toolbar">
            {after && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => page()}
              >
                First page
              </button>
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
          </div>
        </>
      ) : (
        <>
          <AssessmentFeedback
            state={state}
            reload={() => void resource.reload()}
          />
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
      )}
    </>
  );
}
export function MyAssessmentsPage() {
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get("status"),
    rawAfter = searchParams.get("after");
  const status = validStatus(rawStatus) ? rawStatus : undefined;
  const after = validId(rawAfter) ? rawAfter : undefined;
  return (
    <>
      <header className="seeker-page__heading account-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">My assessments</span>
          <h1>My Assessments</h1>
          <p>Review your saved assessments and next steps.</p>
        </div>
        <Link className="btn btn-primary" to="/app/assessments/new">
          <Plus size={18} aria-hidden="true" />
          New assessment
        </Link>
      </header>
      <div className="account-pages__toolbar">
        <label htmlFor="assessment-status-filter">Status</label>
        <select
          id="assessment-status-filter"
          value={status ?? "all"}
          onChange={(event) => {
            const next = new URLSearchParams(searchParams);
            next.delete("after");
            if (event.target.value === "all") next.delete("status");
            else next.set("status", event.target.value);
            setSearchParams(next, { replace: true });
          }}
        >
          <option value="all">All assessments</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {session.status === "ready" ? (
        <AssessmentList
          key={`${session.identity.uid}:${status ?? "all"}:${after ?? "first"}`}
          uid={session.identity.uid}
          status={status}
          after={after}
        />
      ) : (
        <p role="status">Verify your session to load assessments.</p>
      )}
    </>
  );
}
