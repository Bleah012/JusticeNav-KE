import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { Plus } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { createServiceManagementApi } from "../admin/serviceManagementApi";
import type {
  ServiceCommand,
  ServiceRecord,
} from "../admin/serviceManagementApi";
import { ServiceManagementResource } from "../admin/ServiceManagementResource";
import type { ServiceProfile } from "../pages/ServiceProfilePage";
import { AdminDataState } from "./AdminDataState";
import { Button } from "./ui/Button";
import "../pages/ServiceManagement.css";

const labels = { draft: "Draft", published: "Published", archived: "Archived" };
const contactFields = [
  "access",
  "coverage",
  "hours",
  "address",
  "phone",
  "email",
] as const;
type Modal =
  | { type: "new" }
  | {
      type: "view" | "edit" | "publish" | "archive" | "delete";
      record: ServiceRecord;
    };

export function Field({
  name,
  label,
  value = "",
  required = false,
  multiline = false,
  type = "text",
  help,
  maxLength,
}: {
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  multiline?: boolean;
  type?: string;
  help?: string;
  maxLength?: number;
}) {
  return (
    <label className="admin-pages__field" htmlFor={`service-${name}`}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {multiline ? (
        <textarea
          id={`service-${name}`}
          name={name}
          defaultValue={value}
          required={required}
          maxLength={maxLength ?? 16000}
          rows={3}
          aria-describedby={help ? `service-${name}-help` : undefined}
        />
      ) : (
        <input
          id={`service-${name}`}
          name={name}
          defaultValue={value}
          required={required}
          type={type}
          maxLength={maxLength ?? (name === "id" ? 64 : 2000)}
          aria-describedby={help ? `service-${name}-help` : undefined}
        />
      )}
      {help && <small id={`service-${name}-help`}>{help}</small>}
    </label>
  );
}

export function ReviewFields() {
  return (
    <div className="service-management__review">
      <Field
        name="reviewNote"
        label="Source review note"
        maxLength={1000}
        multiline
        required
        help="Describe what you checked against the linked official sources."
      />
      <label className="service-management__check">
        <input type="checkbox" name="reviewed" required />I reviewed the
        official sources and confirm these details are ready for publication.
      </label>
    </div>
  );
}

