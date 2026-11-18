import { ArrowRight, ClipboardCheck, Compass, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import "../components/ui/Button.css";
import "./AboutPage.css";

const features = [
  {
    Icon: Compass,
    title: "Start in your own words",
    description:
      "Save a description of your situation and answer a few clarifying questions. Request an optional category suggestion, or choose the category yourself.",
  },
  {
    Icon: ShieldCheck,
    title: "Explore published guidance",
    description:
      "Browse Kenyan justice pathways, services and resources with links to the official sources used in the catalogue. Check the source details before taking your next step.",
  },
  {
    Icon: ClipboardCheck,
    title: "Prepare and return later",
    description:
      "Save preparation checklists, keep track of completed items and reopen your assessments and private referral requests from your account.",
  },
];

// Explain the implemented project and its demonstration scope to public visitors.
export function AboutPage() {
  return (
    <div className="about-page">
      <header className="about-page__hero">
        <div className="about-page__container">
          <span className="about-page__eyebrow">About the project</span>
          <h1>About JusticeNav KE</h1>
          <p className="about-page__statement">
            A clearer starting point for your next step.
          </p>
          <p className="about-page__lead">
            JusticeNav KE is a student software engineering project that helps
            people in Kenya explore potentially relevant justice pathways,
            understand published requirements and prepare to seek assistance.
          </p>
          <Link className="btn btn-primary" to="/services">
            Explore justice services <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section className="about-page__container about-page__purpose" aria-labelledby="about-purpose">
        <div>
          <span className="about-page__eyebrow">Why we built it</span>
          <h2 id="about-purpose">You should be able to start with what happened.</h2>
        </div>
        <div className="about-page__body">
          <p>
            When you have a problem, knowing the legal terms or the right
            institution to approach can be difficult. This project brings
            descriptions, pathway information and preparation tools together
            in one guided journey.
          </p>
          <p>
            The initial focus is consumer disputes and money or debt issues.
            Category suggestions support your choice; you can always select a
            different category. When the model is unsure, you choose how to
            continue.
          </p>
        </div>
      </section>

      <section className="about-page__features" aria-labelledby="about-features">
        <div className="about-page__container">
          <span className="about-page__eyebrow">What you can do</span>
          <h2 id="about-features">Understand. Explore. Prepare.</h2>
          <div className="about-page__cards">
            {features.map(({ Icon, title, description }) => (
              <article className="about-page__card" key={title}>
                <Icon size={26} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="about-page__container about-page__scope" aria-labelledby="about-scope">
        <div>
          <span className="about-page__eyebrow">The current prototype</span>
          <h2 id="about-scope">A student project with a demonstration workflow.</h2>
          <p>
            A seeker can explicitly share a saved request for a school
            demonstration. An administrator assigns it to a development provider,
            who records review progress. The seeker can follow its status history
            and receive in-app updates.
          </p>
          <p>
            This workflow does not send referrals to real institutions or confirm
            their participation. Use non-sensitive test information when trying
            the prototype.
          </p>
        </div>
        <aside className="about-page__note" aria-labelledby="about-guidance">
          <ShieldCheck size={28} aria-hidden="true" />
          <h3 id="about-guidance">Information to help you prepare</h3>
          <p>
            JusticeNav KE provides information and navigation support, not legal
            advice. A category suggestion does not decide your rights,
            eligibility or the outcome of a case.
          </p>
          <p>
            Review the linked official sources for current requirements and seek
            qualified assistance for advice about your situation.
          </p>
          <div className="about-page__links">
            <Link to="/privacy">Privacy notice</Link>
            <Link to="/terms">Terms of use</Link>
          </div>
        </aside>
      </section>

      <section className="about-page__next" aria-labelledby="about-next">
        <div className="about-page__container">
          <h2 id="about-next">Find a place to begin.</h2>
          <p>
            Browse public information, or sign in to save your progress and
            return to it later.
          </p>
          <div className="about-page__actions">
            <Link className="btn btn-primary" to="/app/assessments/new">
              Find my next step <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link className="btn btn-secondary" to="/resources">Browse resources</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
