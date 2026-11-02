import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Button } from "../components/ui/Button";
import "./SignInPage.css";
import "../components/AuthSession.css";
import { authError, checkReset, finishReset } from "../auth/firebaseClient";
import { useAuthAction } from "../auth/useAuthAction";

// Validate the one-time code with the configured Firebase project before accepting a password.
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [completed, setCompleted] = useState("");
  const code = params.getAll("oobCode").length === 1 && params.get("mode") === "resetPassword" ? params.get("oobCode") ?? "" : "";
  return <ResetPasswordForm key={code} code={code} completed={completed} onComplete={setCompleted} />;
}

// Remount when the link changes so a previous code cannot enable a different form.
function ResetPasswordForm({ code, completed, onComplete }: { code: string; completed: string; onComplete: (message: string) => void }) {
  const [, setSearchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const { busy, error, setError, message, run } = useAuthAction();
  const confirmationRef = useRef<HTMLInputElement>(null);
  const [verification, setVerification] = useState({ valid: false, message: code ? "Checking your reset link…" : "Open the password reset link from your email, or request a new link." });
  useEffect(() => {
    let current = true;
    if (code && !completed) void checkReset(code).then(() => {
      if (current) setVerification({ valid: true, message: "Your reset link is valid. Choose a new password." });
    }).catch((cause) => {
      if (current) setVerification({ valid: false, message: authError(cause) });
    });
    return () => { current = false; };
  }, [code, completed]);
  const canReset = Boolean(code) && verification.valid && !busy && !message && !completed;
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canReset) return;
    if (password !== confirmation) {
      setError("Passwords do not match."); confirmationRef.current?.focus(); return;
    }
    void run(async () => {
      const result = await finishReset(code, password);
      setPassword(""); setConfirmation("");
      onComplete(result);
      setSearchParams({}, { replace: true });
      return result;
    });
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
          onInput={() => setError("")}
          aria-labelledby="reset-title"
        >
          <span className="sign-in__badge">Account recovery</span>
          <h1 id="reset-title">Reset your password</h1>
          <p>Choose a new password and confirm it below.</p>
          <p className="auth-feedback" role="status">{completed || message || verification.message}</p>
          {completed && <Link to="/login">Sign in</Link>}

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
                disabled={!canReset}
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
                aria-invalid={error === "Passwords do not match." || undefined}
                aria-describedby={
                  error === "Passwords do not match." ? "reset-error" : undefined
                }
                disabled={!canReset}
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
              {error}
            </p>
          )}

          <Button type="submit" full disabled={!canReset}>
            {busy ? "Resetting password…" : "Reset password"}
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
