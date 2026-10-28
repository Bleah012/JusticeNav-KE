import {
  AlertCircle,
  Building2,
  Check,
  ExternalLink,
  Info,
  LoaderCircle,
  Route as RouteIcon,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { Button } from "../components/ui/Button";
import "./AssessmentResultsPage.css";

// Only supplied assessment results may populate the recommendation template.
export type PathwayRecommendation = {
  id: string;
  title: string;
  category: string;
  explanation: string | null;
  reasons: readonly string[];
  informationNeeded: readonly string[];
  source: { name: string; url: string } | null;
};

export type AssessmentResultsData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  | { status: "ready"; pathways: readonly PathwayRecommendation[] };

const unavailableResults: AssessmentResultsData = { status: "unavailable" };
const notices = {
  unavailable:
    "No saved assessment or pathway results are loaded. Assessment processing and saving are currently unavailable.",
  loading:
    "Assessment results are being loaded. Saving is currently unavailable.",
  error:
    "Assessment results could not be loaded. Saving is currently unavailable.",
  ready:
    "Saving is currently unavailable. These results are navigation information, not legal advice.",
};

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

// Render supplied results without inferring matches from URL parameters or sample data.
export function AssessmentResultsPage({
  results = unavailableResults,
  onViewPathway,
}: {
  results?: AssessmentResultsData;
  onViewPathway?: (pathwayId: string) => void;
}) {
  const pathways = results.status === "ready" ? results.pathways : [];
  const hasResults = results.status === "ready" && pathways.length > 0;

  return (
    <AssessmentLayout step={3}>
      <div className="assessment-entry__title assessment-results__title">
        <span className="assessment-entry__badge">
          <Sparkles size={14} aria-hidden="true" />
          Navigation result
        </span>
        <h1>Potentially relevant pathways</h1>
        {hasResults && (
          <p>
            Based on the information you provided, these pathways may be
            relevant.
          </p>
        )}
      </div>

      <div
        className="assessment-entry__prototype"
        id="assessment-prototype-note"
        role="note"
      >
        <Info size={18} aria-hidden="true" />
        <p>{notices[results.status]}</p>
      </div>

      <section
        className="assessment-results"
        aria-label="Pathway results"
        aria-busy={results.status === "loading"}
      >
        {results.status === "unavailable" && (
          <div className="assessment-results__state" role="status">
            <RouteIcon size={30} aria-hidden="true" />
            <h2>Pathway results are currently unavailable.</h2>
            <p>Please check again later.</p>
          </div>
        )}

        {results.status === "loading" && (
          <div className="assessment-results__state" role="status">
            <LoaderCircle
              className="assessment-results__spinner"
              size={30}
              aria-hidden="true"
            />
            <h2>Loading pathway results.</h2>
            <p>Please wait.</p>
          </div>
        )}

        {results.status === "error" && (
          <div className="assessment-results__state" role="alert">
            <AlertCircle size={30} aria-hidden="true" />
            <h2>We could not load your pathway results.</h2>
            <p>No results are being displayed.</p>
            {results.retry && (
              <Button variant="secondary" onClick={results.retry}>
                Try again
              </Button>
            )}
          </div>
        )}

        {results.status === "ready" && pathways.length === 0 && (
          <div className="assessment-results__state" role="status">
            <RouteIcon size={30} aria-hidden="true" />
            <h2>No pathways to display.</h2>
            <p>
              This assessment has no pathway results to display. This does not
              determine your legal eligibility or mean that no help is
              available.
            </p>
          </div>
        )}

        {hasResults && (
          <div className="assessment-results__list">
            {pathways.map((pathway, index) => {
              const officialSource = pathway.source
                ? sourceLink(pathway.source.url)
                : null;

              return (
                <article className="assessment-results__card" key={pathway.id}>
                  <div className="assessment-results__main">
                    <span className="assessment-entry__badge">
                      {index === 0
                        ? "Potentially relevant pathway"
                        : "Another option"}
                    </span>
                    <div className="assessment-results__name">
                      <Building2 size={28} aria-hidden="true" />
                      <div>
                        <h2>{pathway.title}</h2>
                        <p>{pathway.category}</p>
                      </div>
                    </div>

                    {pathway.explanation && (
                      <div className="assessment-results__explanation">
                        <h3>Why this may be relevant</h3>
                        <p>{pathway.explanation}</p>
                      </div>
                    )}

                    <p className="assessment-results__notice">
                      This is navigation information, not legal advice.
                      Eligibility and jurisdiction should be confirmed using the
                      official source.
                    </p>

                    <div className="assessment-results__source">
                      {officialSource && pathway.source ? (
                        <a
                          href={officialSource}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {pathway.source.name}
                          <ExternalLink size={14} aria-hidden="true" />
                        </a>
                      ) : (
                        <span>Official source link unavailable.</span>
                      )}
                    </div>

                    <div className="assessment-results__buttons">
                      <Button
                        disabled={!onViewPathway}
                        title={
                          onViewPathway
                            ? undefined
                            : "Pathway details are currently unavailable."
                        }
                        onClick={() => onViewPathway?.(pathway.id)}
                      >
                        View pathway
                      </Button>
                      {index === 0 && (
                        <Button
                          variant="secondary"
                          disabled
                          title="Pathway comparison is currently unavailable."
                        >
                          Compare options
                        </Button>
                      )}
                    </div>
                  </div>

                  <aside className="assessment-results__details">
                    <section>
                      <h3>Why we suggested this</h3>
                      {pathway.reasons.length > 0 ? (
                        <ul role="list">
                          {pathway.reasons.map((reason, reasonIndex) => (
                            <li key={`${pathway.id}-reason-${reasonIndex}`}>
                              <Check size={16} aria-hidden="true" />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No explanation was provided with this result.</p>
                      )}
                    </section>
                    <section>
                      <h3>Information still needed</h3>
                      {pathway.informationNeeded.length > 0 ? (
                        <ul role="list">
                          {pathway.informationNeeded.map((item, itemIndex) => (
                            <li key={`${pathway.id}-needed-${itemIndex}`}>
                              <Info size={16} aria-hidden="true" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No further information is listed in this result.</p>
                      )}
                    </section>
                  </aside>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="assessment-entry__actions assessment-results__actions">
        <Link className="btn btn-ghost" to="/app/assessments/clarify">
          Back
        </Link>
        <Link className="btn btn-secondary" to="/services">
          Explore justice services
        </Link>
      </div>
    </AssessmentLayout>
  );
}