// Edit the complete public profile while keeping publication and revisions server-controlled.
function ServiceEditor({
  record,
  busy,
  submit,
}: {
  record: ServiceRecord | null;
  busy: boolean;
  submit: (command: ServiceCommand) => void;
}) {
  const [error, setError] = useState("");
  const service = record?.service;
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const nullable = (name: string) => text(name) || null;
    const lines = (name: string) =>
      text(name)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const pairs = (name: string) =>
      lines(name).map((line) => {
        const [first, ...rest] = line.split("|");
        return [first.trim(), rest.join("|").trim()];
      });
    const sources = pairs("sources").map(([name, url]) => ({ name, url }));
    const id = service?.id ?? text("id");
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      id.length < 3 ||
      id.length > 64
    ) {
      setError(
        "Use a reference with 3–64 lowercase letters, numbers and single hyphens.",
      );
      return;
    }
    if (sources.some((item) => !item.name || !item.url) || !sources.length) {
      setError("Enter each source as Name | https://official-address.");
      return;
    }
    const details: ServiceProfile = {
      id,
      name: text("name"),
      serviceType: text("serviceType"),
      location: text("location"),
      description: text("description"),
      eligibility: nullable("eligibility"),
      accessMethods: lines("accessMethods"),
      deliveryModes: lines("deliveryModes"),
      about: nullable("about"),
      offeredServices: lines("offeredServices"),
      whoMayQualify: nullable("whoMayQualify"),
      accessSteps: pairs("accessSteps").map(([title, description]) => ({
        title,
        description: description || null,
      })),
      officialWebsite: text("officialWebsite"),
      sourceReview: { checkedOn: text("checkedOn"), sources },
      contact: {
        access: nullable("contact-access"),
        coverage: nullable("contact-coverage"),
        hours: nullable("contact-hours"),
        address: nullable("contact-address"),
        phone: nullable("contact-phone"),
        email: nullable("contact-email"),
      },
    };
    setError("");
    submit({
      type: "save",
      service: details,
      publication: record?.publication ?? "draft",
      expectedRevision: record?.revision ?? 0,
      reviewed: data.get("reviewed") === "on",
      reviewNote: text("reviewNote"),
    });
  }
  return (
    <form onSubmit={onSubmit}>
      <fieldset disabled={busy}>
        <legend className="admin-pages__sr-only">Service details</legend>
        <p>
          Fields marked * are required. New entries are saved as private drafts.
        </p>
        <div className="service-management__fields">
          {service ? (
            <p>
              <strong>Service reference:</strong> {service.id}
            </p>
          ) : (
            <Field
              name="id"
              label="Service reference"
              required
              help="Choose a stable reference, for example county-help-desk. It cannot be changed or reused after deletion."
            />
          )}
          <Field
            name="name"
            label="Service name"
            value={service?.name}
            required
          />
          <Field
            name="serviceType"
            label="Service type"
            value={service?.serviceType}
            required
          />
          <Field
            name="location"
            label="Location or coverage"
            value={service?.location}
            required
          />
          <Field
            name="description"
            label="Short description"
            value={service?.description}
            required
            multiline
          />
          <Field
            name="about"
            label="About the service"
            value={service?.about ?? ""}
            multiline
          />
          <Field
            name="eligibility"
            label="Eligibility summary"
            value={service?.eligibility ?? ""}
            multiline
          />
          <Field
            name="whoMayQualify"
            label="Who may qualify"
            value={service?.whoMayQualify ?? ""}
            multiline
          />
          <Field
            name="accessMethods"
            label="Access methods"
            value={service?.accessMethods.join("\n")}
            multiline
            help="One entry per line; up to 10 entries."
          />
          <Field
            name="deliveryModes"
            label="Delivery modes"
            value={service?.deliveryModes.join("\n")}
            multiline
            help="One entry per line; up to 5 entries."
          />
          <Field
            name="offeredServices"
            label="Services offered"
            value={service?.offeredServices.join("\n")}
            multiline
            help="One entry per line; up to 15 entries."
          />
          <Field
            name="accessSteps"
            label="Steps to access"
            value={service?.accessSteps
              .map((step) => `${step.title} | ${step.description ?? ""}`)
              .join("\n")}
            multiline
            help="One step per line: Title | Description. Up to 10 steps."
          />
          <Field
            name="officialWebsite"
            label="Official website"
            value={service?.officialWebsite ?? ""}
            type="url"
            required
            help="Approved official domains: judiciary.go.ke, cak.go.ke and nlas.go.ke, including www. Use HTTPS without query strings or fragments."
          />
          <Field
            name="checkedOn"
            label="Source checked on"
            value={service?.sourceReview?.checkedOn}
            type="date"
            required
            help="Enter the actual review date; future dates are not accepted."
          />
          <Field
            name="sources"
            label="Official sources"
            value={service?.sourceReview?.sources
              .map((source) => `${source.name} | ${source.url}`)
              .join("\n")}
            multiline
            required
            help="One source per line: Name | https://official-address. Up to 8 sources from the approved domains above."
          />
        </div>
        <h3>Published contact information</h3>
        <p>
          Enter institutional contact details from the official sources. Leave
          unknown fields empty.
        </p>
        <div className="service-management__fields">
          {contactFields.map((name) => (
            <Field
              key={name}
              name={`contact-${name}`}
              label={name.charAt(0).toUpperCase() + name.slice(1)}
              value={service?.contact[name] ?? ""}
            />
          ))}
        </div>
        {record?.publication === "published" && (
          <>
            <p>Saving these changes updates the public page immediately.</p>
            <ReviewFields />
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <Button type="submit">
          {busy ? "Saving…" : record ? "Save service changes" : "Save draft"}
        </Button>
      </fieldset>
    </form>
  );
}

function ServiceDetails({ record }: { record: ServiceRecord }) {
  const service = record.service;
  return (
    <div>
      <p>
        <strong>{service.name}</strong> · {labels[record.publication]} ·
        Revision {record.revision}
      </p>
      <dl className="service-management__details">
        {[
          ["Reference", service.id],
          ["Type", service.serviceType],
          ["Location", service.location],
          ["Description", service.description],
          ["About", service.about],
          ["Eligibility", service.eligibility],
          ["Who may qualify", service.whoMayQualify],
          ["Access methods", service.accessMethods.join("; ")],
          ["Delivery modes", service.deliveryModes.join("; ")],
          ["Services offered", service.offeredServices.join("; ")],
          ["Source checked", service.sourceReview?.checkedOn],
          ["Review note", record.reviewNote],
          [
            "Last changed",
            record.updatedAt
              ? new Date(record.updatedAt).toLocaleString("en-KE", {
                  timeZone: "Africa/Nairobi",
                })
              : "Reviewed baseline entry",
          ],
        ].map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value || "Not recorded"}</dd>
          </div>
        ))}
        {contactFields.map((name) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{service.contact[name] || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
      <h3>Access steps</h3>
      <ol>
        {service.accessSteps.map((step, index) => (
          <li key={index}>
            <strong>{step.title}</strong> {step.description}
          </li>
        ))}
      </ol>
      <h3>Official sources</h3>
      <ul>
        {service.sourceReview?.sources.map((source, index) => (
          <li key={index}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.name}
            </a>
          </li>
        ))}
      </ul>
      {record.publication === "published" && (
        <Link className="btn btn-secondary" to={`/services/${service.id}`}>
          View public page
        </Link>
      )}
    </div>
  );
}

