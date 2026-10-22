import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Check, Info } from "lucide-react";
import { Link } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { Button } from "../components/ui/Button";
import "./AssessmentClarificationPage.css";

const issueOptions = ["Consumer", "Money / Debt", "Something else"] as const;
const timeframeOptions = [
  "Within the last 3 months",
  "3\u201312 months ago",
  "More than a year ago",
  "Not sure",
] as const;
const contactOptions = ["Yes", "No", "Not sure"] as const;
const questionCount = 3;

const messages = {
  issue: "Choose the type of issue that best describes your situation.",
  timeframe: "Select when the problem occurred, or choose Not sure.",
  contact: "Select whether you contacted the other party, or choose Not sure.",
  unavailable:
    "Clarification submission is currently unavailable. Your answers have not been submitted or saved, and no pathways have been generated.",
};

// Collect local answers to fixed prototype questions without simulating AI or persistence.
export function AssessmentClarificationPage() {
  const [issue, setIssue] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState<keyof typeof messages | null>(null);
  const issueRef = useRef<HTMLInputElement>(null);
  const timeframeRef = useRef<HTMLSelectElement>(null);
  const contactRef = useRef<HTMLSelectElement>(null);
  const answeredCount = [issue, timeframe, contact].filter(Boolean).length;
  const completion = Math.round((answeredCount / questionCount) * 100);

  // Require an answer to each visible question before reporting unavailable submission.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!issue) {
      setError("issue");
      issueRef.current?.focus();
      return;
    }

    if (!timeframe) {
      setError("timeframe");
      timeframeRef.current?.focus();
      return;
    }

    if (!contact) {
      setError("contact");
      contactRef.current?.focus();
      return;
    }

    setError("unavailable");
  }

  return (
    <AssessmentLayout step={2}>
      <div
        className="assessment-clarification__meta"
        id="clarification-progress-label"
      >
        <span>
          {answeredCount} of {questionCount} questions answered on this page
        </span>
        <strong>{completion}% complete</strong>
      </div>
      <progress
        className="assessment-clarification__progress"
        value={answeredCount}
        max={questionCount}
        aria-labelledby="clarification-progress-label"
      />

      <div className="assessment-entry__title assessment-clarification__title">
        <h1>Help us understand your situation</h1>
        <p>Your answers help us show more relevant information.</p>
      </div>

      <div
        className="assessment-entry__prototype"
        role="note"
        id="assessment-prototype-note"
      >
        <Info size={18} aria-hidden="true" />
        <p>
          No saved assessment is loaded. These fixed prototype questions are not
          AI-generated. Submission and processing are currently unavailable. Use
          non-sensitive test inputs only. Answers are not submitted or saved by
          JusticeNav KE.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <fieldset
          className="assessment-clarification__question"
          aria-describedby={
            error === "issue" ? "clarification-error" : undefined
          }
        >
          <legend>What type of issue best describes your situation?</legend>
          <div className="assessment-clarification__options">
            {issueOptions.map((option, index) => (
              <label key={option}>
                <input
                  ref={index === 0 ? issueRef : undefined}
                  type="radio"
                  name="clarification-issue"
                  value={option}
                  checked={issue === option}
                  required
                  aria-invalid={error === "issue" || undefined}
                  aria-describedby={
                    error === "issue" ? "clarification-error" : undefined
                  }
                  onChange={() => {
                    setIssue(option);
                    setError(null);
                  }}
                />
                <span>{option}</span>
                <Check size={18} aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>

        <div className="assessment-clarification__fields">
          <label>
            <span>When did the problem occur?</span>
            <select
              ref={timeframeRef}
              value={timeframe}
              required
              aria-invalid={error === "timeframe" || undefined}
              aria-describedby={
                error === "timeframe" ? "clarification-error" : undefined
              }
              onChange={(event) => {
                setTimeframe(event.target.value);
                setError(null);
              }}
            >
              <option value="" disabled>
                Select a timeframe
              </option>
              {timeframeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Have you contacted the other party?</span>
            <select
              ref={contactRef}
              value={contact}
              required
              aria-invalid={error === "contact" || undefined}
              aria-describedby={
                error === "contact" ? "clarification-error" : undefined
              }
              onChange={(event) => {
                setContact(event.target.value);
                setError(null);
              }}
            >
              <option value="" disabled>
                Select an answer
              </option>
              {contactOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p
            className="assessment-entry__error"
            id="clarification-error"
            role="alert"
          >
            {messages[error]}
          </p>
        )}

        <div className="assessment-entry__actions">
          <Link className="btn btn-ghost" to="/app/assessments/new">
            Back
          </Link>
          <Button type="submit" icon={ArrowRight}>
            Continue
          </Button>
        </div>
      </form>
    </AssessmentLayout>
  );
}
