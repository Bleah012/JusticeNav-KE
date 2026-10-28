import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  ClipboardCheck,
  Info,
  LoaderCircle,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { Button } from "../components/ui/Button";
import "./PreparationChecklistPage.css";

// Requirements must come from reviewed pathway data; these are not saved user records.
export type PreparationRequirements = {
  pathwayId: string;
  pathwayTitle: string;
  items: readonly {
    id: string;
    label: string;
    note: string | null;
  }[];
};

export type PreparationChecklistData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "ready"; requirements: PreparationRequirements };

const unavailableChecklist: PreparationChecklistData = {
  status: "unavailable",
};

// Reject ambiguous requirement identities before associating local checkbox state.
function validRequirements(requirements: PreparationRequirements) {
  return (
    Boolean(
      requirements.pathwayId.trim() && requirements.pathwayTitle.trim(),
    ) &&
    requirements.items.every((item) => item.id.trim() && item.label.trim()) &&
    new Set(requirements.items.map((item) => item.id)).size ===
      requirements.items.length
  );
}

// Keep ticks local and count only the currently supplied preparation items.
function ChecklistEditor({
  requirements,
}: {
  requirements: PreparationRequirements;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const completeCount = requirements.items.filter((item) =>
    checked.has(item.id),
  ).length;
  const totalCount = requirements.items.length;

  // Change a single local tick without saving, submitting or creating a checklist.
  function handleToggle(itemId: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <div className="preparation-checklist__layout">
      <section
        className="preparation-checklist__tool"
        aria-labelledby="preparation-list-title"
      >
        <div className="preparation-checklist__head">
          <div>
            <span className="assessment-entry__badge">
              Preparation checklist
            </span>
            <h2 id="preparation-list-title">
              {requirements.pathwayTitle} preparation
            </h2>
            <p>Based on the selected pathway requirements.</p>
          </div>
          <output
            className="preparation-checklist__count"
            aria-label={`${completeCount} of ${totalCount} items marked complete on this page`}
            aria-live="polite"
          >
            <span>
              {completeCount}/{totalCount}
            </span>
            <small>complete</small>
          </output>
        </div>

        <progress
          className="preparation-checklist__progress"
          value={completeCount}
          max={totalCount}
          aria-label="Preparation items marked complete on this page"
        />

        <fieldset className="preparation-checklist__items">
          <legend className="preparation-checklist__sr-only">
            Preparation items
          </legend>
          {requirements.items.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={checked.has(item.id)}
                onChange={() => handleToggle(item.id)}
              />
              <span>
                <strong>{item.label}</strong>
                <small>
                  {item.note ||
                    (checked.has(item.id)
                      ? "Marked complete on this page"
                      : "Mark complete when ready")}
                </small>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="preparation-checklist__buttons">
          <Button
            variant="secondary"
            disabled
            title="Checklist saving is currently unavailable."
          >
            Save checklist
          </Button>
          <Button
            icon={ArrowRight}
            disabled
            title="Referral submission is currently unavailable."
          >
            Continue to referral
          </Button>
        </div>
      </section>

      <aside className="preparation-checklist__aside">
        <div className="preparation-checklist__why" role="note">
          <Info size={20} aria-hidden="true" />
          <div>
            <h2>Why prepare?</h2>
            <p>
              Having relevant information ready may make it easier for a service
              to understand your request. Only share what is necessary.
            </p>
          </div>
        </div>
        <section
          className="preparation-checklist__related"
          aria-labelledby="preparation-related-title"
        >
          <h2 id="preparation-related-title">Related pathway</h2>
          <p>{requirements.pathwayTitle}</p>
          <Link to={`/pathways/${encodeURIComponent(requirements.pathwayId)}`}>
            View pathway <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
      </aside>
    </div>
  );
}

// Show only the selected pathway's requirements without treating disconnected data as an empty list.
export function PreparationChecklistPage({
  checklist = unavailableChecklist,
}: {
  checklist?: PreparationChecklistData;
}) {
  const [searchParams] = useSearchParams();
  const requestedPathwayId = searchParams.get("pathwayId");
  const requirements =
    checklist.status === "ready" &&
    checklist.requirements.pathwayId === requestedPathwayId &&
    validRequirements(checklist.requirements)
      ? checklist.requirements
      : null;
  const status =
    checklist.status === "ready" && !requirements
      ? "unavailable"
      : checklist.status;

  return (
    <AssessmentLayout step={4}>
      <div className="assessment-entry__title preparation-checklist__title">
        <span className="assessment-entry__badge">Preparation checklist</span>
        <h1>Prepare before you contact the service</h1>
        {requirements && (
          <p>This checklist is based on the pathway you selected.</p>
        )}
      </div>

      <div
        className="assessment-entry__prototype"
        id="assessment-prototype-note"
        role="note"
      >
        <Info size={18} aria-hidden="true" />
        <p>
          Saving and referral submission are currently unavailable. Any ticks on
          this page are local and are not submitted or saved by JusticeNav KE.
          No saved checklist or referral is created.
        </p>
      </div>

      <div aria-busy={status === "loading"}>
        {status === "unavailable" && (
          <div className="preparation-checklist__state" role="status">
            <ClipboardCheck size={30} aria-hidden="true" />
            <h2>Checklist information is currently unavailable.</h2>
            <p>Please check again later.</p>
          </div>
        )}

        {status === "loading" && (
          <div className="preparation-checklist__state" role="status">
            <LoaderCircle
              className="preparation-checklist__spinner"
              size={30}
              aria-hidden="true"
            />
            <h2>Loading preparation requirements.</h2>
          </div>
        )}

        {checklist.status === "error" && (
          <div className="preparation-checklist__state" role="alert">
            <AlertCircle size={30} aria-hidden="true" />
            <h2>Checklist information could not be loaded.</h2>
            <p>No preparation items are being displayed.</p>
            {checklist.retry && (
              <Button variant="secondary" onClick={checklist.retry}>
                Try again
              </Button>
            )}
          </div>
        )}

        {requirements && requirements.items.length === 0 && (
          <div className="preparation-checklist__state" role="status">
            <ClipboardCheck size={30} aria-hidden="true" />
            <h2>No preparation requirements to display.</h2>
            <p>
              This does not mean that preparation is unnecessary. Confirm
              current requirements with the official source.
            </p>
          </div>
        )}

        {requirements && requirements.items.length > 0 && (
          <ChecklistEditor
            key={JSON.stringify(requirements)}
            requirements={requirements}
          />
        )}
      </div>

      <div className="assessment-entry__actions preparation-checklist__navigation">
        <Link className="btn btn-ghost" to="/app/assessments/results">
          Back to pathway results
        </Link>
        <Link className="btn btn-secondary" to="/services">
          Explore justice services
        </Link>
      </div>
    </AssessmentLayout>
  );
}
