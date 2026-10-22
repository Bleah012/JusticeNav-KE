import {
  AlertCircle,
  ArrowLeft,
  Building2,
  ExternalLink,
  Info,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "../components/ui/Button";
import type { DirectoryService } from "./JusticeServicesPage";
import "./JusticeServicesPage.css";
import "./ServiceProfilePage.css";

export type ServiceProfile = DirectoryService & {
  about: string | null;
  offeredServices: readonly string[];
  whoMayQualify: string | null;
  accessSteps: readonly { title: string; description: string | null }[];
  officialWebsite: string | null;
  contact: {
    access: string | null;
    coverage: string | null;
    hours: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
};

export type ServiceProfileData =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  // Use only after the backend confirms that a public record was not found.
  | { status: "not-found" }
  | { status: "ready"; service: ServiceProfile };

const unavailableProfile: ServiceProfileData = { status: "unavailable" };

// Reject unsafe website schemes before rendering a source link.
function publicWebsite(value: string | null) {
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

// Present only the selected service's supplied records, with honest missing-data states.
export function ServiceProfilePage({
  profile = unavailableProfile,
}: {
  profile?: ServiceProfileData;
}) {
  const { serviceId } = useParams<{ serviceId: string }>();
  const service =
    profile.status === "ready" && profile.service.id === serviceId
      ? profile.service
      : null;
  const status =
    profile.status === "ready" && !service ? "unavailable" : profile.status;
  const website = service ? publicWebsite(service.officialWebsite) : null;

  return (
    <div className="justice-directory service-profile">
      <Link className="service-profile__back" to="/services">
        <ArrowLeft size={18} aria-hidden="true" />
        Back to justice services
      </Link>

      <header className="justice-directory__heading service-profile__heading">
        <div>
          <span className="service-profile__eyebrow">Service profile</span>
          <h1>{service?.name ?? "Service information"}</h1>
          {service && <p>{service.description}</p>}
        </div>
        {service && (
          <Button
            variant="secondary"
            disabled
            title="Referral requests are not available yet"
          >
            Start referral
          </Button>
        )}
      </header>

      <div aria-busy={status === "loading"}>
        {status === "unavailable" && (
          <div className="justice-directory__state" role="status">
            <Building2 size={30} aria-hidden="true" />
            <h2>Service information is currently unavailable.</h2>
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
            <h2>Loading service information…</h2>
          </div>
        )}

        {profile.status === "error" && (
          <div className="justice-directory__state" role="alert">
            <AlertCircle size={30} aria-hidden="true" />
            <h2>Service information could not be loaded.</h2>
            <p>Please try again.</p>
            <Button variant="secondary" onClick={profile.retry}>
              Try again
            </Button>
          </div>
        )}

        {status === "not-found" && (
          <div className="justice-directory__state" role="status">
            <Info size={30} aria-hidden="true" />
            <h2>Service not found</h2>
            <p>This service may no longer be listed.</p>
            <Link className="btn btn-secondary" to="/services">
              Explore justice services
            </Link>
          </div>
        )}

        {service && (
          <>
            <div className="service-profile__verification">
              {service.sourceReview ? (
                <>
                  <span className="service-profile__badge">
                    <ShieldCheck size={15} aria-hidden="true" />
                    Verified source
                  </span>
                  <span>Last verified: {service.sourceReview.checkedOn}</span>
                </>
              ) : (
                <span>Source review information is not available.</span>
              )}
              {website && (
                <a href={website} target="_blank" rel="noopener noreferrer">
                  Official website <ExternalLink size={16} aria-hidden="true" />
                </a>
              )}
            </div>

            <div className="service-profile__layout">
              <article
                className="service-profile__article"
                aria-label="Service details"
              >
                <section
                  className="service-profile__section"
                  aria-labelledby="service-about"
                >
                  <h2 id="service-about">About</h2>
                  <p>
                    {service.about || "Information has not been published."}
                  </p>
                </section>

                <section
                  className="service-profile__section"
                  aria-labelledby="service-offerings"
                >
                  <h2 id="service-offerings">Services offered</h2>
                  {service.offeredServices.length ? (
                    <ul>
                      {service.offeredServices.map((offering, index) => (
                        <li key={index}>{offering}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Service details have not been published.</p>
                  )}
                </section>

                <section
                  className="service-profile__section"
                  aria-labelledby="service-eligibility"
                >
                  <h2 id="service-eligibility">Who may qualify</h2>
                  <p>
                    {service.whoMayQualify ||
                      "Confirm current requirements with the official service."}
                  </p>
                </section>

                <section
                  className="service-profile__section"
                  aria-labelledby="service-access"
                >
                  <h2 id="service-access">How to access</h2>
                  {service.accessSteps.length ? (
                    <ol className="service-profile__steps" role="list">
                      {service.accessSteps.map((step, index) => (
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
                      Confirm available access channels with the official
                      service.
                    </p>
                  )}
                </section>

                <div className="service-profile__notice">
                  <Info size={20} aria-hidden="true" />
                  <p>
                    JusticeNav KE does not represent this organisation or
                    guarantee acceptance of a referral.
                  </p>
                </div>
              </article>

              <aside
                className="service-profile__contact"
                aria-labelledby="service-contact"
              >
                <h2 id="service-contact">Contact &amp; access</h2>
                <dl>
                  <div>
                    <dt>Access</dt>
                    <dd>{service.contact.access || "Not published"}</dd>
                  </div>
                  <div>
                    <dt>Coverage</dt>
                    <dd>{service.contact.coverage || "Not published"}</dd>
                  </div>
                  <div>
                    <dt>Hours</dt>
                    <dd>
                      {service.contact.hours || "Confirm with official source"}
                    </dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{service.contact.address || "Not published"}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{service.contact.phone || "Not published"}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{service.contact.email || "Not published"}</dd>
                  </div>
                </dl>
                <Button
                  full
                  disabled
                  title="Referral requests are not available yet"
                >
                  Request assistance
                </Button>
                <p className="service-profile__referral-status">
                  Referral requests are not available. No referral is sent to
                  this organisation.
                </p>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
