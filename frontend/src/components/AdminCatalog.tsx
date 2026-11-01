import { useState } from "react";
import { Building2, Clock, Plus, Search, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { AdminDataState } from "./AdminDataState";
import { AdminServiceEditor } from "./AdminServiceEditor";
import { Button } from "./ui/Button";
import {
  formatAdminDate,
  isAdminSourceUrl,
  publicationLabels,
  validAdminCatalog,
  verificationLabels,
} from "../types/adminData";
import type {
  AdminCatalogRecord,
  AdminData,
  AdminServiceRecord,
} from "../types/adminData";

const pageSize = 10;

// Filter and page only supplied records; management edits remain local previews.
export function AdminCatalog({
  kind,
  data = { status: "unavailable" },
}: {
  kind: "service" | "pathway";
  data?: AdminData<readonly AdminCatalogRecord[]>;
}) {
  const [query, setQuery] = useState("");
  const [publication, setPublication] = useState("all");
  const [category, setCategory] = useState("all");
  const [verification, setVerification] = useState("all");
  const [sort, setSort] = useState("default");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{
    record: AdminServiceRecord | null;
  } | null>(null);
  const services = kind === "service";
  const records =
    data.status === "ready" && validAdminCatalog(data.value, kind)
      ? data.value
      : null;
  const categories = records
    ? [...new Set(records.map((record) => record.category))].sort((a, b) =>
        a.localeCompare(b),
      )
    : [];
  const needle = query.trim().toLocaleLowerCase();
  const filtered =
    records?.filter(
      (record) =>
        (!needle ||
          `${record.title} ${record.category} ${record.kind === "service" ? (record.location ?? "") : ""}`
            .toLocaleLowerCase()
            .includes(needle)) &&
        (publication === "all" || record.publication === publication) &&
        (category === "all" || record.category === category) &&
        (verification === "all" || record.verification === verification),
    ) ?? [];
  const ordered = [...filtered].sort((a, b) => {
    if (sort === "default") return a.title.localeCompare(b.title);
    if (!a.verifiedOn) return b.verifiedOn ? 1 : a.title.localeCompare(b.title);
    if (!b.verifiedOn) return -1;
    return sort === "newest"
      ? b.verifiedOn.localeCompare(a.verifiedOn)
      : a.verifiedOn.localeCompare(b.verifiedOn);
  });
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = ordered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const title = services ? "Justice services" : "Pathway management";
  const prefix = services ? "admin-services" : "admin-pathways";

  // Apply local filters from the first page without sending searches to a server.
  function changeFilter(setValue: (value: string) => void, value: string) {
    setValue(value);
    setPage(1);
  }

  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>{title}</h1>
          <p>
            {services
              ? "Manage justice-service information, verification records and public access details."
              : "Maintain pathway information, eligibility and official sources."}
          </p>
        </div>
        {services ? (
          <Button
            icon={Plus}
            disabled={data.status === "forbidden"}
            onClick={() => setEditor({ record: null })}
          >
            Add service
          </Button>
        ) : (
          <Button
            icon={Plus}
            disabled
            title="Pathway creation is currently unavailable."
          >
            Create pathway
          </Button>
        )}
      </header>

      {services && (
        <section
          className="admin-pages__summary"
          aria-label="Service information summary"
        >
          {[
            {
              label: "verified",
              value: records?.filter((item) => item.verification === "verified")
                .length,
              icon: ShieldCheck,
            },
            {
              label: "need review",
              value: records?.filter((item) => item.verification !== "verified")
                .length,
              icon: Clock,
            },
            {
              label: "published services",
              value: records?.filter((item) => item.publication === "published")
                .length,
              icon: Building2,
            },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label}>
              <Icon size={20} aria-hidden="true" />
              <span>
                <strong>{value ?? "Unavailable"}</strong> {label}
              </span>
            </div>
          ))}
          <button
            type="button"
            disabled={data.status === "forbidden"}
            onClick={() => setEditor({ record: null })}
          >
            Manage justice-service information
          </button>
        </section>
      )}

      <form
        className="admin-pages__toolbar"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="admin-pages__search" htmlFor={`${prefix}-search`}>
          <Search size={18} aria-hidden="true" />
          <span className="admin-pages__sr-only">
            Search {services ? "services" : "pathways"}
          </span>
          <input
            id={`${prefix}-search`}
            type="search"
            value={query}
            maxLength={200}
            autoComplete="off"
            placeholder={`Search ${services ? "services" : "pathways"}…`}
            onChange={(event) => changeFilter(setQuery, event.target.value)}
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={publication}
            onChange={(event) =>
              changeFilter(setPublication, event.target.value)
            }
          >
            <option value="all">All statuses</option>
            {Object.entries(publicationLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Category</span>
          <select
            value={category}
            onChange={(event) => changeFilter(setCategory, event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Verification</span>
          <select
            value={verification}
            onChange={(event) =>
              changeFilter(setVerification, event.target.value)
            }
          >
            <option value="all">All verification states</option>
            {Object.entries(verificationLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Last verified</span>
          <select
            value={sort}
            onChange={(event) => changeFilter(setSort, event.target.value)}
          >
            <option value="default">Last verified</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </form>

      <div
        className="admin-pages__table-wrap"
        role="region"
        aria-label={`${title} table`}
        tabIndex={0}
      >
        <table className="admin-pages__table">
          <caption className="admin-pages__sr-only">{title}</caption>
          <thead>
            <tr>
              {(services
                ? [
                    "Organisation",
                    "Category",
                    "Location",
                    "Verification",
                    "Last verified",
                    "Actions",
                  ]
                : [
                    "Pathway",
                    "Category",
                    "Related services",
                    "Status",
                    "Last verified",
                    "Actions",
                  ]
              ).map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records ? (
              visible.length ? (
                visible.map((record) => (
                  <tr key={record.id}>
                    <th scope="row">
                      {record.title}
                      <small>{publicationLabels[record.publication]}</small>
                    </th>
                    <td>{record.category}</td>
                    <td>
                      {record.kind === "service"
                        ? record.location || "Not published"
                        : (record.relatedServices ?? "Not published")}
                    </td>
                    <td>
                      <span className="seeker-page__badge">
                        {verificationLabels[record.verification]}
                      </span>
                    </td>
                    <td>
                      {formatAdminDate(record.verifiedOn) || "Not verified"}
                      {isAdminSourceUrl(record.sourceUrl) && (
                        <a
                          className="admin-pages__source"
                          href={record.sourceUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Official source
                        </a>
                      )}
                    </td>
                    <td>
                      <div className="admin-pages__row-actions">
                        {record.kind === "service" ? (
                          <Button
                            variant="ghost"
                            onClick={() => setEditor({ record })}
                          >
                            Edit
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            disabled
                            title="Pathway editing is currently unavailable."
                          >
                            View
                          </Button>
                        )}
                        {record.verification !== "verified" && (
                          <Button
                            variant="ghost"
                            disabled
                            title="Source verification is currently unavailable."
                          >
                            Verify
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          disabled
                          title="Archiving is currently unavailable."
                        >
                          Archive
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="seeker-page__state">
                      <h2>
                        {records.length
                          ? "No records match these filters."
                          : services
                            ? "No services to display."
                            : "No pathways to display."}
                      </h2>
                      <p>
                        {records.length
                          ? "Change the search or filters to see other records."
                          : "No administrative records were returned."}
                      </p>
                    </div>
                  </td>
                </tr>
              )
            ) : (
              <tr>
                <td colSpan={6}>
                  <AdminDataState
                    subject={
                      services ? "Service information" : "Pathway information"
                    }
                    status={data.status === "ready" ? "error" : data.status}
                    retry={data.status === "error" ? data.retry : undefined}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {records && (
        <div className="admin-pages__pagination">
          <span role="status">
            {ordered.length
              ? `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, ordered.length)} of ${ordered.length}`
              : "0 results"}
          </span>
          <div>
            <Button
              variant="secondary"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </Button>
            <span>
              Page {currentPage} of {pageCount}
            </span>
            <Button
              variant="secondary"
              disabled={currentPage === pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      {services && (
        <Link className="admin-pages__related-link" to="/admin/pathways">
          View pathway management →
        </Link>
      )}
      {editor && data.status !== "forbidden" && (
        <AdminServiceEditor
          record={editor.record}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
