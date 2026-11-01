import { Info } from "lucide-react";
import { Link } from "react-router";
import { AccountSettingsNav } from "../components/AccountSettingsNav";
import { Button } from "../components/ui/Button";
import "./SeekerPages.css";
import "./AccountPages.css";
import "./SeekerTools.css";

// Present account controls without implying that security or data services exist.
export function PrivacySecurityPage() {
  return (
    <>
      <header className="seeker-page__heading">
        <span className="seeker-page__eyebrow">Account settings</span>
        <h1>Privacy &amp; security</h1>
        <p>Control your data, sign-in security and active sessions.</p>
      </header>

      <div className="seeker-page__notice" id="security-prototype-note">
        <Info size={20} aria-hidden="true" />
        <p>
          Account security and data-management services are currently
          unavailable. These controls do not change passwords, manage sessions,
          download data or delete accounts.
        </p>
      </div>

      <div className="account-pages__settings">
        <AccountSettingsNav current="security" />
        <div className="seeker-tools__settings-panels">
          <section
            className="seeker-page__panel"
            id="account-security"
            aria-labelledby="security-section-title"
          >
            <h2 id="security-section-title">Security</h2>
            <div className="seeker-tools__setting-row">
              <div>
                <h3>Password</h3>
                <p>Password information is currently unavailable.</p>
              </div>
              <Button
                variant="secondary"
                disabled
                aria-describedby="security-prototype-note"
              >
                Change password
              </Button>
            </div>
            <div className="seeker-tools__setting-row">
              <div>
                <h3>Active sessions</h3>
                <p>Session information is currently unavailable.</p>
              </div>
              <Button
                variant="ghost"
                disabled
                aria-describedby="security-prototype-note"
              >
                Review sessions
              </Button>
            </div>
          </section>

          <section
            className="seeker-page__panel"
            id="account-data"
            aria-labelledby="account-data-title"
          >
            <h2 id="account-data-title">Your data</h2>
            <div className="seeker-tools__setting-row">
              <div>
                <h3>Download my data</h3>
                <p>Account data downloads are currently unavailable.</p>
              </div>
              <Button
                variant="secondary"
                disabled
                aria-describedby="security-prototype-note"
              >
                Request download
              </Button>
            </div>
            <div className="seeker-tools__setting-row seeker-tools__setting-row--danger">
              <div>
                <h3>Delete account</h3>
                <p>Account deletion is currently unavailable.</p>
              </div>
              <Button
                variant="danger"
                disabled
                aria-describedby="security-prototype-note"
              >
                Delete account
              </Button>
            </div>
          </section>
          <p className="seeker-tools__notice-links">
            Read the <Link to="/privacy">Privacy Notice</Link> and{" "}
            <Link to="/terms">Terms of Use</Link> for the current prototype.
          </p>
        </div>
      </div>
    </>
  );
}
