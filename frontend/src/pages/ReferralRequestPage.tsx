import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Info, LoaderCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { Button } from "../components/ui/Button";
import "./ReferralRequestPage.css";

// These public selections do not establish institutional participation or a referral recipient.
export type ReferralSelection = {
  pathway: { id: string; title: string };
  service: { id: string; name: string };
};

export type ReferralSelectionData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "ready"; selection: ReferralSelection };

const unavailableSelection: ReferralSelectionData = { status: "unavailable" };
const descriptionLimit = 1500;
const messages = {
  name: "Enter a name for this non-sensitive test request.",
  email: "Enter a valid email address for this non-sensitive test request.",
  contact: "Choose a preferred contact method.",
  phone:
    "Enter a phone number when choosing Phone call, using no more than 32 characters.",
  description: "Enter a brief, non-sensitive test description.",
  descriptionLength: "Keep the description within 1,500 characters.",
  consent: "Read and acknowledge the statement before continuing.",
  selection:
    "Selected pathway and service information is unavailable. No referral has been submitted or saved.",
  unavailable:
    "Referral submission is currently unavailable. No referral has been submitted or saved, and no information has been sent to an institution.",
};

// Keep test inputs local and report unavailable submission without simulating a referral.
function ReferralRequestForm({
  selection,
  status,
  retry,
}: {
  selection: ReferralSelection | null;
  status: ReferralSelectionData["status"];
  retry?: () => void;
}) {
  const [contactMethod, setContactMethod] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<keyof typeof messages | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const contactRef = useRef<HTMLSelectElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const errorFields = {
    name: nameRef,
    email: emailRef,
    phone: phoneRef,
    contact: contactRef,
    description: descriptionRef,
    descriptionLength: descriptionRef,
    consent: consentRef,
  };

  // Identify and focus the first field needing attention.
  function showFieldError(field: keyof typeof errorFields) {
    setError(field);
    errorFields[field].current?.focus();
  }

  // Validate basic inputs and acknowledgement without sending or retaining form entries.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!nameRef.current?.value.trim()) return showFieldError("name");
    if (
      !emailRef.current?.value.trim() ||
      emailRef.current?.validity.typeMismatch
    ) {
      return showFieldError("email");
    }
    if (!["email", "phone"].includes(contactMethod))
      return showFieldError("contact");

    const phone = phoneRef.current?.value.trim() ?? "";
    if ((contactMethod === "phone" && !phone) || phone.length > 32) {
      return showFieldError("phone");
    }
    if (!description.trim()) return showFieldError("description");
    if (description.length > descriptionLimit)
      return showFieldError("descriptionLength");
    if (!consentRef.current?.checked) return showFieldError("consent");

    setError(selection ? "unavailable" : "selection");
  }

  const descriptionInvalid =
    error === "description" || error === "descriptionLength";
  const backToChecklist = selection
    ? `/app/checklists/new?pathwayId=${encodeURIComponent(selection.pathway.id)}`
    : "/app/checklists/new";

  return (
    <form
      className="referral-request__form"
      onSubmit={handleSubmit}
      onChange={() => setError(null)}
      noValidate
      autoComplete="off"
      aria-describedby="assessment-prototype-note"
    >
      <section
        className="referral-request__section"
        aria-labelledby="referral-personal-title"
      >
        <h2 id="referral-personal-title">Your information</h2>
        <div className="referral-request__grid">
          <label className="referral-request__field">
            <span>Full name</span>
            <input
              ref={nameRef}
              type="text"
              name="fullName"
              placeholder="Full name"
              required
              aria-invalid={error === "name" || undefined}
              aria-describedby={
                error === "name" ? "referral-request-error" : undefined
              }
            />
          </label>
          <label className="referral-request__field">
            <span>Email address</span>
            <input
              ref={emailRef}
              type="email"
              name="email"
              placeholder="Email address"
              required
              aria-invalid={error === "email" || undefined}
              aria-describedby={
                error === "email" ? "referral-request-error" : undefined
              }
            />
          </label>
          <label className="referral-request__field">
            <span>
              Phone number{contactMethod === "phone" ? "" : " (optional)"}
            </span>
            <input
              ref={phoneRef}
              type="tel"
              name="phone"
              inputMode="tel"
              maxLength={32}
              required={contactMethod === "phone"}
              aria-invalid={error === "phone" || undefined}
              aria-describedby={
                error === "phone" ? "referral-request-error" : undefined
              }
            />
          </label>
          <label className="referral-request__field">
            <span>Preferred contact method</span>
            <select
              ref={contactRef}
              name="contactMethod"
              value={contactMethod}
              onChange={(event) => setContactMethod(event.target.value)}
              required
              aria-invalid={error === "contact" || undefined}
              aria-describedby={
                error === "contact" ? "referral-request-error" : undefined
              }
            >
              <option value="" disabled>
                Select a contact method
              </option>
              <option value="email">Email</option>
              <option value="phone">Phone call</option>
            </select>
          </label>
        </div>
      </section>

      <section
        className="referral-request__section"
        aria-labelledby="referral-details-title"
      >
        <h2 id="referral-details-title">Request details</h2>
        <div
          className="referral-request__selection-status"
          id="referral-selection-status"
          role="status"
          aria-busy={status === "loading"}
        >
          {status === "loading" && (
            <>
              <LoaderCircle
                className="referral-request__spinner"
                size={18}
                aria-hidden="true"
              />
              <span>Loading selected pathway and service.</span>
            </>
          )}
          {status === "unavailable" && (
            <span>
              Selected pathway and service information is unavailable.
            </span>
          )}
          {status === "error" && (
            <>
              <span>
                Selected pathway and service information could not be loaded.
              </span>
              {retry && (
                <Button variant="secondary" onClick={retry}>
                  Try again
                </Button>
              )}
            </>
          )}
          {selection && (
            <span>
              Listed organisations are not recipients of this demonstration
              form.
            </span>
          )}
        </div>

        <div className="referral-request__grid">
          <label className="referral-request__field">
            <span>Selected pathway</span>
            <output
              className="referral-request__selected"
              aria-describedby="referral-selection-status"
            >
              {selection?.pathway.title ?? "Pathway information unavailable"}
            </output>
          </label>
          <label className="referral-request__field">
            <span>Selected service</span>
            <output
              className="referral-request__selected"
              aria-describedby="referral-selection-status"
            >
              {selection?.service.name ?? "Service information unavailable"}
            </output>
          </label>
        </div>

        <label className="referral-request__field">
          <span>Brief description</span>
          <textarea
            ref={descriptionRef}
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={descriptionLimit}
            required
            spellCheck={false}
            aria-invalid={descriptionInvalid || undefined}
            aria-describedby={[
              "referral-description-count",
              "referral-privacy-note",
              descriptionInvalid ? "referral-request-error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </label>
        <small
          className="referral-request__count"
          id="referral-description-count"
        >
          {description.length.toLocaleString("en-KE")} / 1,500 characters
        </small>
      </section>

      <div
        className="referral-request__privacy"
        id="referral-privacy-note"
        role="note"
      >
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>Only provide information necessary for the referral.</strong>
          <p>
            Remove passwords, PINs, full financial details and unrelated
            personal information.
          </p>
        </div>
      </div>

      <label className="referral-request__consent">
        <input
          ref={consentRef}
          type="checkbox"
          name="acknowledgement"
          required
          aria-invalid={error === "consent" || undefined}
          aria-describedby={
            error === "consent" ? "referral-request-error" : undefined
          }
        />
        <span>
          I understand that submitting this referral does not guarantee
          acceptance or legal representation.
        </span>
      </label>
      <p className="referral-request__privacy-link">
        <Link to="/privacy">Privacy Notice</Link>
      </p>

      {error && (
        <p
          className="assessment-entry__error"
          id="referral-request-error"
          role="alert"
        >
          {messages[error]}
        </p>
      )}

      <div className="assessment-entry__actions referral-request__actions">
        <Link className="btn btn-secondary" to={backToChecklist}>
          Back
        </Link>
        <Button type="submit" icon={ArrowRight}>
          Submit referral
        </Button>
      </div>
    </form>
  );
}

// Render a demonstration request without inferring participants or selections from URL text.
export function ReferralRequestPage({
  context = unavailableSelection,
}: {
  context?: ReferralSelectionData;
}) {
  const [searchParams] = useSearchParams();
  const selection =
    context.status === "ready" &&
    context.selection.pathway.id === searchParams.get("pathwayId") &&
    context.selection.service.id === searchParams.get("serviceId") &&
    context.selection.pathway.id.trim() &&
    context.selection.pathway.title.trim() &&
    context.selection.service.id.trim() &&
    context.selection.service.name.trim()
      ? context.selection
      : null;
  const status =
    context.status === "ready" && !selection ? "unavailable" : context.status;

  return (
    <AssessmentLayout step={5}>
      <div className="assessment-entry__title referral-request__title">
        <span className="assessment-entry__badge">Referral request</span>
        <h1>Request assistance</h1>
        <p>Prepare a request for the school-project referral demonstration.</p>
      </div>

      <div
        className="assessment-entry__prototype"
        id="assessment-prototype-note"
        role="note"
      >
        <Info size={18} aria-hidden="true" />
        <div>
          <strong>School-project demonstration only</strong>
          <p>
            This form does not send information to an institution. Submission
            and saving are currently unavailable. Use non-sensitive test inputs
            only, not real contact details or confidential dispute information.
            Entries and acknowledgements are not submitted or saved by
            JusticeNav KE.
          </p>
        </div>
      </div>

      <ReferralRequestForm
        key={selection ? JSON.stringify(selection) : "unselected"}
        selection={selection}
        status={status}
        retry={context.status === "error" ? context.retry : undefined}
      />
    </AssessmentLayout>
  );
}
