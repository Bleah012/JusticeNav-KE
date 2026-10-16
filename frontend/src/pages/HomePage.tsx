import {
  ArrowRight,
  Banknote,
  Building2,
  Check,
  ClipboardCheck,
  FileText,
  Info,
  Landmark,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import "../components/ui/Button.css";
import "./HomePage.css";

const heroPhoto =
  "https://images.pexels.com/photos/8550496/pexels-photo-8550496.jpeg?auto=compress&cs=tinysrgb&w=2000";

// Render the public landing page with source-backed scope and demo-only referrals.
export function HomePage() {
  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <img
          className="home-hero__photo"
          src={heroPhoto}
          alt=""
          width={2000}
          height={1333}
          fetchPriority="high"
        />
        <div className="home-hero__copy">
          <span className="home-hero__badge">
            <Sparkles size={14} aria-hidden="true" />
            AI-assisted justice navigation for Kenya
          </span>
          <h1 id="home-title">JusticeNav KE</h1>
          <h2>Not sure where to start with a legal problem?</h2>
          <p className="home-hero__lead">
            Describe your situation in your own words. We&rsquo;ll help you
            identify potentially relevant pathways, understand published
            requirements, and find verified services.
          </p>
          <div className="home-hero__actions">
            <Link className="btn btn-primary" to="/app/assessments/new">
              Find my next step <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="btn btn-secondary" to="/services">
              Explore justice services
            </Link>
          </div>
          <div className="home-hero__trust">
            <span>
              <Sparkles size={18} aria-hidden="true" />
              AI-assisted navigation
            </span>
            <span>
              <ShieldCheck size={18} aria-hidden="true" />
              Verified sources
            </span>
            <span>
              <Info size={18} aria-hidden="true" />
              Not legal advice
            </span>
          </div>
        </div>
        <p className="home-hero__credit">
          Photo by Edmond Dant&egrave;s on Pexels
        </p>
      </section>

      <section
        className="home-intro"
        id="about"
        aria-labelledby="journey-title"
      >
        <div>
          <span className="home-intro__badge">A guided path forward</span>
          <h2 id="journey-title">From uncertainty to a clear next step.</h2>
          <p>
            JusticeNav KE starts with your lived experience, then helps organise
            the information around verified pathways and services.
          </p>
        </div>
        <aside className="home-journey" aria-label="Your journey">
          <div className="home-journey__head">
            <span>Your journey</span>
            <span className="home-journey__badge">
              <ShieldCheck size={14} aria-hidden="true" />
              Clear next steps
            </span>
          </div>
          <div className="home-journey__problem">
            &ldquo;I have a problem&rdquo;
          </div>
          <ol className="home-journey__steps" role="list">
            {[
              ["Understand", "Tell us what happened"],
              ["Find a pathway", "See relevant options"],
              ["Prepare", "Know what you may need"],
              ["Take the next step", "Act with more confidence"],
            ].map(([title, description], index) => (
              <li key={title}>
                <span aria-hidden="true">{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section
        className="home-how"
        id="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="home-how__heading">
          <span className="home-intro__badge">How it works</span>
          <h2 id="how-title">A clearer path forward, one step at a time</h2>
          <p>
            You don&rsquo;t need to know the legal words or which institution to
            approach.
          </p>
        </div>
        <ol className="home-how__steps" role="list">
          {[
            ["01", "Describe", "Tell us what happened using your own words."],
            ["02", "Clarify", "Answer a few questions to help us understand."],
            ["03", "Match", "See potentially relevant justice pathways."],
            ["04", "Prepare", "Get a checklist of information you may need."],
            [
              "05",
              "Follow up",
              "Track demonstration referrals or your next steps.",
            ],
          ].map(([number, title, description]) => (
            <li key={number}>
              <span className="home-how__number" aria-hidden="true">
                {number}
              </span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="home-pathways home-section"
        aria-labelledby="pathways-title"
      >
        <div className="home-section__heading">
          <span className="home-intro__badge">Common pathways</span>
          <h2 id="pathways-title">Start with what sounds familiar</h2>
          <p>
            Explore information designed around real-life problems, not legal
            terminology.
          </p>
        </div>
        <div className="home-pathways__grid">
          <article className="home-pathway home-pathway--consumer">
            <FileText size={24} aria-hidden="true" />
            <h3>Consumer</h3>
            <p>Purchases, services, refunds or unresolved complaints.</p>
            <Link className="home-text-link" to="/services">
              Explore justice services{" "}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </article>
          <article className="home-pathway home-pathway--monetary">
            <Banknote size={24} aria-hidden="true" />
            <h3>Civil &amp; monetary</h3>
            <p>Money, debts, contracts or other civil matters.</p>
            <Link className="home-text-link" to="/services">
              Explore justice services{" "}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </article>
        </div>
      </section>

      <section className="home-why" aria-labelledby="why-title">
        <div className="home-section">
          <div className="home-section__heading home-section__heading--center">
            <span className="home-intro__badge">Why JusticeNav KE</span>
            <h2 id="why-title">Built to make the next step feel possible</h2>
          </div>
          <div className="home-benefits">
            {(
              [
                [
                  Sparkles,
                  "Start with your problem",
                  "No legal terminology required.",
                ],
                [
                  ShieldCheck,
                  "Verified information",
                  "Clear sources and verification dates.",
                ],
                [
                  ArrowRight,
                  "Clear next steps",
                  "Understand where to go and what to do.",
                ],
                [
                  ClipboardCheck,
                  "Preparation checklists",
                  "Gather what you may need.",
                ],
                [
                  Mail,
                  "Referral & follow-up",
                  "Track demonstration referrals and next steps.",
                ],
                [
                  Landmark,
                  "Designed for Kenya",
                  "Relevant institutions and pathways.",
                ],
              ] as const
            ).map(([Icon, title, description]) => (
              <article key={title}>
                <Icon size={22} aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </article>
            ))}
          </div>
          <p className="home-why__notice">
            Student project. Referral tracking is a demonstration; no referral
            is sent to an institution.
          </p>
        </div>
      </section>

      <section
        className="home-sources home-section"
        aria-labelledby="sources-title"
      >
        <div className="home-section__heading">
          <span className="home-intro__badge">Trusted information</span>
          <h2 id="sources-title">Built around official and verified sources</h2>
          <p>
            Information may be sourced from official and verified
            justice-service sources. Listing does not imply endorsement or
            partnership.
          </p>
          <Link className="btn btn-secondary" to="/resources">
            Browse verified resources
          </Link>
        </div>
        <ul
          className="home-sources__grid"
          role="list"
          aria-label="Reference organisations"
        >
          {[
            "Judiciary of Kenya",
            "National Legal Aid Service",
            "Kenya Law",
            "Law Society of Kenya",
            "FIDA Kenya",
          ].map((name) => (
            <li key={name}>
              <Building2 size={22} aria-hidden="true" />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-privacy" aria-labelledby="privacy-title">
        <div className="home-privacy__inner">
          <LockKeyhole size={28} aria-hidden="true" />
          <div>
            <h2 id="privacy-title">Your information matters</h2>
            <p>
              Designed around data minimisation and responsible handling of user
              information.
            </p>
            <ul className="home-privacy__principles" role="list">
              {[
                "Secure authentication",
                "Privacy-focused design",
                "Controlled access",
                "User data protection",
              ].map((principle) => (
                <li key={principle}>
                  <Check size={16} aria-hidden="true" />
                  {principle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-footer__inner">
          <div className="home-footer__grid">
            <div className="home-footer__identity">
              <Link
                className="home-footer__brand"
                to="/"
                aria-label="JusticeNav KE home"
              >
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 40 40"
                  aria-hidden="true"
                >
                  <rect
                    width="40"
                    height="40"
                    rx="12"
                    fill="none"
                    stroke="currentColor"
                  />
                  <path
                    d="M12 28V15.5c0-2.5 2-4.5 4.5-4.5S21 13 21 15.5v9c0 2 1.6 3.5 3.5 3.5S28 26.4 28 24.5V12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <path
                    d="m24.5 15 3.5-3.5 3.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>JusticeNav KE</span>
              </Link>
              <p>
                From &ldquo;I have a problem&rdquo; to &ldquo;I know what to do
                next.&rdquo;
              </p>
            </div>
            <nav aria-labelledby="footer-product">
              <h2 id="footer-product">Product</h2>
              <a href="#how-it-works">How it works</a>
              <Link to="/services">Justice services</Link>
              <Link to="/resources">Resources</Link>
            </nav>
            <nav aria-labelledby="footer-company">
              <h2 id="footer-company">Company</h2>
              <a href="#about">About</a>
              <Link to="/admin">Admin portal</Link>
            </nav>
            <nav aria-labelledby="footer-legal">
              <h2 id="footer-legal">Legal</h2>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
              <a href="#disclaimer">Disclaimer</a>
            </nav>
          </div>
          <div className="home-footer__bottom" id="disclaimer">
            <span>&copy; 2026 JusticeNav KE</span>
            <p>Information and navigation support, not legal advice.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
