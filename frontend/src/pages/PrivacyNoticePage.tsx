import { ArrowLeft, ExternalLink, Info } from "lucide-react";
import { Link } from "react-router";
import "./PrivacyNoticePage.css";

const contents = [
  ["privacy-scope", "About this notice"],
  ["privacy-forms", "Information you enter"],
  ["privacy-urls", "Searches and links"],
  ["privacy-external", "External services"],
  ["privacy-storage", "Storage and tracking"],
  ["privacy-future", "Planned data use"],
  ["privacy-before-use", "Before live use"],
  ["privacy-rights", "Questions and rights"],
] as const;

// Describe the reviewed prototype's data handling without presenting a final legal notice.
export function PrivacyNoticePage() {
  return (
    <div className="privacy-notice">
      <Link className="privacy-notice__back" to="/">
        <ArrowLeft size={18} aria-hidden="true" />
        Back to home
      </Link>

      <header className="privacy-notice__heading">
        <span>Your information matters</span>
        <h1>Privacy Notice</h1>
        <p>
          How information is handled in the current JusticeNav KE student
          prototype.
        </p>
      </header>

      <div
        className="privacy-notice__draft"
        role="note"
        aria-labelledby="privacy-draft-title"
      >
        <Info size={22} aria-hidden="true" />
        <div>
          <strong id="privacy-draft-title">Draft for review</strong>
          <p>
            Use non-sensitive test inputs only. This is not a complete privacy
            notice for a live service. The notice and the underlying safeguards
            must be completed and reviewed before collecting account details or
            problem descriptions from real users.
          </p>
        </div>
      </div>

      <div className="privacy-notice__layout">
        <nav
          className="privacy-notice__contents"
          aria-labelledby="privacy-contents-title"
        >
          <h2 id="privacy-contents-title">On this page</h2>
          <ul role="list">
            {contents.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <article
          className="privacy-notice__article"
          aria-label="Draft Privacy Notice"
        >
          <section id="privacy-scope" aria-labelledby="privacy-scope-title">
            <h2 id="privacy-scope-title">About this notice</h2>
            <p>
              JusticeNav KE is a software engineering student project. This
              draft describes the current frontend prototype, not a fully
              operating justice service. Authentication, the application
              database, AI classification and referral processing are not
              connected.
            </p>
            <p>
              Information and navigation support, not legal advice. JusticeNav
              KE does not represent the organisations named on its pages.
            </p>
          </section>

          <section id="privacy-forms" aria-labelledby="privacy-forms-title">
            <h2 id="privacy-forms-title">Information you enter</h2>
            <p>
              Account forms contain fields for a name, email address, passwords
              and an optional phone number. The current application uses entries
              for on-page validation; it does not submit these fields to a
              JusticeNav backend or save them in an application database.
            </p>
            <p>
              Your browser or password manager may retain information through
              its own settings. Do not use real passwords, identification
              numbers, PINs, financial details or confidential dispute
              information when testing this prototype.
            </p>
          </section>

          <section id="privacy-urls" aria-labelledby="privacy-urls-title">
            <h2 id="privacy-urls-title">Searches and links</h2>
            <p>
              Directory search text, filters and resource categories are kept in
              the page URL. URLs can appear in browser history and shared links;
              when requested, they may also appear in server access logs. Do not
              put personal or confidential information in directory searches.
            </p>
            <p>
              Password-reset links may contain a reset code. Treat those links
              as private. The prototype does not verify reset codes or change
              passwords.
            </p>
          </section>

          <section
            id="privacy-external"
            aria-labelledby="privacy-external-title"
          >
            <h2 id="privacy-external-title">External services</h2>
            <p>
              The landing page currently loads its photo from images.pexels.com.
              Loading that image contacts Pexels, which can receive your IP
              address and other network-request details. See the{" "}
              <a
                href="https://www.pexels.com/privacy-policy/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Pexels Privacy Policy{" "}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              .
            </p>
            <p>
              Fonts are bundled with the application. Following an external
              resource link opens another organisation&apos;s website, whose
              privacy practices apply to that visit.
            </p>
          </section>

          <section id="privacy-storage" aria-labelledby="privacy-storage-title">
            <h2 id="privacy-storage-title">Storage and tracking</h2>
            <p>
              The current application has no added advertising or analytics
              integration and does not write application-managed cookies, local
              storage or session storage. This statement does not cover browser
              extensions or third-party websites.
            </p>
            <p>
              Development servers and future hosting providers may process
              network requests and diagnostic information under their own
              configurations. Deployment settings, access logging and retention
              arrangements have not yet been finalised. No fixed retention
              period or security guarantee is claimed here.
            </p>
          </section>

          <section id="privacy-future" aria-labelledby="privacy-future-title">
            <h2 id="privacy-future-title">Planned data use</h2>
            <p>
              Planned account and assessment services will change how
              information is handled. This notice must be updated before those
              services receive real user information, including any information
              shared in the school-project referral demonstration.
            </p>
            <p>
              No classifier is connected, and this prototype does not send form
              entries for AI analysis or model training. Any proposed reuse of
              user information for training or research must be separately
              disclosed and reviewed; entering information must not be treated
              as permission for that reuse.
            </p>
          </section>

          <section
            id="privacy-before-use"
            aria-labelledby="privacy-before-use-title"
          >
            <h2 id="privacy-before-use-title">Before live use</h2>
            <p>
              The following arrangements remain to be finalised and reviewed:
            </p>
            <ul>
              <li>The responsible operator and a project privacy contact.</li>
              <li>
                Collection purposes, the applicable legal basis and any
                permission process.
              </li>
              <li>
                Service providers, hosting locations, recipients and any
                international transfers.
              </li>
              <li>
                Access controls, retention, deletion and security procedures.
              </li>
              <li>
                How privacy concerns and data-rights requests will be handled.
              </li>
            </ul>
            <p>This draft is not a claim of data-protection compliance.</p>
          </section>

          <section id="privacy-rights" aria-labelledby="privacy-rights-title">
            <h2 id="privacy-rights-title">Questions and rights</h2>
            <p>
              A project-specific privacy contact and request process have not
              yet been published. This must be resolved before real-user intake;
              no placeholder email address or request form is provided here.
            </p>
            <p>
              For information about data-protection rights in Kenya, see the{" "}
              <a
                href="https://www.odpc.go.ke/rights-of-a-data-subject/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Office of the Data Protection Commissioner&apos;s guidance{" "}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              . The ODPC is an independent regulator, not the project&apos;s
              privacy contact or a project partner.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
