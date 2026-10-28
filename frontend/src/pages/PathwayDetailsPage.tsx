import {
  AlertCircle,
  ArrowLeft,
  Check,
  ExternalLink,
  Info,
  LoaderCircle,
  Route as RouteIcon,
  ShieldCheck,
} from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "../components/ui/Button";
import "./JusticeServicesPage.css";
import "./PathwayDetailsPage.css";

// Public pathway fields must come from reviewed records, not assessment guesses.
export type PathwayDetails = {
  id: string;
  title: string;
  overview: string | null;
  whoMayUse: string | null;
  matters: readonly string[];
  requirements: readonly string[];
  startingSteps: readonly { title: string; description: string | null }[];
  nextStages: readonly string[];
  source: {
    name: string;
    url: string;
    review: {
      status: "verified" | "needs-review" | "expired";
      checkedOn: string;
    } | null;
  } | null;
  image?: { path: string; alt: string; caption: string } | null;
};

export type PathwayDetailsData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  // Use only after the backend confirms that a public record was not found.
  | { status: "not-found" }
  | { status: "ready"; pathway: PathwayDetails };

const unavailablePathway: PathwayDetailsData = { status: "unavailable" };

// Reject unsafe source addresses before creating external links.
function officialSource(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

// Display only a valid, supplied calendar date without inventing a review timestamp.
function sourceReviewDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

// Restrict editorial photos to approved local assets without adding third-party requests.
function localImagePath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://justicenav.invalid");
    return url.origin === "https://justicenav.invalid" &&
      url.pathname.startsWith("/images/pathways/") &&
      /\.(avif|gif|jpe?g|png|webp)$/i.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url.pathname
      : null;
  } catch {
    return null;
  }
}

