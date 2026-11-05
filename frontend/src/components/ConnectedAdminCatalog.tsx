import { useState } from "react";
import {
  BookOpen,
  Building2,
  Info,
  Route as RouteIcon,
  Search,
} from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../auth/useAuth";
import { useAdminCatalog } from "../admin/useAdminCatalog";
import { filterCatalog } from "../admin/catalogFilter";
import type { CatalogRow } from "../admin/catalogFilter";
import type {
  AdminKind,
  AdminOverview,
  AdminServices,
  AdminPathways,
  AdminValue,
} from "../admin/adminApi";
import type { AdminState } from "../admin/AdminResource";
import { AdminDataState } from "./AdminDataState";
import { formatAdminDate } from "../types/adminData";
import { Button } from "./ui/Button";
import "../pages/AdminCatalogConnected.css";

const pageSize = 10;
const titles = {
  overview: "Platform overview",
  services: "Justice services",
  pathways: "Pathway management",
};

function CatalogueOverview({ value }: { value: AdminOverview }) {
  const totals = [
    { label: "Published services", count: value.services, Icon: Building2 },
    { label: "Published pathways", count: value.pathways, Icon: RouteIcon },
    { label: "Published resources", count: value.resources, Icon: BookOpen },
  ];
  return (
    <>
      <section
        className="seeker-dashboard__stats"
        aria-label="Published catalogue totals"
      >
        {totals.map(({ label, count, Icon }) => (
          <article key={label}>
            <Icon size={22} aria-hidden="true" />
            <div>
              <h2>{label}</h2>
              <strong>{count}</strong>
            </div>
          </article>
        ))}
      </section>
      <div className="admin-pages__charts">
        <section className="seeker-page__panel">
          <h2>Justice services</h2>
          <p>
            Service and resource catalogue checked on{" "}
            {formatAdminDate(value.catalogCheckedOn)}.
          </p>
          <Link className="btn btn-secondary" to="/admin/services">
            View services
          </Link>
        </section>
        <section className="seeker-page__panel">
          <h2>Pathways</h2>
          <p>
            Pathway catalogue checked on{" "}
            {formatAdminDate(value.pathwaysCheckedOn)}.
          </p>
          <Link className="btn btn-secondary" to="/admin/pathways">
            View pathways
          </Link>
        </section>
      </div>
      <section className="seeker-page__panel">
        <h2>Account and referral analytics</h2>
        <p>
          Platform-wide user counts, assessment statistics and referral activity
          are currently unavailable.
        </p>
        <Link to="/admin/verification">Content verification</Link>
      </section>
    </>
  );
}

function catalogueRows(value: AdminServices | AdminPathways): CatalogRow[] {
  if (value.kind === "services") {
    return value.services.map((item) => ({
      id: item.id,
      title: item.name,
      category: item.serviceType,
      location: item.location,
      checkedOn: item.sourceReview.checkedOn,
      sources: item.sourceReview.sources,
      publicPath: `/services/${item.id}`,
      serviceId: null,
    }));
  }
  return value.pathways.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    location: null,
    checkedOn: item.sourceReview.checkedOn,
    sources: item.sourceReview.sources,
    publicPath: `/pathways/${item.id}`,
    serviceId: item.serviceId,
  }));
}

