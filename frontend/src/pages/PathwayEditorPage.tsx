import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Info, Plus } from "lucide-react";
import { Link, useParams } from "react-router";
import { AdminDataState } from "../components/AdminDataState";
import { Button } from "../components/ui/Button";
import {
  formatAdminDate,
  isAdminSourceUrl,
  publicationLabels,
  verificationLabels,
} from "../types/adminData";
import { validEditablePathway } from "../types/workspaceData";
import type {
  EditablePathway,
  PathwayEditorData,
} from "../types/workspaceData";
import "./WorkspacePages.css";

// Reuse labeled public-information controls without adding sample content.
function EditorField({
  name,
  label,
  value = "",
  multiline = false,
  type = "text",
  required = false,
  hint,
}: {
  name: string;
  label: string;
  value?: string;
  multiline?: boolean;
  type?: "text" | "url" | "date";
  required?: boolean;
  hint?: string;
}) {
  const id = `pathway-editor-${name}`;
  return (
    <label className="admin-pages__field" htmlFor={id}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          defaultValue={value}
          required={required}
          maxLength={7000}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          maxLength={1000}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}

type LocalStep = { key: number; title: string; description: string };

// Keep draft fields and stable step keys local; no pathway identifiers are generated.
function PathwayForm({ record }: { record: EditablePathway | null }) {
  const [steps, setSteps] = useState<LocalStep[]>(() =>
    record
      ? record.startingSteps.map((item, index) => ({
          key: index + 1,
          title: item.title,
          description: item.description ?? "",
        }))
      : [{ key: 1, title: "", description: "" }],
  );
  const nextStepKey = useRef((record?.startingSteps.length ?? 1) + 1);
  const [error, setError] = useState<string | null>(null);

  function handleAddStep() {
    const key = nextStepKey.current++;
    setSteps((current) => [...current, { key, title: "", description: "" }]);
    setError(null);
  }

  function handleStepChange(
    key: number,
    field: "title" | "description",
    value: string,
  ) {
    setSteps((current) =>
      current.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );
  }

  // Validate the editorial preview without saving, publishing or verifying content.
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
    if (!value("title")) return fail("Enter a pathway title.", "title");
    if (!value("category")) return fail("Select a category.", "category");
    if (!value("overview"))
      return fail("Enter a pathway overview.", "overview");
    if (!Object.hasOwn(publicationLabels, value("publication")))
      return fail("Select a publication status.", "publication");
    const incompleteStep = steps.find(
      (item) => item.description.trim() && !item.title.trim(),
    );
    if (incompleteStep)
      return fail(
        "Add a title for this starting step.",
        `step-title-${incompleteStep.key}`,
      );
    if (!value("sourceName"))
      return fail("Enter the source name.", "sourceName");
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
      "Pathway saving is currently unavailable. Nothing has been submitted, saved, published or marked verified.",
    );
  }

  return (
    <form
      className="workspace-pages__pathway-form"
      noValidate
      autoComplete="off"
      onSubmit={handleSubmit}
      onChange={() => setError(null)}
      aria-describedby="pathway-editor-note"
    >
      <section
        className="seeker-page__panel"
        aria-labelledby="pathway-information-title"
      >
        <h2 id="pathway-information-title">Pathway information</h2>
        <EditorField
          name="title"
          label="Pathway title"
          value={record?.title}
          required
        />
        <div className="admin-pages__form-grid">
          <label
            className="admin-pages__field"
            htmlFor="pathway-editor-category"
          >
            <span>Category</span>
            <select
              id="pathway-editor-category"
              name="category"
              defaultValue={record?.category ?? ""}
              required
            >
              <option value="">Select a category</option>
              {Array.from(
                new Set([
                  ...(record ? [record.category] : []),
                  "Consumer",
                  "Money / Debt",
                  "Civil & monetary",
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
            htmlFor="pathway-editor-publication"
          >
            <span>Publication status</span>
            <select
              id="pathway-editor-publication"
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
        <EditorField
          name="overview"
          label="Overview"
          multiline
          value={record?.overview ?? ""}
          required
        />
        <EditorField
          name="whoMayUse"
          label="Who may use this pathway?"
          multiline
          value={record?.whoMayUse ?? ""}
        />
        <EditorField
          name="matters"
          label="What matters can it handle?"
          multiline
          value={record?.matters.join("\n") ?? ""}
          hint="Enter one item per line using published source information."
        />
        <EditorField
          name="requirements"
          label="What might you need?"
          multiline
          value={record?.requirements.join("\n") ?? ""}
          hint="Enter one requirement per line. Leave unpublished information blank."
        />
      </section>
      <section
        className="seeker-page__panel"
        aria-labelledby="pathway-starting-title"
      >
        <h2 id="pathway-starting-title">How do you start?</h2>
        {steps.map((item, index) => (
          <fieldset className="workspace-pages__step" key={item.key}>
            <legend>Step {index + 1}</legend>
            <label
              className="admin-pages__field"
              htmlFor={`pathway-step-title-${item.key}`}
            >
              <span>Step title</span>
              <input
                id={`pathway-step-title-${item.key}`}
                name={`step-title-${item.key}`}
                value={item.title}
                maxLength={200}
                onChange={(event) =>
                  handleStepChange(item.key, "title", event.target.value)
                }
              />
            </label>
            <label
              className="admin-pages__field"
              htmlFor={`pathway-step-description-${item.key}`}
            >
              <span>Description (optional)</span>
              <textarea
                id={`pathway-step-description-${item.key}`}
                name={`step-description-${item.key}`}
                value={item.description}
                maxLength={2000}
                onChange={(event) =>
                  handleStepChange(item.key, "description", event.target.value)
                }
              />
            </label>
            <Button
              variant="ghost"
              aria-label={`Remove step ${index + 1}`}
              onClick={() => {
                setSteps((current) =>
                  current.filter((step) => step.key !== item.key),
                );
                setError(null);
              }}
            >
              Remove step
            </Button>
          </fieldset>
        ))}
        {!steps.length && <p>No starting steps entered.</p>}
        <Button variant="secondary" icon={Plus} onClick={handleAddStep}>
          Add step
        </Button>
        <EditorField
          name="nextStages"
          label="What happens next?"
          multiline
          value={record?.nextStages.join("\n") ?? ""}
          hint="Enter one published next stage per line."
        />
      </section>
      <section
        className="seeker-page__panel"
        aria-labelledby="pathway-verification-title"
      >
        <h2 id="pathway-verification-title">Verification record</h2>
        <EditorField
          name="sourceName"
          label="Source name"
          value={record?.sourceName ?? ""}
          required
        />
        <EditorField
          name="sourceUrl"
          label="Official source URL"
          type="url"
          value={record?.sourceUrl ?? ""}
          required
        />
        <div className="admin-pages__form-grid">
          <EditorField
            name="verifiedOn"
            label="Verification date"
            type="date"
            value={record?.verifiedOn ?? ""}
          />
          <label
            className="admin-pages__field"
            htmlFor="pathway-editor-verification"
          >
            <span>Verification status</span>
            <select
              id="pathway-editor-verification"
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
        <EditorField
          name="verificationNote"
          label="Internal verification note"
          multiline
          value={record?.verificationNote ?? ""}
        />
        <p>
          Only mark information verified after checking an official source.
          Entering a URL or selecting a status does not verify its contents.
        </p>
      </section>
      {error && (
        <p className="admin-pages__form-error" role="alert">
          {error}
        </p>
      )}
      <div className="workspace-pages__actions">
        <Link className="btn btn-secondary" to="/admin/pathways">
          Cancel
        </Link>
        <Button disabled title="Publication is currently unavailable.">
          Publish pathway
        </Button>
        <Button type="submit">Save pathway</Button>
      </div>
    </form>
  );
}

// Create previews stay blank; edit previews require a full record matching the URL.
export function PathwayEditorPage({
  data = { status: "unavailable" },
}: {
  data?: PathwayEditorData;
}) {
  const { pathwayId } = useParams();
  const editing = Boolean(pathwayId);
  const supplied = data.status === "ready" ? data.value : null;
  const record =
    editing &&
    supplied &&
    supplied.id === pathwayId &&
    validEditablePathway(supplied)
      ? supplied
      : null;
  const state =
    data.status === "ready" && editing && !record
      ? supplied?.id === pathwayId
        ? "error"
        : "unavailable"
      : data.status;
  const showForm =
    (!editing || Boolean(record)) &&
    state !== "loading" &&
    state !== "error" &&
    state !== "forbidden" &&
    state !== "not-found";
  return (
    <>
      <Link className="admin-pages__related-link" to="/admin/pathways">
        Back to pathway management
      </Link>
      <header className="seeker-page__heading">
        <span className="seeker-page__eyebrow">Pathway management</span>
        <h1>{editing ? "Edit pathway" : "Create pathway"}</h1>
        <p>Maintain pathway information, eligibility and official sources.</p>
      </header>
      <div className="seeker-page__notice" id="pathway-editor-note">
        <Info size={20} aria-hidden="true" />
        <p>
          Local editorial preview only. Use non-sensitive test inputs. Saving,
          publication and verification are unavailable. Leaving the page does
          not save your entries.
        </p>
      </div>
      {showForm ? (
        <PathwayForm key={JSON.stringify(record)} record={record} />
      ) : state === "not-found" ? (
        <div className="seeker-page__state" role="status">
          <h2>Pathway not found</h2>
          <p>The requested editorial record could not be found.</p>
        </div>
      ) : (
        <AdminDataState
          subject="Pathway information"
          status={state === "ready" ? "unavailable" : state}
          retry={data.status === "error" ? data.retry : undefined}
        />
      )}
    </>
  );
}
