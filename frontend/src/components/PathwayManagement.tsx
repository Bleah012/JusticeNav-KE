import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../auth/useAuth";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { CatalogManagementResource } from "../admin/CatalogManagementResource";
import { createPathwayManagementApi } from "../admin/pathwayManagementApi";
import type {
  PathwayCommand,
  PathwayList,
  PathwayRecord,
} from "../admin/pathwayManagementApi";
import type { Pathway } from "../pathways/pathwayApi";
import { AdminDataState } from "./AdminDataState";
import { Button } from "./ui/Button";
import { Field, ReviewFields } from "./ServiceManagement";
import "../pages/PathwayManagement.css";

type Resource = CatalogManagementResource<PathwayList, PathwayCommand>;
type Mode = "list" | "new" | "edit";
const labels = { draft: "Draft", published: "Published", archived: "Archived" };

// Preserve stable row keys while editing the full guide and its preparation template.
function PathwayForm({
  record,
  services,
  disabled,
  save,
}: {
  record: PathwayRecord | null;
  services: PathwayList["publishedServices"];
  disabled: boolean;
  save: (command: PathwayCommand) => void;
}) {
  const pathway = record?.pathway;
  const [steps, setSteps] = useState(
    () =>
      pathway?.startingSteps.map((item, index) => ({
        key: index,
        ...item,
      })) ?? [{ key: 0, title: "", description: "" }],
  );
  const [items, setItems] = useState(
    () =>
      pathway?.preparation.map((item, index) => ({ key: index, ...item })) ?? [
        { key: 0, id: "", label: "", note: "" },
      ],
  );
  const stepKey = useRef(steps.length),
    itemKey = useRef(items.length);
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const lines = (name: string) =>
      text(name)
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
    const reference = pathway?.id ?? text("id");
    const valid = (id: string) =>
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) &&
      id.length >= 3 &&
      id.length <= 64;
    const preparation = items.map((item) => ({
      id: text(`item-id-${item.key}`),
      label: text(`item-label-${item.key}`),
      note: text(`item-note-${item.key}`),
    }));
    if (
      !valid(reference) ||
      preparation.some((item) => !valid(item.id)) ||
      new Set(preparation.map((item) => item.id)).size !== preparation.length
    ) {
      setError(
        "Use unique references with 3–64 lowercase letters, numbers and single hyphens.",
      );
      return;
    }
    const sources = lines("sources").map((value) => {
      const [name, ...url] = value.split("|");
      return { name: name.trim(), url: url.join("|").trim() };
    });
    if (
      !sources.length ||
      sources.some((source) => !source.name || !source.url)
    ) {
      setError(
        "Enter each official source as Name | https://official-address.",
      );
      return;
    }
    const next: Pathway = {
      id: reference,
      title: text("title"),
      category: text("category"),
      serviceId: text("serviceId"),
      overview: text("overview"),
      whoMayUse: text("whoMayUse"),
      matters: lines("matters"),
      requirements: lines("requirements"),
      nextStages: lines("nextStages"),
      startingSteps: steps.map((item) => ({
        title: text(`step-title-${item.key}`),
        description: text(`step-description-${item.key}`) || null,
      })),
      sourceReview: { checkedOn: text("checkedOn"), sources },
      preparation,
    };
    setError("");
    save({
      type: "save",
      pathway: next,
      expectedRevision: record?.revision ?? 0,
      publication: record?.publication ?? "draft",
      reviewed: data.get("reviewed") === "on",
      reviewNote: text("reviewNote"),
    });
  }
  return (
    <form className="pathway-management__editor" onSubmit={submit}>
      <fieldset disabled={disabled}>
        <legend className="admin-pages__sr-only">Pathway details</legend>
        <p>Fields marked * are required. New entries are saved as drafts.</p>
        <section
          className="seeker-page__panel"
          aria-labelledby="pathway-guide-fields"
        >
          <h2 id="pathway-guide-fields">Pathway information</h2>
          <div className="service-management__fields">
            {pathway ? (
              <p>
                <strong>Pathway reference:</strong> {pathway.id}
              </p>
            ) : (
              <Field
                name="id"
                label="Pathway reference"
                required
                help="A stable reference such as development-pathway. It cannot be changed or reused after deletion."
              />
            )}
            <Field
              name="title"
              label="Pathway title"
              value={pathway?.title}
              required
            />
            <Field
              name="category"
              label="Category"
              value={pathway?.category}
              required
              help="A descriptive catalogue category; this does not change the assessment mapping."
            />
            <label className="admin-pages__field" htmlFor="pathway-serviceId">
              <span>Related published service *</span>
              <select
                id="pathway-serviceId"
                name="serviceId"
                required
                defaultValue={pathway?.serviceId ?? ""}
              >
                <option value="">Select a published service</option>
                {pathway &&
                  !services.some(
                    (service) => service.id === pathway.serviceId,
                  ) && (
                    <option value={pathway.serviceId} disabled>
                      Previously linked service is not published
                    </option>
                  )}
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              name="overview"
              label="Overview"
              value={pathway?.overview}
              required
              multiline
            />
            <Field
              name="whoMayUse"
              label="Who may use this pathway"
              value={pathway?.whoMayUse}
              required
              multiline
            />
            <Field
              name="matters"
              label="Matters covered"
              value={pathway?.matters.join("\n")}
              multiline
              help="One entry per line; up to 10."
            />
            <Field
              name="requirements"
              label="Requirements"
              value={pathway?.requirements.join("\n")}
              multiline
              help="One published requirement per line; up to 10."
            />
            <Field
              name="nextStages"
              label="What happens next"
              value={pathway?.nextStages.join("\n")}
              multiline
              help="One published stage per line; up to 10."
            />
          </div>
        </section>
        <section
          className="seeker-page__panel"
          aria-labelledby="pathway-steps-title"
        >
          <h2 id="pathway-steps-title">Starting steps</h2>
          {steps.map((item, index) => (
            <fieldset className="pathway-management__item" key={item.key}>
              <legend>Step {index + 1}</legend>
              <Field
                name={`step-title-${item.key}`}
                label={`Step ${index + 1} title`}
                value={item.title}
                required
              />
              <Field
                name={`step-description-${item.key}`}
                label={`Step ${index + 1} description`}
                value={item.description ?? ""}
                multiline
              />
              <Button
                variant="secondary"
                onClick={() =>
                  setSteps((current) =>
                    current.filter((row) => row.key !== item.key),
                  )
                }
              >
                Remove step {index + 1}
              </Button>
            </fieldset>
          ))}
          <Button
            variant="secondary"
            disabled={steps.length >= 10}
            onClick={() => {
              const key = stepKey.current++;
              setSteps((current) => [
                ...current,
                { key, title: "", description: "" },
              ]);
            }}
          >
            Add starting step
          </Button>
        </section>
        <section
          className="seeker-page__panel"
          aria-labelledby="pathway-preparation-title"
        >
          <h2 id="pathway-preparation-title">Preparation checklist</h2>
          <p>
            Keep references stable when updating an existing item. Saved
            checklists retain their original items and ticks.
          </p>
          {items.map((item, index) => (
            <fieldset className="pathway-management__item" key={item.key}>
              <legend>Checklist item {index + 1}</legend>
              <div className="service-management__fields">
                <Field
                  name={`item-id-${item.key}`}
                  label={`Item ${index + 1} reference`}
                  value={item.id}
                  required
                />
                <Field
                  name={`item-label-${item.key}`}
                  label={`Item ${index + 1} label`}
                  value={item.label}
                  required
                />
                <Field
                  name={`item-note-${item.key}`}
                  label={`Item ${index + 1} note`}
                  value={item.note}
                  required
                  multiline
                />
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  setItems((current) =>
                    current.filter((row) => row.key !== item.key),
                  )
                }
              >
                Remove checklist item {index + 1}
              </Button>
            </fieldset>
          ))}
          <Button
            variant="secondary"
            disabled={items.length >= 15}
            onClick={() => {
              const key = itemKey.current++;
              setItems((current) => [
                ...current,
                { key, id: "", label: "", note: "" },
              ]);
            }}
          >
            Add checklist item
          </Button>
        </section>
        <section
          className="seeker-page__panel"
          aria-labelledby="pathway-sources-title"
        >
          <h2 id="pathway-sources-title">Official sources</h2>
          <div className="service-management__fields">
            <Field
              name="checkedOn"
              label="Source checked on"
              value={pathway?.sourceReview.checkedOn}
              type="date"
              required
              help="Use the actual review date; future dates are not accepted."
            />
            <Field
              name="sources"
              label="Official sources"
              value={pathway?.sourceReview.sources
                .map((source) => `${source.name} | ${source.url}`)
                .join("\n")}
              multiline
              required
              help="One per line: Name | https://official-address. Up to 8 links on judiciary.go.ke, cak.go.ke, nlas.go.ke or their www variants, without queries or fragments."
            />
          </div>
          {record?.publication === "published" && (
            <>
              <p>
                Saving updates the public guide and current preparation template
                immediately.
              </p>
              <ReviewFields />
            </>
          )}
        </section>
        {error && <p role="alert">{error}</p>}
        <div className="seeker-page__actions">
          <Link className="btn btn-secondary" to="/admin/pathways">
            Cancel
          </Link>
          <Button type="submit">
            {disabled
              ? "Save unavailable"
              : record
                ? "Save pathway changes"
                : "Save pathway draft"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

type Modal = {
  type: "view" | "publish" | "archive" | "delete";
  record: PathwayRecord;
};
function PathwayDialog({
  modal,
  disabled,
  busy,
  message,
  close,
  submit,
}: {
  modal: Modal;
  disabled: boolean;
  busy: boolean;
  message: string;
  close: () => void;
  submit: (command: PathwayCommand) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    pathway = modal.record.pathway;
  useEffect(() => {
    const opener = document.activeElement,
      dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (modal.type === "view") return;
    submit(
      modal.type === "delete"
        ? {
            type: "delete",
            id: pathway.id,
            expectedRevision: modal.record.revision,
          }
        : {
            type: "publication",
            id: pathway.id,
            expectedRevision: modal.record.revision,
            publication: modal.type === "publish" ? "published" : "archived",
            reviewed: data.get("reviewed") === "on",
            reviewNote: String(data.get("reviewNote") ?? "").trim(),
          },
    );
  }
  const title = {
    view: "Pathway details",
    publish: "Publish pathway",
    archive: "Archive pathway",
    delete: "Delete pathway draft",
  }[modal.type];
  return (
    <dialog
      className="service-management__modal"
      ref={ref}
      aria-labelledby="pathway-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="service-management__modal-head">
        <h2 id="pathway-dialog-title">
          {title}: {pathway.title}
        </h2>
        <Button variant="secondary" disabled={busy} onClick={close}>
          Close
        </Button>
      </header>
      {message && (disabled || message.startsWith("Check ")) && (
        <p role="alert">{message}</p>
      )}
      {disabled && !busy && (
        <p>
          Close this dialog, reload pathways and inspect the record before
          trying again.
        </p>
      )}
      {modal.type === "view" ? (
        <>
          <p>
            {labels[modal.record.publication]} · Revision{" "}
            {modal.record.revision} · Reference {pathway.id}
          </p>
          <p>
            {pathway.category} · Related service: {pathway.serviceId}
          </p>
          <h3>Overview</h3>
          <p>{pathway.overview}</p>
          <h3>Who may use this pathway</h3>
          <p>{pathway.whoMayUse}</p>
          {(
            [
              ["Matters covered", pathway.matters],
              ["Requirements", pathway.requirements],
              ["What happens next", pathway.nextStages],
            ] as const
          ).map(([title, entries]) => (
            <section key={title}>
              <h3>{title}</h3>
              <ul>
                {entries.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ul>
            </section>
          ))}
          <h3>Starting steps</h3>
          <ol>
            {pathway.startingSteps.map((step, index) => (
              <li key={index}>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
          <h3>Preparation checklist</h3>
          <ul>
            {pathway.preparation.map((item) => (
              <li key={item.id}>
                <strong>{item.label}</strong> ({item.id})<p>{item.note}</p>
              </li>
            ))}
          </ul>
          <h3>Official sources</h3>
          <p>Checked on {pathway.sourceReview.checkedOn}</p>
          <ul>
            {pathway.sourceReview.sources.map((source, index) => (
              <li key={index}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.name}
                </a>
              </li>
            ))}
          </ul>
          <p>
            Review note: {modal.record.reviewNote || "Reviewed baseline entry"}
          </p>
          {modal.record.publication === "published" && (
            <Link className="btn btn-secondary" to={`/pathways/${pathway.id}`}>
              View public pathway
            </Link>
          )}
        </>
      ) : (
        <form onSubmit={confirm}>
          <fieldset disabled={disabled}>
            <legend className="admin-pages__sr-only">
              Confirm pathway action
            </legend>
            <p>
              {modal.type === "delete"
                ? "Permanently delete this unused draft? Its reference will stay reserved. This cannot be undone."
                : modal.type === "archive"
                  ? "Remove this pathway from public browsing and new checklist or referral selection? Saved snapshots remain available."
                  : "Publish this guide and its preparation checklist? Check the linked service and official sources first."}
            </p>
            {modal.type === "publish" && <ReviewFields />}
            <Button
              type="submit"
              variant={modal.type === "delete" ? "danger" : "primary"}
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

// Share confirmed reads and serialized writes across the list and existing editor routes.
export function PathwayManagementView({
  resource,
  mode = "list",
  pathwayId,
}: {
  resource: Resource;
  mode?: Mode;
  pathwayId?: string;
}) {
  const state = useSyncExternalStore(
      resource.subscribe,
      resource.snapshot,
      resource.snapshot,
    ),
    navigate = useNavigate();
  const [modal, setModal] = useState<Modal | null>(null),
    [search, setSearch] = useState(""),
    [publication, setPublication] = useState("all");
  useEffect(() => resource.start(), [resource]);
  const record =
      state.value?.records.find((row) => row.pathway.id === pathwayId) ?? null,
    disabled = state.busy || state.needsReload;
  async function submit(command: PathwayCommand) {
    const confirmed = await resource.change(command);
    if (confirmed) {
      setModal(null);
      if (mode !== "list" && resource.snapshot().status === "ready")
        navigate("/admin/pathways");
    }
  }
  const rows =
    state.value?.records
      .filter(
        (row) =>
          (publication === "all" || row.publication === publication) &&
          `${row.pathway.title} ${row.pathway.id} ${row.pathway.category}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()),
      )
      .sort((a, b) => a.pathway.title.localeCompare(b.pathway.title)) ?? [];
  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>
            {mode === "list"
              ? "Pathway management"
              : mode === "new"
                ? "Create pathway"
                : "Edit pathway"}
          </h1>
          <p>Maintain guidance, requirements and preparation checklists.</p>
        </div>
        <div className="seeker-page__actions">
          <Button
            variant="secondary"
            disabled={state.busy || state.status === "loading"}
            onClick={() => {
              setModal(null);
              void resource.reload();
            }}
          >
            Reload pathways
          </Button>
          {mode === "list" && state.status === "ready" && !disabled && (
            <Link className="btn btn-primary" to="/admin/pathways/new">
              Create pathway
            </Link>
          )}
          {mode !== "list" && (
            <Link className="btn btn-secondary" to="/admin/pathways">
              Back to pathways
            </Link>
          )}
        </div>
      </header>
      <div className="seeker-page__notice">
        <p>
          Drafts are administrator-only. Publishing requires a source review and
          a published related service. Existing assessment links are protected
          from archiving. New guides do not change the assessment category
          mapping.
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
          subject="Pathway information"
          status={state.status}
          retry={
            state.status === "error" ? () => void resource.reload() : undefined
          }
        />
      ) : mode !== "list" ? (
        mode === "edit" && !record ? (
          <section className="seeker-page__state">
            <h2>Pathway not found</h2>
            <p>
              This record may have been deleted. Return to the pathway list.
            </p>
          </section>
        ) : (
          <PathwayForm
            key={`${mode}:${pathwayId ?? "new"}:${record?.revision ?? 0}`}
            record={record}
            services={state.value!.publishedServices}
            disabled={disabled}
            save={(command) => void submit(command)}
          />
        )
      ) : (
        <>
          <form
            className="service-management__filters"
            role="search"
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="pathway-search">
              Search pathways
              <input
                id="pathway-search"
                type="search"
                maxLength={200}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div>
              <label htmlFor="pathway-publication">Publication</label>
              <select
                id="pathway-publication"
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
            </div>
          </form>
          <p role="status">
            {rows.length} pathway{rows.length === 1 ? "" : "s"}
          </p>
          <ul className="service-management__list">
            {rows.map((row) => {
              const protectedEntry = state.value!.protectedPathwayIds.includes(
                  row.pathway.id,
                ),
                activeService = state.value!.publishedServices.some(
                  (service) => service.id === row.pathway.serviceId,
                );
              return (
                <li key={row.pathway.id}>
                  <div>
                    <h2>{row.pathway.title}</h2>
                    <p>
                      {row.pathway.category} · {row.pathway.serviceId}
                    </p>
                    <p>
                      <span className="seeker-page__badge">
                        {labels[row.publication]}
                      </span>{" "}
                      · Revision {row.revision}
                    </p>
                    {protectedEntry && <p>Protected assessment link.</p>}
                    {!activeService && (
                      <p>
                        Select a published related service before publishing
                        this guide.
                      </p>
                    )}
                  </div>
                  <div className="service-management__row-actions">
                    <Button
                      variant="secondary"
                      disabled={state.busy}
                      onClick={() => setModal({ type: "view", record: row })}
                    >
                      View details
                    </Button>
                    {!disabled && (
                      <Link
                        className="btn btn-secondary"
                        to={`/admin/pathways/${row.pathway.id}/edit`}
                      >
                        Edit pathway
                      </Link>
                    )}
                    {row.publication !== "published" && (
                      <Button
                        disabled={disabled || !activeService}
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
                            ? "Used by the assessment mapping."
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
          {!rows.length && <p>No pathways match these filters.</p>}
        </>
      )}
      {modal && state.status === "ready" && (
        <PathwayDialog
          modal={modal}
          disabled={disabled}
          busy={state.busy}
          message={state.message}
          close={() => setModal(null)}
          submit={(command) => void submit(command)}
        />
      )}
    </>
  );
}

function AuthorizedPathways({
  uid,
  mode,
  pathwayId,
}: {
  uid: string;
  mode: Mode;
  pathwayId?: string;
}) {
  const [resource] = useState(
    () =>
      new CatalogManagementResource(
        createPathwayManagementApi({
          baseUrl: backendUrl,
          uid,
          currentUser: () => firebaseAuth().currentUser,
        }),
        12000,
        "pathway",
      ),
  );
  return (
    <PathwayManagementView
      resource={resource}
      mode={mode}
      pathwayId={pathwayId}
    />
  );
}

export function PathwayManagement({
  mode = "list",
  pathwayId,
}: {
  mode?: Mode;
  pathwayId?: string;
}) {
  const { session } = useAuth();
  return session.status === "ready" && session.identity.role === "admin" ? (
    <AuthorizedPathways
      key={`${session.identity.uid}:${mode}:${pathwayId ?? ""}`}
      uid={session.identity.uid}
      mode={mode}
      pathwayId={pathwayId}
    />
  ) : (
    <AdminDataState subject="Pathway information" status="forbidden" />
  );
}
