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
              operating justice service. Firebase email/password authentication
              is connected when configured. Firestore profile and assessment
              storage are available when configured. AI classification and
              institutional referral delivery are not connected. The public
              directory and resource library load published institutional
              information from the JusticeNav API without sending a bearer token
              or cookies.
            </p>
            <p>
              Information and navigation support, not legal advice. JusticeNav
              KE does not represent the organisations named on its pages.
            </p>
            <p>
              Pathway navigation reads the signed-in account's saved issue
              category to select general information links. It does not analyse
              the description. Public guide requests carry no bearer token.
              Checklist templates, records and progress use the authenticated
              API. Save checklist or Save &amp; exit stores a source-item
              snapshot, selected item IDs, owner reference, revision, status and
              timestamps in Firestore. Unsaved edits remain in page memory and
              are discarded on refresh or departure.
            </p>
          </section>

          <section id="privacy-forms" aria-labelledby="privacy-forms-title">
            <h2 id="privacy-forms-title">Information you enter</h2>
            <p>
              Registration sends your email address and password to Google
              Firebase Authentication and attempts to save your name as a
              Firebase display name. Sign-in and password recovery also contact
              Firebase. The JusticeNav API receives a Firebase ID token to
              verify identity and role; it does not receive your password. The
              optional phone field on registration is disabled and is not
              submitted. Saving the Profile page sends your name, optional phone
              number and language preference to the authenticated API, which
              stores them in Firestore with your verified user ID, saved
              revision and backend-generated timestamps. The profile does not
              store a password or change a sign-in email or role. Continue and
              Save & exit on assessment pages send your description or
              clarification answers to the authenticated API for storage in
              Firestore, with your verified user ID, assessment reference, saved
              progress, revision and backend timestamps. These entries are
              available only through own-account endpoints. Leaving a form
              without saving discards its edits. Save referral request stores
              your entered name, email, optional phone, contact preference,
              description, a snapshot of the selected public pathway and
              service, acknowledgement version and server timestamps in
              Firestore under your verified account. These fields are sent to
              the JusticeNav API in the request body, not in the page URL. The
              URL may contain an opaque request reference. Confirmation and
              tracking read your own saved record; they do not contact an
              institution, verify contact details or send email or SMS. No
              editing, deletion or retention automation applies to the private
              request.
            </p>
            <p>
              If you opt in to a school demonstration, we store your account and
              referral references, the public service and pathway names, the
              consent version, and progress dates in a separate record. The
              project administrator and assigned development provider see the
              demonstration metadata. The provider assignment is stored using a
              key derived from the provider account and service. Withdrawing
              sharing removes provider access on subsequent requests and keeps
              the history in My Referrals.
            </p>
            <p>
              The dashboard reads totals and recent saved-record summaries from
              your own account; its response excludes assessment and referral
              descriptions, contact details and clarification answers. Recent
              activity shows the latest save per record, not a complete history.
              Opening or refreshing the dashboard does not save records or
              create activity events. Successful assessment, checklist and
              project-request saves also store an account-only notification in
              Firestore in the same transaction. Each update contains your
              verified UID, a reference to the saved record and revision, its
              kind, saved timestamp and assessment step where relevant, plus
              unread/read status and the server time when marked read.
              Notification records do not copy your description, clarification
              answers or contact details. Opening Notifications only reads this
              metadata; Mark as read and Mark displayed as read explicitly save
              read status for the selected updates. No email, SMS or
              institutional delivery is triggered, and no automatic deletion or
              notification preferences are connected.
            </p>
            <p>
              Your browser or password manager may retain information through
              its own settings. Use a dedicated test email address you control
              and a unique password you do not use elsewhere. Do not enter
              identification numbers, PINs, financial details or confidential
              dispute information.
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
              as private. The reset page verifies the code with Firebase before
              requesting a password change. A successful reset changes the
              Firebase account password. Do not share reset links, screenshots
              of codes or tokens.
            </p>
          </section>

          <section
            id="privacy-external"
            aria-labelledby="privacy-external-title"
          >
            <h2 id="privacy-external-title">External services</h2>
            <p>
              Google Firebase processes authentication requests and stores the
              test account. Firebase may process network and security
              information under its own service terms. Creating an account and
              saving a profile, assessment or checklist are real cloud
              operations even though the justice-navigation services remain a
              student prototype. The development profile database uses the
              location selected in the Firebase console. Profile storage
              location does not establish where Firebase Authentication or every
              other service processes information.
            </p>
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
              integration. Firebase stores authentication state, including
              tokens, in browser session storage for the current tab and clears
              that session on explicit sign-out. Browser session restoration may
              affect how long the tab remains available. This is not account
              deletion or revocation of all sessions. No assessment or referral
              is saved in browser storage by this app. This statement does not
              cover browser extensions or third-party websites.
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
              Additional account and assessment services will change how
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
