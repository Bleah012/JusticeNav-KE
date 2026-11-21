import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/useAuth";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { CatalogManagementResource } from "../admin/CatalogManagementResource";
import { createResourceManagementApi } from "../admin/resourceManagementApi";
import type {
  ResourceCommand,
  ResourceList,
  ResourceRecord,
} from "../admin/resourceManagementApi";
import type { ResourceCategory } from "../pages/ResourcesPage";
import { AdminDataState } from "./AdminDataState";
import { Field, ReviewFields } from "./ServiceManagement";
import { Button } from "./ui/Button";
import "../pages/ResourceManagement.css";

const statuses = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};
const categories: Record<ResourceCategory, string> = {
  preparation: "Preparing for assistance",
  "self-representation": "Self-representation",
  consumer: "Consumer disputes",
  civil: "Civil disputes",
  employment: "Employment",
};
type ResourceController = CatalogManagementResource<
  ResourceList,
  ResourceCommand
>;
type Modal =
  | { type: "new" }
  | {
      type: "view" | "edit" | "publish" | "archive" | "delete";
      record: ResourceRecord;
    };

// Edit source-backed resource metadata while keeping publication and revision server-controlled.
function ResourceForm({
  record,
  disabled,
  submit,
}: {
  record: ResourceRecord | null;
  disabled: boolean;
  submit: (command: ResourceCommand) => void;
}) {
  const [error, setError] = useState("");
  const resource = record?.resource;
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const selected = data.getAll("categories") as ResourceCategory[];
    if (!selected.length) {
      setError("Select at least one resource category.");
      return;
    }
    const id = resource?.id ?? text("id");
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
    setError("");
    submit({
      type: "save",
      resource: {
        id,
        title: text("title"),
        description: text("description"),
        categories: selected,
        source: {
          name: text("sourceName"),
          url: text("sourceUrl"),
          checkedOn: text("checkedOn"),
        },
      },
      expectedRevision: record?.revision ?? 0,
      publication: record?.publication ?? "draft",
      reviewed: data.get("reviewed") === "on",
      reviewNote: text("reviewNote"),
    });
  }
  return (
    <form onSubmit={save}>
      <fieldset disabled={disabled}>
        <legend className="admin-pages__sr-only">Resource fields</legend>
        <p>Fields marked * are required. New resources are saved as drafts.</p>
        <div className="service-management__fields">
          {resource ? (
            <p>
              <strong>Resource reference:</strong> {resource.id}
            </p>
          ) : (
            <Field
              name="id"
              label="Resource reference"
              required
              help="A stable reference such as development-resource. It cannot be renamed or reused after deletion."
            />
          )}
          <Field
            name="title"
            label="Resource title"
            value={resource?.title}
            required
          />
          <Field
            name="description"
            label="Description"
            value={resource?.description}
            required
            multiline
            maxLength={2000}
            help="A short description of the published information, up to 2,000 characters."
          />
        </div>
        <fieldset className="resource-management__categories">
          <legend>Categories *</legend>
          {Object.entries(categories).map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                name="categories"
                value={value}
                defaultChecked={resource?.categories.includes(
                  value as ResourceCategory,
                )}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <h3>Official source</h3>
        <div className="service-management__fields">
          <Field
            name="sourceName"
            label="Source name"
            value={resource?.source.name}
            required
          />
          <Field
            name="sourceUrl"
            label="Official source URL"
            value={resource?.source.url}
            type="url"
            required
            maxLength={2048}
            help="HTTPS links on judiciary.go.ke, cak.go.ke, nlas.go.ke and their www variants. Do not include query strings or fragments."
          />
          <Field
            name="checkedOn"
            label="Source checked on"
            value={resource?.source.checkedOn ?? ""}
            type="date"
            required
            help="Enter the actual review date. Dates use the Kenya calendar day; future dates are not accepted."
          />
        </div>
        {record?.publication === "published" && (
          <>
            <p>
              Saving these changes updates the public resource library
              immediately.
            </p>
            <ReviewFields />
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <Button type="submit">
          {disabled
            ? "Save unavailable"
            : record
              ? "Save resource changes"
              : "Save resource draft"}
        </Button>
      </fieldset>
    </form>
  );
}

function ResourceDialog({
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
  submit: (command: ResourceCommand) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const record = modal.type === "new" ? null : modal.record;
  const resource = record?.resource;
  const title =
    modal.type === "new"
      ? "Add resource"
      : `${{ view: "Resource details", edit: "Edit resource", publish: "Publish resource", archive: "Archive resource", delete: "Delete resource draft" }[modal.type]}: ${resource!.title}`;
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
    if (modal.type === "new" || modal.type === "view" || modal.type === "edit")
      return;
    const data = new FormData(event.currentTarget),
      row = modal.record;
    submit(
      modal.type === "delete"
        ? {
            type: "delete",
            id: row.resource.id,
            expectedRevision: row.revision,
          }
        : {
            type: "publication",
            id: row.resource.id,
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
      aria-labelledby="resource-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="service-management__modal-head">
        <h2 id="resource-dialog-title">{title}</h2>
        <Button variant="secondary" disabled={busy} onClick={close}>
          Close
        </Button>
      </header>
      {message && (disabled || message.startsWith("Check ")) && (
        <p role="alert">{message}</p>
      )}
      {disabled && !busy && (
        <p>
          Close this dialog, reload resources and inspect the saved record
          before trying again.
        </p>
      )}
      {modal.type === "new" || modal.type === "edit" ? (
        <ResourceForm record={record} disabled={disabled} submit={submit} />
      ) : modal.type === "view" ? (
        <div>
          <p>
            {statuses[record!.publication]} · Revision {record!.revision}
          </p>
          <dl className="service-management__details">
            {[
              ["Reference", resource!.id],
              ["Title", resource!.title],
              ["Description", resource!.description],
              [
                "Categories",
                resource!.categories
                  .map((value) => categories[value])
                  .join(", "),
              ],
              ["Source checked", resource!.source.checkedOn],
              ["Review note", record!.reviewNote || "Reviewed baseline entry"],
              [
                "Last changed",
                record!.updatedAt
                  ? new Date(record!.updatedAt).toLocaleString("en-KE", {
                      timeZone: "Africa/Nairobi",
                    })
                  : "Reviewed baseline entry",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>Official source</h3>
          <a
            href={resource!.source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {resource!.source.name}
          </a>
        </div>
      ) : (
        <form onSubmit={confirm}>
          <fieldset disabled={disabled}>
            <legend className="admin-pages__sr-only">
              Confirm resource action
            </legend>
            <p>
              {modal.type === "delete"
                ? "Permanently delete this unused draft? Its reference will remain reserved. This cannot be undone."
                : modal.type === "archive"
                  ? "Remove this resource from the public library? It will remain available to administrators and can be republished after review."
                  : "Publish this resource in the public library? Review its description, categories and official source before confirming."}
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

// Display only confirmed account-bound reads, with serialized mutations and safe retry rules.
export function ResourceManagementView({
  resource,
}: {
  resource: ResourceController;
}) {
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  const [modal, setModal] = useState<Modal | null>(null),
    [search, setSearch] = useState(""),
    [publication, setPublication] = useState("all"),
    [category, setCategory] = useState("all"),
    [page, setPage] = useState(1);
  useEffect(() => resource.start(), [resource]);
  const disabled = state.busy || state.needsReload;
  const needle = search.trim().toLocaleLowerCase();
  const rows =
    state.value?.records
      .filter(
        (row) =>
          (publication === "all" || row.publication === publication) &&
          (category === "all" ||
            row.resource.categories.includes(category as ResourceCategory)) &&
          `${row.resource.id} ${row.resource.title} ${row.resource.description} ${row.resource.source.name}`
            .toLocaleLowerCase()
            .includes(needle),
      )
      .sort((a, b) => a.resource.title.localeCompare(b.resource.title)) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 10)),
    currentPage = Math.min(page, pages);
  async function submit(command: ResourceCommand) {
    if (await resource.change(command)) setModal(null);
  }
  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>Resource management</h1>
          <p>
            Maintain official-source links and descriptions for the public
            library.
          </p>
        </div>
        <div className="seeker-page__actions">
          <Link className="btn btn-secondary" to="/resources">
            View public library
          </Link>
          <Button
            variant="secondary"
            disabled={state.busy || state.status === "loading"}
            onClick={() => {
              setModal(null);
              void resource.reload();
            }}
          >
            Reload resources
          </Button>
          <Button
            disabled={disabled || state.status !== "ready"}
            onClick={() => setModal({ type: "new" })}
          >
            Add resource
          </Button>
        </div>
      </header>
      <div className="seeker-page__notice">
        <p>
          Drafts are administrator-only. Publishing and editing published
          resources require a source review. Archive published entries or
          permanently delete unused drafts.
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
          subject="Resource information"
          status={state.status}
          retry={
            state.status === "error" ? () => void resource.reload() : undefined
          }
        />
      ) : (
        <>
          <form
            className="resource-management__filters"
            role="search"
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="resource-search">
              Search resources
              <input
                id="resource-search"
                type="search"
                value={search}
                maxLength={200}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <div>
              <label htmlFor="resource-status">Publication</label>
              <select
                id="resource-status"
                value={publication}
                onChange={(event) => {
                  setPublication(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="resource-category">Category</label>
              <select
                id="resource-category"
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All categories</option>
                {Object.entries(categories).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </form>
          <p role="status">
            {rows.length} resource{rows.length === 1 ? "" : "s"}
          </p>
          <ul className="service-management__list">
            {rows.slice((currentPage - 1) * 10, currentPage * 10).map((row) => (
              <li key={row.resource.id}>
                <div>
                  <h2>{row.resource.title}</h2>
                  <p>
                    {row.resource.categories
                      .map((value) => categories[value])
                      .join(" · ")}
                  </p>
                  <p>
                    <span className="seeker-page__badge">
                      {statuses[row.publication]}
                    </span>{" "}
                    · Revision {row.revision}
                  </p>
                  <p>Source: {row.resource.source.name}</p>
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
                    Edit resource
                  </Button>
                  {row.publication !== "published" && (
                    <Button
                      disabled={disabled}
                      onClick={() => setModal({ type: "publish", record: row })}
                    >
                      {row.publication === "archived" ? "Republish" : "Publish"}
                    </Button>
                  )}
                  {row.publication === "published" && (
                    <Button
                      variant="secondary"
                      disabled={disabled}
                      onClick={() => setModal({ type: "archive", record: row })}
                    >
                      Archive
                    </Button>
                  )}
                  {!row.everPublished && (
                    <Button
                      variant="danger"
                      disabled={disabled}
                      onClick={() => setModal({ type: "delete", record: row })}
                    >
                      Delete draft
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!rows.length && <p>No resources match these filters.</p>}
          {pages > 1 && (
            <nav
              className="service-management__row-actions"
              aria-label="Resource pages"
            >
              <Button
                variant="secondary"
                disabled={currentPage === 1 || state.busy}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span>
                Page {currentPage} of {pages}
              </span>
              <Button
                variant="secondary"
                disabled={currentPage === pages || state.busy}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
      {modal && state.status === "ready" && (
        <ResourceDialog
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

function AuthorizedResources({ uid }: { uid: string }) {
  const [resource] = useState(
    () =>
      new CatalogManagementResource(
        createResourceManagementApi({
          baseUrl: backendUrl,
          uid,
          currentUser: () => firebaseAuth().currentUser,
        }),
        12000,
        "resource",
      ),
  );
  return <ResourceManagementView resource={resource} />;
}
export function ResourceManagement() {
  const { session } = useAuth();
  return session.status === "ready" && session.identity.role === "admin" ? (
    <AuthorizedResources
      key={session.identity.uid}
      uid={session.identity.uid}
    />
  ) : (
    <AdminDataState subject="Resource information" status="forbidden" />
  );
}
