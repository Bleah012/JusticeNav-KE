import { ArrowLeft, Info } from "lucide-react";
import { Link } from "react-router";
import "./PrivacyNoticePage.css";

const contents = [
  ["terms-about", "About this prototype"],
  ["terms-guidance", "Information, not legal advice"],
  ["terms-testing", "Responsible testing"],
  ["terms-sources", "Sources and availability"],
  ["terms-referrals", "Referrals and organisations"],
  ["terms-external", "External websites and materials"],
  ["terms-privacy", "Your information"],
  ["terms-review", "Before live use"],
] as const;

// Present draft prototype terms using the existing legal-document layout.
export function TermsOfUsePage() {
  return (
    <div className="privacy-notice">
      <Link className="privacy-notice__back" to="/">
        <ArrowLeft size={18} aria-hidden="true" />
        Back to home
      </Link>

      <header className="privacy-notice__heading">
        <span>Using JusticeNav KE</span>
        <h1>Terms of Use</h1>
        <p>
          The purpose and limitations of the current JusticeNav KE student
          prototype.
        </p>
      </header>

      <div
        className="privacy-notice__draft"
        role="note"
        aria-labelledby="terms-draft-title"
      >
        <Info size={22} aria-hidden="true" />
        <div>
          <strong id="terms-draft-title">Draft for review</strong>
          <p>
            This page is a draft for the student prototype, not final terms for
            a live service. Use non-sensitive test inputs only. The operating
            arrangements and terms must be completed and reviewed before
            real-user intake.
          </p>
        </div>
      </div>

      <div className="privacy-notice__layout">
        <nav
          className="privacy-notice__contents"
          aria-labelledby="terms-contents-title"
        >
          <h2 id="terms-contents-title">On this page</h2>
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
          aria-label="Draft Terms of Use"
        >
          <section id="terms-about" aria-labelledby="terms-about-title">
            <h2 id="terms-about-title">About this prototype</h2>
            <p>
              JusticeNav KE is a software engineering student project exploring
              justice navigation for money, debt and consumer disputes in Kenya.
              It is not a court, law firm, legal aid organisation or government
              service.
            </p>
            <p>
              The current frontend contains page layouts, navigation and form
              validation. Authentication, the application database, AI
              classification and referral processing are not connected. A
              visible button or form does not mean that its underlying service
              is available.
            </p>
          </section>

          <section id="terms-guidance" aria-labelledby="terms-guidance-title">
            <h2 id="terms-guidance-title">Information, not legal advice</h2>
            <p>
              The project is intended to offer general information and
              navigation support, not advice about what you should do in a
              particular dispute. Using the prototype does not create a
              lawyer-client relationship or provide legal representation.
            </p>
            <p>
              No legal eligibility, case outcome, response time or acceptance by
              an organisation is promised. Confirm requirements and any
              applicable deadlines with the relevant official source or a
              qualified legal professional. Do not rely on the prototype to file
              documents, preserve a deadline or obtain urgent assistance.
            </p>
          </section>

          <section id="terms-testing" aria-labelledby="terms-testing-title">
            <h2 id="terms-testing-title">Responsible testing</h2>
            <p>
              During development, test the interface without entering real
              passwords, identification numbers, PINs, financial details or
              confidential information about yourself or anyone else.
            </p>
            <ul>
              <li>
                Do not impersonate another person or claim to represent an
                organisation without authority.
              </li>
              <li>
                Do not attempt to access another person&apos;s information,
                bypass access controls or disrupt the application.
              </li>
              <li>
                Do not use the prototype to send threats, harassment or unlawful
                material.
              </li>
            </ul>
            <p>
              The sign-up agreement checkbox currently supports on-page form
              validation. The form does not create an account or submit an
              agreement record to a backend.
            </p>
          </section>

          <section id="terms-sources" aria-labelledby="terms-sources-title">
            <h2 id="terms-sources-title">Sources and availability</h2>
            <p>
              The directory and resource library currently show an unavailable
              state because published records have not been connected. That
              state does not mean that no relevant services or resources exist.
            </p>
            <p>
              When source-backed information is added, any displayed review date
              will describe when the project checked that information, not a
              guarantee that it remains current. Confirm contact details,
              opening hours, charges, requirements and eligibility directly with
              the organisation concerned before relying on them.
            </p>
            <p>
              Development changes may interrupt or remove prototype pages.
              Continuous availability and completeness are not promised.
            </p>
          </section>

          <section id="terms-referrals" aria-labelledby="terms-referrals-title">
            <h2 id="terms-referrals-title">Referrals and organisations</h2>
            <p>
              No referral is currently submitted or delivered through this
              application. Any future school-project referral demonstration must
              be identified as a demonstration and must not be presented as a
              live handoff to an institution.
            </p>
            <p>
              Naming or linking to an organisation does not establish its
              participation, endorsement or partnership. JusticeNav KE does not
              act on behalf of those organisations. Contact them through their
              official channels for assistance.
            </p>
          </section>

          <section id="terms-external" aria-labelledby="terms-external-title">
            <h2 id="terms-external-title">External websites and materials</h2>
            <p>
              External links take you to websites operated by other parties.
              Their own terms, privacy practices and service requirements apply
              to those visits. The project does not control those websites.
            </p>
            <p>
              Third-party photographs, documents, names and other materials
              remain subject to their owners&apos; rights and applicable
              licences. A link or attribution does not grant permission to
              reproduce those materials or imply endorsement.
            </p>
          </section>

          <section id="terms-privacy" aria-labelledby="terms-privacy-title">
            <h2 id="terms-privacy-title">Your information</h2>
            <p>
              Read the <Link to="/privacy">Privacy Notice</Link> for the current
              prototype&apos;s handling of form inputs, URL searches, external
              image requests and browser storage. That notice is also a draft
              requiring review before live use.
            </p>
            <p>
              Entering information or checking the sign-up agreement box must
              not be treated as permission to reuse personal information for
              model training, research or unrelated purposes. Any proposed reuse
              requires separate disclosure and review.
            </p>
          </section>

          <section id="terms-review" aria-labelledby="terms-review-title">
            <h2 id="terms-review-title">Before live use</h2>
            <p>
              The responsible operator, project contact, support and complaints
              process, intended users, account rules and operating arrangements
              have not yet been finalised and published. These terms and the
              Privacy Notice must be reviewed alongside the implemented services
              before real-user intake.
            </p>
            <p>
              No final effective date, liability allocation, dispute-resolution
              procedure or contractual acceptance process is established by this
              draft. It does not ask you to waive statutory rights and is not a
              claim of legal compliance.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
