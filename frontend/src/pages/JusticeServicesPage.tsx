import { useRef } from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  Building2,
  Clock3,
  LoaderCircle,
  MapPin,
  Monitor,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Button } from "../components/ui/Button";
import "./JusticeServicesPage.css";

// This view model will be populated with reviewed, published backend records.
export type DirectoryService = {
  id: string;
  name: string;
  serviceType: string;
  location: string;
  description: string;
  eligibility: string | null;
  accessMethods: readonly string[];
  deliveryModes: readonly string[];
  sourceReview: { checkedOn: string } | null;
};

export type DirectoryData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; services: readonly DirectoryService[] };

type FilterKey = "type" | "location" | "eligibility" | "access" | "delivery";

const filterKeys: readonly FilterKey[] = [
  "type",
  "location",
  "eligibility",
  "access",
  "delivery",
];
const unavailableData: DirectoryData = { status: "unavailable" };

// Derive filter choices from loaded records instead of inventing service coverage.
function uniqueValues(values: readonly string[]) {
  return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
}

// Keep the directory usable before integration without presenting missing data as zero results.
export function JusticeServicesPage({
  directory = unavailableData,
}: {
  directory?: DirectoryData;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const resultsRef = useRef<HTMLDivElement>(null);
  const ready = directory.status === "ready";
  const services = directory.status === "ready" ? directory.services : [];
  const query = searchParams.get("q") ?? "";
  const sort =
    searchParams.get("sort") === "name-desc" ? "name-desc" : "name-asc";
  const hasFilters =
    Boolean(query) ||
    sort === "name-desc" ||
    filterKeys.some((key) => Boolean(searchParams.get(key)));

  const filters = [
    {
      key: "type",
      label: "Service type",
      values: uniqueValues(services.map((s) => s.serviceType)),
    },
    {
      key: "location",
      label: "Location",
      values: uniqueValues(services.map((s) => s.location)),
    },
    {
      key: "eligibility",
      label: "Eligibility",
      values: uniqueValues(services.map((s) => s.eligibility ?? "")),
    },
    {
      key: "access",
      label: "Access method",
      values: uniqueValues(services.flatMap((s) => [...s.accessMethods])),
    },
    {
      key: "delivery",
      label: "Remote / In-person",
      values: uniqueValues(services.flatMap((s) => [...s.deliveryModes])),
    },
  ] as const;

  const needle = query.trim().toLocaleLowerCase("en");
  const visibleServices = services
    .filter((service) => {
      const searchable = [
        service.name,
        service.description,
        service.serviceType,
        service.location,
      ]
        .join(" ")
        .toLocaleLowerCase("en");
      return (
        searchable.includes(needle) &&
        filterKeys.every((key) => {
          const selected = searchParams.get(key);
          if (!selected) return true;
          switch (key) {
            case "type":
              return service.serviceType === selected;
            case "location":
              return service.location === selected;
            case "eligibility":
              return service.eligibility === selected;
            case "access":
              return service.accessMethods.includes(selected);
            case "delivery":
              return service.deliveryModes.includes(selected);
          }
        })
      );
    })
    .sort((a, b) => {
      const order =
        a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");
      return sort === "name-desc" ? -order : order;
    });

  // Store public directory filters in the URL so reloads and shared links preserve them.
  function updateParam(key: string, value: string, replace = false) {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace });
  }

  function clearFilters() {
    const next = new URLSearchParams(searchParams);
    for (const key of ["q", "sort", ...filterKeys]) next.delete(key);
    setSearchParams(next);
  }

  // Filtering is live; submitting moves keyboard focus to the result summary.
  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resultsRef.current?.focus();
  }

  return (
    <div className="justice-directory">
      <header className="justice-directory__heading">
        <span>Justice services</span>
        <h1>Find a justice service</h1>
        <p>
          Search verified services by the help you need, your location or how
          you want to access support.
        </p>
      </header>

      <form
        className="justice-directory__search"
        role="search"
        onSubmit={handleSearch}
      >
        <Search size={20} aria-hidden="true" />
        <label
          className="justice-directory__sr-only"
          htmlFor="directory-search"
        >
          Search services, organisations or locations
        </label>
        <input
          id="directory-search"
          name="q"
          type="search"
          placeholder="Search services, organisations or locations…"
          value={query}
          onChange={(event) => updateParam("q", event.target.value, true)}
          aria-controls="directory-results"
        />
        <Button type="submit">Search</Button>
      </form>

      <div
        className="justice-directory__filters"
        role="group"
        aria-label="Filter justice services"
      >
        {filters.map((filter) => {
          const selected = searchParams.get(filter.key) ?? "";
          return (
            <label className="justice-directory__filter" key={filter.key}>
              <span className="justice-directory__sr-only">{filter.label}</span>
              <select
                value={selected}
                disabled={!ready || filter.values.length === 0}
                onChange={(event) =>
                  updateParam(filter.key, event.target.value)
                }
                aria-controls="directory-results"
              >
                <option value="">{filter.label}</option>
                {selected && !filter.values.includes(selected) && (
                  <option value={selected}>{selected}</option>
                )}
                {filter.values.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <Button
          variant="ghost"
          className="justice-directory__clear"
          onClick={clearFilters}
          disabled={!hasFilters}
          aria-label="Clear filters"
          title="Clear filters"
        >
          <RotateCcw size={18} aria-hidden="true" />
        </Button>
      </div>

      <div className="justice-directory__layout">
        <section
          id="directory-results"
          aria-label="Service results"
          aria-busy={directory.status === "loading"}
        >
          <div
            className="justice-directory__summary"
            ref={resultsRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
          >
            {ready ? (
              <strong>
                {visibleServices.length}{" "}
                {visibleServices.length === 1 ? "service" : "services"}
              </strong>
            ) : (
              <strong>Service results</strong>
            )}
            {ready && (
              <label className="justice-directory__sort">
                <span className="justice-directory__sr-only">
                  Sort services
                </span>
                <select
                  value={sort}
                  onChange={(event) => updateParam("sort", event.target.value)}
                >
                  <option value="name-asc">Name (A–Z)</option>
                  <option value="name-desc">Name (Z–A)</option>
                </select>
              </label>
            )}
          </div>

          {directory.status === "unavailable" && (
            <div className="justice-directory__state" role="status">
              <Building2 size={30} aria-hidden="true" />
              <h2>Service information is currently unavailable.</h2>
              <p>Please check again later.</p>
            </div>
          )}

          {directory.status === "loading" && (
            <div className="justice-directory__state" role="status">
              <LoaderCircle
                className="justice-directory__spinner"
                size={30}
                aria-hidden="true"
              />
              <h2>Loading services…</h2>
            </div>
          )}

          {directory.status === "error" && (
            <div className="justice-directory__state" role="alert">
              <AlertCircle size={30} aria-hidden="true" />
              <h2>Services could not be loaded.</h2>
              <p>Please try again.</p>
              <Button variant="secondary" onClick={directory.retry}>
                Try again
              </Button>
            </div>
          )}

          {ready && visibleServices.length === 0 && (
            <div className="justice-directory__state" role="status">
              <Search size={30} aria-hidden="true" />
              <h2>
                {services.length
                  ? "No services match your search."
                  : "No services are currently listed."}
              </h2>
              {services.length > 0 && (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          )}

          {ready && visibleServices.length > 0 && (
            <ul className="justice-directory__list" role="list">
              {visibleServices.map((service) => (
                <li key={service.id}>
                  <article className="justice-directory__card">
                    <div className="justice-directory__logo">
                      <Building2 size={24} aria-hidden="true" />
                    </div>
                    <div className="justice-directory__details">
                      <div className="justice-directory__badges">
                        {service.sourceReview && (
                          <span className="justice-directory__verified">
                            <ShieldCheck size={14} aria-hidden="true" />
                            Verified source
                          </span>
                        )}
                        <span>{service.serviceType}</span>
                      </div>
                      <h2>{service.name}</h2>
                      <span className="justice-directory__location">
                        <MapPin size={15} aria-hidden="true" />
                        {service.location}
                      </span>
                      <p>{service.description}</p>
                      <div className="justice-directory__meta">
                        <span>
                          <Users size={14} aria-hidden="true" />
                          {service.eligibility ??
                            "Confirm eligibility with service"}
                        </span>
                        {service.deliveryModes.length > 0 && (
                          <span>
                            <Monitor size={14} aria-hidden="true" />
                            {service.deliveryModes.join(" / ")}
                          </span>
                        )}
                        {service.sourceReview && (
                          <span>
                            <Clock3 size={14} aria-hidden="true" />
                            Verified {service.sourceReview.checkedOn}
                          </span>
                        )}
                      </div>
                    </div>
                    <Link
                      className="btn btn-secondary"
                      to={`/services/${encodeURIComponent(service.id)}`}
                    >
                      View service
                    </Link>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="justice-directory__map" aria-label="Service map">
          <div className="justice-directory__map-surface">
            <MapPin size={32} aria-hidden="true" />
          </div>
          <h2>Map unavailable</h2>
          <p>Location information is not available.</p>
        </aside>
      </div>
    </div>
  );
}
