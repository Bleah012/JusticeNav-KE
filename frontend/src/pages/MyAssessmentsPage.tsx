import { FileText, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { AccountDataState } from "../components/AccountDataState";
import { Button } from "../components/ui/Button";
import { assessmentStatusLabels } from "../types/accountData";
import type { AccountData, SavedAssessment } from "../types/accountData";
import { referralDate as formatAccountDate } from "../types/referralData";
import "./SeekerPages.css";
import "./AccountPages.css";

type MyAssessmentsPageProps = {
  data?: AccountData<readonly SavedAssessment[]>;
  onOpenAssessment?: (id: string) => void;
};

// Accept only complete, uniquely identified saved assessment summaries.
function validAssessments(records: readonly SavedAssessment[]): boolean {
  const identifiers = new Set(records.map((record) => record.id));
  return (
    identifiers.size === records.length &&
    records.every(
      (record) =>
        record.id.trim() &&
        record.title.trim() &&
        formatAccountDate(record.updatedAt) &&
        Object.hasOwn(assessmentStatusLabels, record.status),
    )
  );
}

// Filter supplied account records without putting private descriptions in the URL.
export function MyAssessmentsPage({
  data = { status: "unavailable" },
  onOpenAssessment,
}: MyAssessmentsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = searchParams.get("status");
  const selectedStatus =
    requestedStatus && Object.hasOwn(assessmentStatusLabels, requestedStatus)
      ? requestedStatus
      : "all";
  const ready = data.status === "ready" && validAssessments(data.value);
  const records = ready && data.status === "ready" ? data.value : null;
  const visible =
    records?.filter(
      (record) => selectedStatus === "all" || record.status === selectedStatus,
    ) ?? [];

  // Preserve unrelated URL parameters when changing this non-sensitive status filter.
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
          value={selectedStatus}
          onChange={(event) => handleFilterChange(event.target.value)}
        >
          <option value="all">All assessments</option>
          {Object.entries(assessmentStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {records && (
          <span role="status">
            {visible.length}{" "}
            {visible.length === 1 ? "assessment" : "assessments"}
          </span>
        )}
      </div>

      {records ? (
        visible.length ? (
          <ul
            className="account-pages__assessments"
            aria-label="Saved assessments"
          >
            {visible.map((record) => (
              <li key={record.id}>
                <FileText size={24} aria-hidden="true" />
                <div>
                  <h2>{record.title}</h2>
                  <span className="seeker-page__badge">
                    {assessmentStatusLabels[record.status]}
                  </span>
                  <p>
                    Last updated{" "}
                    <time dateTime={record.updatedAt}>
                      {formatAccountDate(record.updatedAt)}
                    </time>
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={!onOpenAssessment}
                  title={
                    !onOpenAssessment
                      ? "Opening saved assessments is currently unavailable."
                      : undefined
                  }
                  onClick={() => onOpenAssessment?.(record.id)}
                >
                  View assessment
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <section className="seeker-page__state">
            <FileText size={30} aria-hidden="true" />
            <h2>
              {records.length
                ? "No assessments match this status."
                : "No saved assessments to display."}
            </h2>
            <p>
              {records.length
                ? "Choose another status to see your assessments."
                : "No saved assessment records were returned for this account."}
            </p>
          </section>
        )
      ) : (
        <AccountDataState
          subject="Assessment information"
          status={data.status === "ready" ? "error" : data.status}
          retry={data.status === "error" ? data.retry : undefined}
        />
      )}
    </>
  );
}