// Render only the requested public pathway and distinguish missing data from a confirmed 404.
export function PathwayDetailsPage({
  details = unavailablePathway,
}: {
  details?: PathwayDetailsData;
}) {
  const { pathwayId } = useParams<{ pathwayId: string }>();
  const pathway =
    details.status === "ready" && details.pathway.id === pathwayId
      ? details.pathway
      : null;
  const status =
    details.status === "ready" && !pathway ? "unavailable" : details.status;
  const sourceUrl = officialSource(pathway?.source?.url);
  const checkedOn = sourceReviewDate(pathway?.source?.review?.checkedOn);
  const verified = Boolean(
    sourceUrl && checkedOn && pathway?.source?.review?.status === "verified",
  );
  const imagePath = localImagePath(pathway?.image?.path);

  return (
    <div className="justice-directory pathway-details">
      <Link className="pathway-details__back" to="/app/assessments/results">
        <ArrowLeft size={18} aria-hidden="true" />
        Back to pathway results
      </Link>

      <header className="justice-directory__heading pathway-details__heading">
        <div>
          <span className="pathway-details__eyebrow">Justice pathway</span>
          <h1>{pathway?.title ?? "Pathway information"}</h1>
          {pathway && <p>A plain-language guide to this pathway.</p>}
        </div>
        {pathway && (
          <div className="pathway-details__actions">
            <Button
              disabled
              title="Checklist creation is currently unavailable."
            >
              Create my checklist
            </Button>
            <Link className="btn btn-secondary" to="/services">
              Find related services
            </Link>
          </div>
        )}
      </header>

      <div aria-busy={status === "loading"}>
        {status === "unavailable" && (
          <div className="justice-directory__state" role="status">
            <RouteIcon size={30} aria-hidden="true" />
            <h2>Pathway information is currently unavailable.</h2>
            <p>Please check again later.</p>
          </div>
        )}

        {status === "loading" && (
          <div className="justice-directory__state" role="status">
            <LoaderCircle
              className="justice-directory__spinner"
              size={30}
              aria-hidden="true"
            />
            <h2>Loading pathway information.</h2>
          </div>
        )}

        {details.status === "error" && (
          <div className="justice-directory__state" role="alert">
            <AlertCircle size={30} aria-hidden="true" />
            <h2>Pathway information could not be loaded.</h2>
            <p>No pathway details are being displayed.</p>
            {details.retry && (
              <Button variant="secondary" onClick={details.retry}>
                Try again
              </Button>
            )}
          </div>
        )}

        {status === "not-found" && (
          <div className="justice-directory__state" role="status">
            <Info size={30} aria-hidden="true" />
            <h2>Pathway not found</h2>
            <p>This pathway may no longer be listed.</p>
            <Link className="btn btn-secondary" to="/services">
              Explore justice services
            </Link>
          </div>
        )}

        {pathway && (
          <>
            <div className="pathway-details__verification">
              {verified ? (
                <>
                  <span className="pathway-details__badge">
                    <ShieldCheck size={15} aria-hidden="true" />
                    Verified information
                  </span>
                  <span>Source verified: {checkedOn}</span>
                </>
              ) : (
                <span>Current source verification is not available.</span>
              )}
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  View official source{" "}
                  <ExternalLink size={16} aria-hidden="true" />
                </a>
              ) : (
                <span>Official source link unavailable.</span>
              )}
            </div>

            <div className="pathway-details__layout">
              <article
                className="pathway-details__article"
                aria-label="Pathway details"
              >
                {imagePath && pathway.image && (
                  <figure className="pathway-details__photo">
                    <img
                      src={imagePath}
                      width="1200"
                      height="640"
                      loading="lazy"
                      alt={pathway.image.alt}
                    />
                    <figcaption>{pathway.image.caption}</figcaption>
                  </figure>
                )}

                <section aria-labelledby="pathway-overview">
                  <h2 id="pathway-overview">What is this pathway?</h2>
                  <p>
                    {pathway.overview || "Information has not been published."}
                  </p>
                </section>

                <section aria-labelledby="pathway-eligibility">
                  <h2 id="pathway-eligibility">Who may use it?</h2>
                  <p>
                    {pathway.whoMayUse ||
                      "Eligibility information has not been published. Confirm current requirements with the official source."}
                  </p>
                </section>

                <section aria-labelledby="pathway-matters">
                  <h2 id="pathway-matters">
                    What types of matters may be handled?
                  </h2>
                  {pathway.matters.length > 0 ? (
                    <ul className="pathway-details__matters">
                      {pathway.matters.map((matter, index) => (
                        <li key={index}>{matter}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      Information about matters handled has not been published.
                    </p>
                  )}
                </section>

                <section aria-labelledby="pathway-requirements">
                  <h2 id="pathway-requirements">What may you need?</h2>
                  {pathway.requirements.length > 0 ? (
                    <ul className="pathway-details__requirements" role="list">
                      {pathway.requirements.map((item, index) => (
                        <li key={index}>
                          <Check size={18} aria-hidden="true" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      Requirements have not been published. Confirm them with
                      the official source.
                    </p>
                  )}
                </section>

                <section aria-labelledby="pathway-start">
                  <h2 id="pathway-start">How do you start?</h2>
                  {pathway.startingSteps.length > 0 ? (
                    <ol className="pathway-details__steps" role="list">
                      {pathway.startingSteps.map((step, index) => (
                        <li key={index}>
                          <span aria-hidden="true">{index + 1}</span>
                          <div>
                            <strong>{step.title}</strong>
                            {step.description && <p>{step.description}</p>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>
                      Starting steps have not been published. Use the official
                      source for current instructions.
                    </p>
                  )}
                </section>

                <section aria-labelledby="pathway-next">
                  <h2 id="pathway-next">What happens next?</h2>
                  {pathway.nextStages.length > 0 ? (
                    <ol className="pathway-details__timeline" role="list">
                      {pathway.nextStages.map((stage, index) => (
                        <li key={index}>
                          <span aria-hidden="true">{index + 1}</span>
                          <p>{stage}</p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>
                      Process information has not been published. No case status
                      or outcome is implied.
                    </p>
                  )}
                </section>

                <div className="pathway-details__notice" role="note">
                  <Info size={20} aria-hidden="true" />
                  <p>
                    <strong>Important:</strong> JusticeNav KE provides
                    navigation information and does not provide legal advice.
                    Confirm current eligibility and requirements with the
                    official source.
                  </p>
                </div>
              </article>

              <aside
                className="pathway-details__next"
                aria-labelledby="pathway-next-actions"
              >
                <h2 id="pathway-next-actions">Your next steps</h2>
                <p>Prepare before approaching this pathway.</p>
                <Button
                  full
                  disabled
                  title="Checklist creation is currently unavailable."
                >
                  Create my checklist
                </Button>
                <Button
                  variant="secondary"
                  full
                  disabled
                  title="Referral submission is currently unavailable."
                >
                  Start referral
                </Button>
                <p className="pathway-details__action-status">
                  Checklist creation and referral submission are unavailable. No
                  referral is sent to an institution.
                </p>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
