import { ClipboardCheck, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { AccountDataState } from "../components/AccountDataState";
import { Button } from "../components/ui/Button";
import type { AccountData } from "../types/accountData";
import type { SavedChecklistSummary } from "../types/checklistData";
import { referralDate as formatAccountDate } from "../types/referralData";
import "./SeekerPages.css";
import "./AccountPages.css";
import "./SeekerTools.css";

type ChecklistStatus = "in-progress" | "complete" | "empty";

// Infer progress only from validated saved counts, never from a URL or sample value.
function checklistStatus(record: SavedChecklistSummary): ChecklistStatus {
  if (record.totalItems === 0) return "empty";
  return record.completedItems === record.totalItems
    ? "complete"
    : "in-progress";
}

// Reject impossible counts and duplicate identifiers instead of hiding bad summaries.
function validChecklists(records: readonly SavedChecklistSummary[]): boolean {
  return (
    new Set(records.map((record) => record.id)).size === records.length &&
    records.every(
      (record) =>
        record.id.trim() &&
        record.pathwayTitle.trim() &&
        formatAccountDate(record.updatedAt) &&
        Number.isSafeInteger(record.totalItems) &&
        Number.isSafeInteger(record.completedItems) &&
        record.completedItems >= 0 &&
        record.totalItems >= record.completedItems,
    )
  );
}

// Keep saved checklists separate from the unsaved preparation form.
export function MyChecklistsPage({
  data = { status: "unavailable" },
  onOpenChecklist,
}: {
  data?: AccountData<readonly SavedChecklistSummary[]>;
  onOpenChecklist?: (id: string) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = searchParams.get("status");
  const selectedStatus =
    requestedStatus === "in-progress" ||
    requestedStatus === "complete" ||
    requestedStatus === "empty"
      ? requestedStatus
      : "all";
  const records =
    data.status === "ready" && validChecklists(data.value) ? data.value : null;
  const visible =
    records?.filter(
      (record) =>
        selectedStatus === "all" || checklistStatus(record) === selectedStatus,
    ) ?? [];

  // Store only a non-sensitive filter while preserving unrelated query parameters.
  function handleFilterChange(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value === "all") next.delete("status");
    else next.set("status", value);
    setSearchParams(next, { replace: true });
  }

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
          value={selectedStatus}
          onChange={(event) => handleFilterChange(event.target.value)}
        >
          <option value="all">All checklists</option>
          <option value="in-progress">In progress</option>
          <option value="complete">Complete</option>
          <option value="empty">No items</option>
        </select>
        {records && (
          <span role="status">
            {visible.length} {visible.length === 1 ? "checklist" : "checklists"}
          </span>
        )}
      </div>

      {records ? (
        visible.length ? (
          <ul
            className="account-pages__assessments"
            aria-label="Saved checklists"
          >
            {visible.map((record) => (
              <li key={record.id}>
                <ClipboardCheck size={24} aria-hidden="true" />
                <div>
                  <h2>{record.pathwayTitle} preparation</h2>
                  <span className="seeker-page__badge">
                    {checklistStatus(record) === "complete"
                      ? "Complete"
                      : checklistStatus(record) === "empty"
                        ? "No items"
                        : "In progress"}
                  </span>
                  {record.totalItems > 0 ? (
                    <div className="seeker-tools__checklist-progress">
                      <p>
                        {record.completedItems} of {record.totalItems} items
                        complete
                      </p>
                      <progress
                        value={record.completedItems}
                        max={record.totalItems}
                        aria-label={`${record.pathwayTitle}: ${record.completedItems} of ${record.totalItems} items complete`}
                      />
                    </div>
                  ) : (
                    <p>No preparation items are recorded.</p>
                  )}
                  <p>
                    Last updated{" "}
                    <time dateTime={record.updatedAt}>
                      {formatAccountDate(record.updatedAt)}
                    </time>
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={!onOpenChecklist}
                  title={
                    !onOpenChecklist
                      ? "Opening saved checklists is currently unavailable."
                      : undefined
                  }
                  onClick={() => onOpenChecklist?.(record.id)}
                >
                  View checklist
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <section className="seeker-page__state">
            <ClipboardCheck size={30} aria-hidden="true" />
            <h2>
              {records.length
                ? "No checklists match this status."
                : "No saved checklists to display."}
            </h2>
            <p>
              {records.length
                ? "Choose another status to see your checklists."
                : "No saved checklist records were returned for this account."}
            </p>
          </section>
        )
      ) : (
        <AccountDataState
          subject="Checklist information"
          status={data.status === "ready" ? "error" : data.status}
          retry={data.status === "error" ? data.retry : undefined}
        />
      )}
    </>
  );
}
