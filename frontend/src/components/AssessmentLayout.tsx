import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Link } from "react-router";
import "../pages/AssessmentEntryPage.css";

const steps = ["Describe", "Clarify", "Pathways", "Prepare", "Next step"];

type AssessmentLayoutProps = {
  step: 1 | 2 | 3 | 4 | 5;
  children: ReactNode;
};

// Share assessment navigation without treating earlier steps as completed records.
export function AssessmentLayout({ step, children }: AssessmentLayoutProps) {
  return (
    <div className="assessment-entry">
      <header className="assessment-entry__header">
        <div className="assessment-entry__header-inner">
          <Link
            className="assessment-entry__brand"
            to="/"
            aria-label="JusticeNav KE home"
          >
            <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
              <rect
                width="40"
                height="40"
                rx="12"
                fill="none"
                stroke="currentColor"
              />
              <path
                d="M12 28V15.5c0-2.5 2-4.5 4.5-4.5S21 13 21 15.5v9c0 2 1.6 3.5 3.5 3.5S28 26.4 28 24.5V12"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="m24.5 15 3.5-3.5 3.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>JusticeNav KE</span>
          </Link>
          <button
            className="assessment-entry__save"
            type="button"
            disabled
            title="Saving is currently unavailable."
            aria-describedby="assessment-prototype-note"
          >
            Save &amp; exit
          </button>
        </div>
      </header>

      <ol
        className="assessment-entry__progress"
        aria-label="Assessment progress"
      >
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={index + 1 === step ? "step" : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            <small>{label}</small>
          </li>
        ))}
      </ol>

      <main id="main-content" className="assessment-entry__content">
        {children}
      </main>

      <footer className="assessment-entry__disclaimer">
        <Info size={16} aria-hidden="true" />
        <p>
          JusticeNav KE provides information and navigation support, not legal
          advice.
        </p>
      </footer>
    </div>
  );
}
