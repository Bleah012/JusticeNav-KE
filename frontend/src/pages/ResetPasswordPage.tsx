import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Button } from "../components/ui/Button";
import "./SignInPage.css";

const messages = {
  mismatch: "Passwords do not match.",
  missingLink:
    "Open the password reset link from your email, or request a new link.",
  unavailable:
    "Password reset is currently unavailable. Please try again later.",
};

// Display reset-password fields without verifying a link or changing credentials.
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<keyof typeof messages | null>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  // Parameter presence does not establish that a reset code is valid or unexpired.
  const hasResetParameters =
    searchParams.get("mode") === "resetPassword" &&
    Boolean(searchParams.get("oobCode")?.trim());

  // Validate matching fields but never claim that a password was changed.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== confirmation) {
      setError("mismatch");
      confirmationRef.current?.focus();
      return;
    }

    setError(hasResetParameters ? "unavailable" : "missingLink");
  }

  return (
    <div className="sign-in">
      <aside className="sign-in__aside" aria-labelledby="reset-intro">
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
          <h2 id="reset-intro">
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
        <Link className="sign-in__back" to="/login">
          <ArrowLeft size={18} aria-hidden="true" />
          Back to sign in
        </Link>

        <form
          className="sign-in__form"
          onSubmit={handleSubmit}
          onInput={() => setError(null)}
          aria-labelledby="reset-title"
        >
          <span className="sign-in__badge">Account recovery</span>
          <h1 id="reset-title">Reset your password</h1>
          <p>Choose a new password and confirm it below.</p>

          <div className="sign-in__field">
            <label htmlFor="reset-password">New password</label>
            <div className="sign-in__password">
              <input
                id="reset-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Enter your new password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="sign-in__password-toggle"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                aria-controls="reset-password"
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? (
                  <EyeOff size={20} aria-hidden="true" />
                ) : (
                  <Eye size={20} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="sign-in__field">
            <label htmlFor="reset-confirmation">Confirm password</label>
            <div className="sign-in__password">
              <input
                ref={confirmationRef}
                id="reset-confirmation"
                name="confirmPassword"
                type={showConfirmation ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Enter password again"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-invalid={error === "mismatch" || undefined}
                aria-describedby={
                  error === "mismatch" ? "reset-error" : undefined
                }
                required
              />
              <button
                className="sign-in__password-toggle"
                type="button"
                aria-label={
                  showConfirmation
                    ? "Hide confirmed password"
                    : "Show confirmed password"
                }
                title={
                  showConfirmation
                    ? "Hide confirmed password"
                    : "Show confirmed password"
                }
                aria-controls="reset-confirmation"
                onClick={() => setShowConfirmation((visible) => !visible)}
              >
                {showConfirmation ? (
                  <EyeOff size={20} aria-hidden="true" />
                ) : (
                  <Eye size={20} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="sign-in__error" id="reset-error" role="alert">
              {messages[error]}
            </p>
          )}

          <Button type="submit" full>
            Reset password
          </Button>

          <p className="sign-in__switch">
            Need a new link?{" "}
            <Link to="/forgot-password">Request another link</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
