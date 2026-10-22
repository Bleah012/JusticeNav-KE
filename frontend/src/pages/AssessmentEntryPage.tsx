import { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  ChevronDown,
  Info,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { Button } from "../components/ui/Button";

const characterLimit = 1500;
const examples = [
  "I bought a phone and the seller refuses to repair or refund it.",
  "Someone owes me KSh 200,000 and refuses to pay.",
];

const messages = {
  required: "Describe what happened before continuing.",
  length: "Keep your description within 1,500 characters.",
  unavailable:
    "Assessment processing is currently unavailable. Your description has not been submitted or saved.",
};

// Validate a description locally without saving it or simulating an assessment.
export function AssessmentEntryPage() {
  const [description, setDescription] = useState("");
  const [showExamples, setShowExamples] = useState(false);
  const [error, setError] = useState<keyof typeof messages | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const invalidDescription = error === "required" || error === "length";

  // Reject blank or oversized input before reporting the disconnected service.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!description.trim()) {
      setError("required");
      descriptionRef.current?.focus();
      return;
    }

    if (description.length > characterLimit) {
      setError("length");
      descriptionRef.current?.focus();
      return;
    }

    setError("unavailable");
  }

  // Insert only the selected reference writing example into the unsaved field.
  function handleExampleClick(example: string) {
    setDescription(example);
    setError(null);
    descriptionRef.current?.focus();
  }

  return (
    <AssessmentLayout step={1}>
      <div className="assessment-entry__title">
        <span className="assessment-entry__badge">
          <Sparkles size={14} aria-hidden="true" />
          AI-assisted navigation
        </span>
        <h1>What happened?</h1>
        <p>
          Describe your situation in your own words. You do not need to use
          legal terms.
        </p>
      </div>

      <div
        className="assessment-entry__prototype"
        role="note"
        id="assessment-prototype-note"
      >
        <Info size={18} aria-hidden="true" />
        <p>
          Assessment processing and saving are currently unavailable. Use
          non-sensitive test inputs only. Your text is not submitted or saved by
          JusticeNav KE. Leaving this step does not save your text.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="assessment-entry__field">
          <label htmlFor="assessment-description">Describe your problem</label>
          <textarea
            ref={descriptionRef}
            id="assessment-description"
            value={description}
            maxLength={characterLimit}
            required
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalidDescription || undefined}
            aria-describedby={[
              "assessment-character-count",
              "assessment-privacy-note",
              "assessment-prototype-note",
              invalidDescription ? "assessment-error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onChange={(event) => {
              setDescription(event.target.value);
              setError(null);
            }}
            placeholder="Describe your situation in your own words."
          />
          <small id="assessment-character-count">
            {description.length.toLocaleString("en-KE")} / 1,500 characters
          </small>
        </div>

        <div
          className="assessment-entry__privacy"
          role="note"
          id="assessment-privacy-note"
        >
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>Protect your privacy</strong>
            <p>
              Avoid sharing passwords, PINs, ID numbers or full financial
              details.
            </p>
          </div>
        </div>

        <button
          className="assessment-entry__example-toggle"
          type="button"
          aria-expanded={showExamples}
          aria-controls="assessment-examples"
          onClick={() => setShowExamples((shown) => !shown)}
        >
          <span>Not sure what to write? See examples</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <div id="assessment-examples" hidden={!showExamples}>
          <ul className="assessment-entry__examples" role="list">
            {examples.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => handleExampleClick(example)}
                >
                  &ldquo;{example}&rdquo;
                </button>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p
            className="assessment-entry__error"
            id="assessment-error"
            role="alert"
          >
            {messages[error]}
          </p>
        )}

        <div className="assessment-entry__actions">
          <Link className="btn btn-ghost" to="/">
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
