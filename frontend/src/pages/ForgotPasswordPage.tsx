import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../components/ui/Button";
import "./SignInPage.css";

// Present account recovery without pretending to send a password-reset email.
export function ForgotPasswordPage() {
  const [error, setError] = useState("");

  // Keep recovery unavailable until Firebase email delivery is connected.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(
      "Password reset is currently unavailable. Please try again later.",
    );
  }

  return (
    <div className="sign-in">
      <aside className="sign-in__aside" aria-labelledby="recovery-intro">
        <Link className="sign-in__brand" to="/" aria-label="JusticeNav KE home">
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
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

        <div className="sign-in__intro">
          <span className="sign-in__badge">Navigate with confidence</span>
          <h2 id="recovery-intro">
            Justice support should be easier to understand.
          </h2>
          <p>
            Find relevant pathways, prepare for assistance and track your next
            steps&mdash;all in one place.
          </p>
          <ul className="sign-in__points" role="list">
            {[
              "Start with ordinary language",
              "Use verified justice information",
              "Stay in control of your information",
            ].map((point) => (
              <li key={point}>
                <Check size={18} aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <small>
          Not legal advice. Always confirm eligibility with the official source.
        </small>
      </aside>

      <main className="sign-in__main" id="main-content">
        <Link className="sign-in__back" to="/">
          <ArrowLeft size={18} aria-hidden="true" />
          Back to home
        </Link>

        <form
          className="sign-in__form"
          onSubmit={handleSubmit}
          aria-labelledby="recovery-title"
        >
          <span className="sign-in__badge">Account recovery</span>
          <h1 id="recovery-title">Forgot your password?</h1>
          <p>Enter the email address associated with your account.</p>

          <div className="sign-in__field">
            <label htmlFor="recovery-email">Email address</label>
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              aria-describedby={error ? "recovery-error" : undefined}
              onInput={() => setError("")}
              required
            />
          </div>

          {error && (
            <p className="sign-in__error" id="recovery-error" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" full>
            Send reset link
          </Button>

          <p className="sign-in__switch">
            Remember your password? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
