import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  FileText,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { Button } from "../components/ui/Button";
import "./JusticeServicesPage.css";
import "./ResourcesPage.css";

const categories = [
  ["all", "All resources"],
  ["preparation", "Preparing for assistance"],
  ["self-representation", "Self-representation"],
  ["consumer", "Consumer disputes"],
  ["civil", "Civil disputes"],
] as const;

type CategoryKey = (typeof categories)[number][0];
export type ResourceCategory = Exclude<CategoryKey, "all">;

// These fields describe published resource records, not generated explanations.
export type ResourceItem = {
  id: string;
  title: string;
  description: string;
  categories: readonly ResourceCategory[];
  source: {
    name: string;
    url: string;
    checkedOn: string | null;
  };
};

export type ResourceLibraryData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; resources: readonly ResourceItem[] };

const unavailableLibrary: ResourceLibraryData = { status: "unavailable" };

// Only create external links for public HTTPS addresses without embedded credentials.
function sourceLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Filter supplied resources without claiming that disconnected data is an empty library.
export function ResourcesPage({
  library = unavailableLibrary,
}: {
  library?: ResourceLibraryData;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get("category");
  const activeCategory =
    categories.find(([key]) => key === requestedCategory)?.[0] ?? "all";
  const resources = library.status === "ready" ? library.resources : [];
  const visibleResources =
    activeCategory === "all"
      ? resources
      : resources.filter((resource) =>
          resource.categories.includes(activeCategory),
        );

  // Keep category selection available through reloads and browser navigation.
  function selectCategory(category: CategoryKey) {
    const next = new URLSearchParams(searchParams);
    if (category === "all") next.delete("category");
    else next.set("category", category);
    setSearchParams(next);
  }

  return (
    <div className="justice-directory resources-page">
      <header className="justice-directory__heading">
        <span>Resource library</span>
        <h1>Understand your options</h1>
        <p>
          Plain-language justice information, with clear sources and labels.
        </p>
      </header>

      <fieldset className="resources-page__categories">
        <legend className="justice-directory__sr-only">
          Resource categories
        </legend>
        {categories.map(([key, label]) => (
          <label className="resources-page__category" key={key}>
            <input
              className="justice-directory__sr-only"
              type="radio"
              name="resource-category"
              value={key}
              checked={activeCategory === key}
              onChange={() => selectCategory(key)}
              aria-controls="resource-results"
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <section
        id="resource-results"
        aria-label="Resource results"
        aria-busy={library.status === "loading"}
      >
        {library.status === "unavailable" && (
          <div className="justice-directory__state" role="status">
            <BookOpen size={30} aria-hidden="true" />
            <h2>Resource information is currently unavailable.</h2>
            <p>Please check again later.</p>
          </div>
        )}

        {library.status === "loading" && (
          <div className="justice-directory__state" role="status">
            <LoaderCircle
              className="justice-directory__spinner"
              size={30}
              aria-hidden="true"
            />
            <h2>Loading resources…</h2>
          </div>
        )}

        {library.status === "error" && (
          <div className="justice-directory__state" role="alert">
            <AlertCircle size={30} aria-hidden="true" />
            <h2>Resources could not be loaded.</h2>
            <p>Please try again.</p>
            <Button variant="secondary" onClick={library.retry}>
              Try again
            </Button>
          </div>
        )}

        {library.status === "ready" && (
          <>
            <p
              className="resources-page__summary"
              role="status"
              aria-live="polite"
            >
              {visibleResources.length}{" "}
              {visibleResources.length === 1 ? "resource" : "resources"}
            </p>
            {visibleResources.length === 0 ? (
              <div className="justice-directory__state" role="status">
                <BookOpen size={30} aria-hidden="true" />
                <h2>
                  {resources.length
                    ? "No resources match this category."
                    : "No resources are currently listed."}
                </h2>
                {activeCategory !== "all" && (
                  <Button
                    variant="secondary"
                    onClick={() => selectCategory("all")}
                  >
                    All resources
                  </Button>
                )}
              </div>
            ) : (
              <ul className="resources-page__grid" role="list">
                {visibleResources.map((resource) => {
                  const href = sourceLink(resource.source.url);
                  return (
                    <li key={resource.id}>
                      <article className="resources-page__card">
                        <div
                          className="resources-page__visual"
                          aria-hidden="true"
                        >
                          {resource.source.checkedOn ? (
                            <ShieldCheck size={30} />
                          ) : (
                            <FileText size={30} />
                          )}
                        </div>
                        <span className="resources-page__badge">
                          {resource.source.checkedOn
                            ? "Verified information"
                            : "Information"}
                        </span>
                        <h2>{resource.title}</h2>
                        <p>{resource.description}</p>
                        <div className="resources-page__source">
                          <span>Source</span>
                          <strong>{resource.source.name}</strong>
                          {resource.source.checkedOn && (
                            <small>Verified {resource.source.checkedOn}</small>
                          )}
                        </div>
                        {href ? (
                          <a
                            className="resources-page__read-more"
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Read more: ${resource.title} (opens in a new tab)`}
                          >
                            Read more{" "}
                            <ArrowRight size={18} aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="resources-page__source-unavailable">
                            Source link unavailable
                          </span>
                        )}
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