function ServiceModal({
  modal,
  busy,
  close,
  submit,
  message,
  blocked,
}: {
  modal: Modal;
  busy: boolean;
  close: () => void;
  submit: (command: ServiceCommand) => void;
  message: string;
  blocked: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title =
    modal.type === "new"
      ? "Add justice service"
      : `${{ view: "Service details", edit: "Edit service", publish: "Publish service", archive: "Archive service", delete: "Delete draft" }[modal.type]}: ${modal.record.service.name}`;
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modal.type === "new" || modal.type === "view" || modal.type === "edit")
      return;
    const data = new FormData(event.currentTarget),
      row = modal.record;
    submit(
      modal.type === "delete"
        ? { type: "delete", id: row.service.id, expectedRevision: row.revision }
        : {
            type: "publication",
            id: row.service.id,
            expectedRevision: row.revision,
            publication: modal.type === "publish" ? "published" : "archived",
            reviewed: data.get("reviewed") === "on",
            reviewNote: String(data.get("reviewNote") ?? "").trim(),
          },
    );
  }
  return (
    <dialog
      className="service-management__modal"
      ref={ref}
      aria-labelledby="service-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="service-management__modal-head">
        <h2 id="service-dialog-title">{title}</h2>
        <Button variant="secondary" disabled={busy} onClick={close}>
          Close
        </Button>
      </header>
      {message && (blocked || message.startsWith("Check ")) && (
        <p role="alert">{message}</p>
      )}
      {blocked && (
        <p>
          Close this dialog, reload services and reopen the record before making
          another change.
        </p>
      )}
      {modal.type === "view" ? (
        <ServiceDetails record={modal.record} />
      ) : modal.type === "new" || modal.type === "edit" ? (
        <ServiceEditor
          record={modal.type === "edit" ? modal.record : null}
          busy={busy || blocked}
          submit={submit}
        />
      ) : (
        <form onSubmit={confirm}>
          <fieldset disabled={busy || blocked}>
            <legend className="admin-pages__sr-only">
              Confirm service action
            </legend>
            <p>
              {modal.type === "delete"
                ? "Permanently delete this unused draft? Its reference will remain reserved. This action cannot be undone."
                : modal.type === "archive"
                  ? "Remove this service from the public directory? Existing saved records retain their snapshots. The service can be published again after review."
                  : "Publish this service in the public directory? Check the details and source links before confirming."}
            </p>
            {modal.type === "publish" && <ReviewFields />}
            <Button
              variant={modal.type === "delete" ? "danger" : "primary"}
              type="submit"
            >
              {busy
                ? "Saving…"
                : modal.type === "delete"
                  ? "Delete draft permanently"
                  : modal.type === "archive"
                    ? "Confirm archive"
                    : "Confirm publication"}
            </Button>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}

// Present confirmed records and isolate all modal actions behind the account-bound resource.
export function ServiceManagementView({
  resource,
}: {
  resource: ServiceManagementResource;
}) {
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  const [modal, setModal] = useState<Modal | null>(null);
  const [search, setSearch] = useState("");
  const [publication, setPublication] = useState("all");
  useEffect(() => resource.start(), [resource]);
  const rows =
    state.value?.records
      .filter(
        (row) =>
          (publication === "all" || row.publication === publication) &&
          `${row.service.name} ${row.service.id} ${row.service.location}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
      )
      .sort((a, b) => a.service.name.localeCompare(b.service.name)) ?? [];
  const disabled = state.busy || state.needsReload;
  async function submit(command: ServiceCommand) {
    if (await resource.change(command)) setModal(null);
  }
  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Justice services</h1>
          <p>Create and maintain source-backed service information.</p>
        </div>
        <div className="seeker-page__actions">
          <Button
            variant="secondary"
            disabled={state.busy || state.status === "loading"}
            onClick={() => void resource.reload()}
          >
            Reload services
          </Button>
          <Button
            disabled={disabled || state.status !== "ready"}
            onClick={() => setModal({ type: "new" })}
          >
            <Plus size={18} aria-hidden="true" />
            Add service
          </Button>
        </div>
      </header>
      <div className="seeker-page__notice">
        <p>
          Drafts are private to administrators. Publishing requires a source
          review. Services linked to published pathways cannot be archived;
          published entries cannot be permanently deleted.
        </p>
      </div>
      {state.message && (
        <p
          className="service-management__feedback"
          role={state.needsReload ? "alert" : "status"}
        >
          {state.message}
        </p>
      )}
      {state.status !== "ready" ? (
        <AdminDataState
          subject="Service information"
          status={state.status}
          retry={
            state.status === "error" ? () => void resource.reload() : undefined
          }
        />
      ) : (
        <>
          <form
            className="service-management__filters"
            role="search"
            onSubmit={(event) => event.preventDefault()}
          >
            <label>
              Search services
              <input
                type="search"
                maxLength={200}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              Publication
              <select
                value={publication}
                onChange={(event) => setPublication(event.target.value)}
              >
                <option value="all">All statuses</option>
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </form>
          <p role="status">
            {rows.length} service{rows.length === 1 ? "" : "s"}
          </p>
          <ul className="service-management__list">
            {rows.map((row) => {
              const protectedEntry = state.value!.protectedServiceIds.includes(
                row.service.id,
              );
              return (
                <li key={row.service.id}>
                  <div>
                    <h2>{row.service.name}</h2>
                    <p>
                      {row.service.serviceType} · {row.service.location}
                    </p>
                    <p>
                      <span className="seeker-page__badge">
                        {labels[row.publication]}
                      </span>{" "}
                      · Revision {row.revision}
                    </p>
                    {protectedEntry && <p>Linked to a published pathway.</p>}
                  </div>
                  <div className="service-management__row-actions">
                    <Button
                      variant="secondary"
                      disabled={state.busy}
                      onClick={() => setModal({ type: "view", record: row })}
                    >
                      View details
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => setModal({ type: "edit", record: row })}
                    >
                      Edit
                    </Button>
                    {row.publication !== "published" && (
                      <Button
                        disabled={disabled}
                        onClick={() =>
                          setModal({ type: "publish", record: row })
                        }
                      >
                        {row.publication === "archived"
                          ? "Republish"
                          : "Publish"}
                      </Button>
                    )}
                    {row.publication === "published" && (
                      <Button
                        variant="secondary"
                        disabled={disabled || protectedEntry}
                        title={
                          protectedEntry
                            ? "Resolve the published pathway link before archiving."
                            : undefined
                        }
                        onClick={() =>
                          setModal({ type: "archive", record: row })
                        }
                      >
                        Archive
                      </Button>
                    )}
                    {!row.everPublished && (
                      <Button
                        variant="danger"
                        disabled={disabled || protectedEntry}
                        onClick={() =>
                          setModal({ type: "delete", record: row })
                        }
                      >
                        Delete draft
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {!rows.length && <p>No services match these filters.</p>}
        </>
      )}
      {modal && state.status === "ready" && (
        <ServiceModal
          modal={modal}
          busy={state.busy}
          close={() => setModal(null)}
          submit={(command) => void submit(command)}
          message={state.message}
          blocked={state.needsReload}
        />
      )}
    </>
  );
}

function AuthorizedServiceManagement({ uid }: { uid: string }) {
  const [resource] = useState(
    () =>
      new ServiceManagementResource(
        createServiceManagementApi({
          baseUrl: backendUrl,
          uid,
          currentUser: () => firebaseAuth().currentUser,
        }),
      ),
  );
  return <ServiceManagementView resource={resource} />;
}

export function ServiceManagement() {
  const { session } = useAuth();
  return session.status === "ready" && session.identity.role === "admin" ? (
    <AuthorizedServiceManagement
      key={session.identity.uid}
      uid={session.identity.uid}
    />
  ) : (
    <AdminDataState subject="Service information" status="forbidden" />
  );
}