function CatalogueTable({ value }: { value: AdminServices | AdminPathways }) {
  const { kind, checkedOn } = value;
  const rows = catalogueRows(value);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("title");
  const [page, setPage] = useState(1);
  const categories = [...new Set(rows.map((row) => row.category))].sort();
  const view = filterCatalog(rows, search, category, sort, page, pageSize);
  const columns = [
    "Name",
    "Category",
    kind === "services" ? "Location" : "Related service",
    "Source checked",
    "Sources",
    "Public page",
  ];

  function changeFilter(setValue: (value: string) => void, value: string) {
    setValue(value);
    setPage(1);
  }

  return (
    <>
      <p>
        Published catalogue checked on {formatAdminDate(checkedOn)}. Each source
        date records when the project reviewed that source.
      </p>
      <form
        className="admin-pages__toolbar admin-catalog-connected__filters"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="admin-pages__search" htmlFor="admin-catalog-search">
          <Search size={18} aria-hidden="true" />
          <span className="admin-pages__sr-only">Search published {kind}</span>
          <input
            id="admin-catalog-search"
            type="search"
            maxLength={200}
            autoComplete="off"
            placeholder={`Search ${kind}…`}
            value={search}
            onChange={(event) => changeFilter(setSearch, event.target.value)}
          />
        </label>
        <label>
          <span>Category</span>
          <select
            value={category}
            onChange={(event) => changeFilter(setCategory, event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(event) => changeFilter(setSort, event.target.value)}
          >
            <option value="title">Name</option>
            <option value="newest">Latest source check</option>
            <option value="oldest">Earliest source check</option>
          </select>
        </label>
      </form>
      <div
        className="admin-pages__table-wrap"
        role="region"
        tabIndex={0}
        aria-label={`Published ${kind} table`}
      >
        <table className="admin-pages__table">
          <caption className="admin-pages__sr-only">Published {kind}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.visible.length ? (
              view.visible.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    {row.title}
                    <small>Published</small>
                  </th>
                  <td>{row.category}</td>
                  <td>
                    {row.serviceId ? (
                      <Link to={`/services/${row.serviceId}`}>
                        View service
                      </Link>
                    ) : (
                      (row.location ?? "Not published")
                    )}
                  </td>
                  <td>{formatAdminDate(row.checkedOn)}</td>
                  <td>
                    <ul className="admin-catalog-connected__sources">
                      {row.sources.map((source, index) => (
                        <li key={`${source.url}:${index}`}>
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {source.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <Link className="btn btn-secondary" to={row.publicPath}>
                      View public page
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length}>
                  <div className="seeker-page__state">
                    <h2>
                      {rows.length
                        ? "No records match these filters."
                        : `No published ${kind} to display.`}
                    </h2>
                    <p>
                      {rows.length
                        ? "Change the search or category to see other records."
                        : "The catalogue returned an empty list."}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-pages__pagination">
        <span role="status">
          {view.total
            ? `Showing ${(view.currentPage - 1) * pageSize + 1}–${Math.min(view.currentPage * pageSize, view.total)} of ${view.total}`
            : "0 results"}
        </span>
        <div>
          <Button
            variant="secondary"
            disabled={view.currentPage === 1}
            onClick={() => setPage(view.currentPage - 1)}
          >
            Previous
          </Button>
          <span>
            Page {view.currentPage} of {view.pageCount}
          </span>
          <Button
            variant="secondary"
            disabled={view.currentPage === view.pageCount}
            onClick={() => setPage(view.currentPage + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}

export function AdminCatalogView({
  kind,
  state,
  refresh,
}: {
  kind: AdminKind;
  state: AdminState<AdminValue>;
  refresh: () => void;
}) {
  const value =
    state.status === "ready" && state.value.kind === kind ? state.value : null;
  const loading = state.status === "loading";
  return (
    <>
      <header className="seeker-page__heading admin-pages__heading">
        <div>
          <span className="seeker-page__eyebrow">Administration</span>
          <h1>{titles[kind]}</h1>
          <p>
            {kind === "overview"
              ? "Review the published source catalogues."
              : `Browse published ${kind}, source checks and public information.`}
          </p>
        </div>
        <Button variant="secondary" disabled={loading} onClick={refresh}>
          {loading ? "Loading…" : "Refresh catalogue"}
        </Button>
      </header>
      <div className="seeker-page__notice">
        <Info size={20} aria-hidden="true" />
        <p>
          Read-only published information. Use the source links and public pages
          to review the catalogue.
        </p>
      </div>
      {value ? (
        value.kind === "overview" ? (
          <CatalogueOverview value={value} />
        ) : (
          <CatalogueTable value={value} />
        )
      ) : (
        <AdminDataState
          subject="Catalogue information"
          status={state.status === "ready" ? "error" : state.status}
          retry={state.status === "error" ? refresh : undefined}
        />
      )}
    </>
  );
}

function AuthorizedCatalog({ uid, kind }: { uid: string; kind: AdminKind }) {
  const { state, refresh } = useAdminCatalog(uid, kind);
  return <AdminCatalogView kind={kind} state={state} refresh={refresh} />;
}

export function ConnectedAdminCatalog({ kind }: { kind: AdminKind }) {
  const { session } = useAuth();
  if (session.status === "ready" && session.identity.role === "admin") {
    return (
      <AuthorizedCatalog
        key={`${session.identity.uid}:${kind}`}
        uid={session.identity.uid}
        kind={kind}
      />
    );
  }
  return (
    <>
      <header className="seeker-page__heading">
        <h1>Administration</h1>
      </header>
      <AdminDataState subject="Catalogue information" status="forbidden" />
    </>
  );
}
