import {
  AlertCircle,
  ArrowLeft,
  Check,
  Info,
  LoaderCircle,
  Route as RouteIcon,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Pathway } from "../pathways/pathwayApi";
import { validId } from "../assessments/assessmentApi";
import { PathwaySources } from "../components/PathwaySources";
import { Button } from "../components/ui/Button";
import "./JusticeServicesPage.css";
import "./PathwayDetailsPage.css";

// Public pathway fields must come from reviewed records, not assessment guesses.
export type PathwayDetails = Pathway;

export type PathwayDetailsData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry?: () => void }
  // Use only after the backend confirms that a public record was not found.
  | { status: "not-found" }
  | { status: "ready"; pathway: PathwayDetails };

const unavailablePathway: PathwayDetailsData = { status: "unavailable" };

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
  const [params] = useSearchParams();
  const assessmentId = params.get("assessmentId");
  const context = validId(assessmentId) ? assessmentId : null;
  const back = context ? `/app/assessments/${context}/results` : "/app/assessments/results";
  const checklistLink = pathway ? `/app/checklists/new?pathwayId=${pathway.id}${context ? `&assessmentId=${context}` : ""}` : "";

  return (
    <div className="justice-directory pathway-details">
      <Link className="pathway-details__back" to={back}>
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
            <Link className="btn btn-primary" to={checklistLink}>Create my checklist</Link>
            <Link className="btn btn-secondary" to={`/services/${pathway.serviceId}`}>
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
            <PathwaySources review={pathway.sourceReview}/>
            <div className="pathway-details__layout">
              <article
                className="pathway-details__article"
                aria-label="Pathway details"
              >
                <section aria-labelledby="pathway-overview">
                  <h2 id="pathway-overview">What is this pathway?</h2>
                  <p>
                    {pathway.overview || "Information is not listed in this guide."}
                  </p>
                </section>

                <section aria-labelledby="pathway-eligibility">
                  <h2 id="pathway-eligibility">Who may use it?</h2>
                  <p>
                    {pathway.whoMayUse ||
                      "Eligibility information is not listed in this guide. Confirm current requirements with the official source."}
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
                      Further matters are not listed in this guide.
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
                      Further requirements are not listed in this guide. Confirm them with
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
                      Further steps are not listed in this guide. Use the official
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
                      Further process information is not listed in this guide. No case status
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
                <Link className="btn btn-primary btn-full" to={checklistLink}>Create my checklist</Link>
                <Link className="btn btn-secondary btn-full" to={`/app/referrals/new?pathwayId=${pathway.id}`}>Start referral</Link>
                <p className="pathway-details__action-status">
                  Save your preparation ticks to reopen them in My Checklists. No referral is sent to an institution.
                </p>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
