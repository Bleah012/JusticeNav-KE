import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Info, X } from "lucide-react";
import { Button } from "./ui/Button";
import {
  formatAdminDate,
  isAdminSourceUrl,
  publicationLabels,
  verificationLabels,
} from "../types/adminData";
import type { AdminServiceRecord } from "../types/adminData";

// Keep public service-editing fields blank unless an actual record was supplied.
function TextField({
  name,
  label,
  value = "",
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  value?: string;
  type?: "text" | "url" | "date";
  required?: boolean;
}) {
  return (
    <label className="admin-pages__field" htmlFor={`service-editor-${name}`}>
      <span>{label}</span>
      <input
        id={`service-editor-${name}`}
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        maxLength={1000}
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  value = "",
  required = false,
}: {
  name: string;
  label: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label className="admin-pages__field" htmlFor={`service-editor-${name}`}>
      <span>{label}</span>
      <textarea
        id={`service-editor-${name}`}
        name={name}
        defaultValue={value}
        required={required}
        maxLength={4000}
      />
    </label>
  );
}

// Use native modal focus containment and restore focus when the editor closes.
export function AdminServiceEditor({
  record,
  onClose,
}: {
  record: AdminServiceRecord | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector<HTMLInputElement>("input[name='title']")?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // Validate a local preview; never save, publish, archive or verify a record.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const value = (name: string) => String(values.get(name) ?? "").trim();
    function fail(message: string, name: string) {
      setError(message);
      const control = form.elements.namedItem(name);
      if (control instanceof HTMLElement) control.focus();
    }
    if (!value("title"))
      return fail("Enter the official organisation name.", "title");
    if (!value("description"))
      return fail("Enter a public description.", "description");
    if (!value("category"))
      return fail("Select a service category.", "category");
    if (!Object.hasOwn(publicationLabels, value("publication")))
      return fail("Select a publication status.", "publication");
    if (!isAdminSourceUrl(value("sourceUrl")))
      return fail(
        "Enter an HTTPS official source URL without embedded credentials.",
        "sourceUrl",
      );
    const verification = value("verification");
    if (!Object.hasOwn(verificationLabels, verification))
      return fail("Select a verification status.", "verification");
    if (value("verifiedOn") && !formatAdminDate(value("verifiedOn")))
      return fail("Enter a valid verification date.", "verifiedOn");
    if (verification === "verified" && !formatAdminDate(value("verifiedOn")))
      return fail(
        "Enter a verification date before selecting Verified.",
        "verifiedOn",
      );
    setError(
      "Service management is currently unavailable. Nothing has been submitted, saved, published or marked verified.",
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="admin-pages__drawer"
      aria-labelledby="service-editor-heading"
      aria-describedby="service-editor-note"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="admin-pages__drawer-head">
        <div>
          <span className="seeker-page__eyebrow">
            Justice service management
          </span>
          <h2 id="service-editor-heading">
            {record ? "Edit service information" : "Add justice service"}
          </h2>
          <p>
            Maintain accurate public information and a clear verification trail.
          </p>
        </div>
        <button
          className="admin-pages__close"
          type="button"
          onClick={onClose}
          aria-label="Close form"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <form
        noValidate
        autoComplete="off"
        onSubmit={handleSubmit}
        onChange={() => setError(null)}
        aria-describedby={
          error ? "service-editor-error" : "service-editor-note"
        }
      >
        <div className="seeker-page__notice" id="service-editor-note">
          <Info size={20} aria-hidden="true" />
          <p>
            Local form preview only. Use non-sensitive test inputs. Saving and
            verification are unavailable; an entered URL or selected status does
            not verify a source.
          </p>
        </div>
        <section aria-labelledby="service-organisation-title">
          <h3 id="service-organisation-title">Organisation information</h3>
          <TextField
            name="title"
            label="Organisation name"
            value={record?.title}
            required
          />
          <TextArea
            name="description"
            label="Public description"
            value={record?.description ?? ""}
            required
          />
          <div className="admin-pages__form-grid">
            <label
              className="admin-pages__field"
              htmlFor="service-editor-category"
            >
              <span>Service category</span>
              <select
                id="service-editor-category"
                name="category"
                defaultValue={record?.category ?? ""}
                required
              >
                <option value="">Select a service category</option>
                {Array.from(
                  new Set([
                    ...(record ? [record.category] : []),
                    "Legal aid",
                    "Court services",
                    "Mediation",
                    "Consumer complaints",
                    "Professional legal assistance",
                  ]),
                ).map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="admin-pages__field"
              htmlFor="service-editor-publication"
            >
              <span>Publication status</span>
              <select
                id="service-editor-publication"
                name="publication"
                defaultValue={record?.publication ?? "draft"}
              >
                {Object.entries(publicationLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section aria-labelledby="service-access-title">
          <h3 id="service-access-title">Eligibility and access</h3>
          <TextArea
            name="eligibility"
            label="Who may qualify"
            value={record?.eligibility ?? ""}
          />
          <TextArea
            name="requirements"
            label="Requirements"
            value={record?.requirements ?? ""}
          />
          <div className="admin-pages__form-grid">
            <TextField
              name="contact"
              label="Contact information"
              value={record?.contact ?? ""}
            />
            <TextField
              name="location"
              label="Location / coverage"
              value={record?.location ?? ""}
            />
          </div>
          <label className="admin-pages__field" htmlFor="service-editor-access">
            <span>Access methods</span>
            <select
              id="service-editor-access"
              name="access"
              defaultValue={record?.access ?? ""}
            >
              <option value="">Select an access method</option>
              <option value="both">Remote and in person</option>
              <option value="remote">Remote only</option>
              <option value="in-person">In person only</option>
            </select>
          </label>
        </section>
        <section aria-labelledby="service-verification-title">
          <h3 id="service-verification-title">Verification record</h3>
          <p>
            Only mark information verified after checking an official source.
          </p>
          <TextField
            name="sourceUrl"
            label="Official source URL"
            type="url"
            value={record?.sourceUrl ?? ""}
            required
          />
          <div className="admin-pages__form-grid">
            <TextField
              name="verifiedOn"
              label="Verification date"
              type="date"
              value={record?.verifiedOn ?? ""}
            />
            <label
              className="admin-pages__field"
              htmlFor="service-editor-verification"
            >
              <span>Verification status</span>
              <select
                id="service-editor-verification"
                name="verification"
                defaultValue={record?.verification ?? "needs-review"}
              >
                {Object.entries(verificationLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TextArea
            name="verificationNote"
            label="Internal verification note"
            value={record?.verificationNote ?? ""}
          />
        </section>
        {error && (
          <p
            id="service-editor-error"
            className="admin-pages__form-error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div className="admin-pages__drawer-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {record && (
            <Button
              variant="secondary"
              disabled
              title="Draft saving is currently unavailable."
            >
              Save as draft
            </Button>
          )}
          <Button type="submit">
            {record ? "Save and verify" : "Add service"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
