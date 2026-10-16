import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react";
import { Link } from "react-router";
import { Button } from "../components/ui/Button";
import "./SignInPage.css";
import "./SignUpPage.css";

const messages = {
  name: "Enter your full name.",
  mismatch: "Passwords do not match.",
  unavailable:
    "Account creation is currently unavailable. Please try again later.",
};

// Validate account details without creating or persisting an account.
export function SignUpPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<keyof typeof messages | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  // Reject blank names and mismatched passwords before reporting unavailable signup.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!nameRef.current?.value.trim()) {
      setError("name");
      nameRef.current?.focus();
      return;
    }

    if (password !== confirmation) {
      setError("mismatch");
      confirmationRef.current?.focus();
      return;
    }

    setError("unavailable");
  }

  return (
    <div className="sign-in sign-up">
      <aside className="sign-in__aside" aria-labelledby="sign-up-intro">
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
          <h2 id="sign-up-intro">
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
          onInput={() => setError(null)}
          aria-labelledby="sign-up-title"
        >
          <span className="sign-in__badge">Create your account</span>
          <h1 id="sign-up-title">Start your justice journey</h1>
          <p>Save your progress, checklists and referral updates securely.</p>

          <div className="sign-in__field">
            <label htmlFor="sign-up-name">Full name</label>
            <input
              ref={nameRef}
              id="sign-up-name"
              name="fullName"
              type="text"
              autoComplete="name"
              placeholder="Enter your full name"
              aria-invalid={error === "name" || undefined}
              aria-describedby={error === "name" ? "sign-up-error" : undefined}
              required
            />
          </div>

          <div className="sign-in__field">
            <label htmlFor="sign-up-email">Email address</label>
            <input
              id="sign-up-email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="sign-in__field">
            <label htmlFor="sign-up-password">Password</label>
            <div className="sign-in__password">
              <input
                id="sign-up-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="sign-in__password-toggle"
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                aria-controls="sign-up-password"
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
            <label htmlFor="sign-up-confirmation">Confirm password</label>
            <div className="sign-in__password">
              <input
                ref={confirmationRef}
                id="sign-up-confirmation"
                name="confirmPassword"
                type={showConfirmation ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Enter password again"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-invalid={error === "mismatch" || undefined}
                aria-describedby={
                  error === "mismatch" ? "sign-up-error" : undefined
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
                aria-controls="sign-up-confirmation"
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

          <div className="sign-in__field">
            <label htmlFor="sign-up-phone">Phone number (optional)</label>
            <input
              id="sign-up-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+254..."
            />
          </div>

          <div className="sign-up__agreement">
            <input
              id="sign-up-agreement"
              name="agreement"
              type="checkbox"
              required
            />
            <label htmlFor="sign-up-agreement">
              I agree to the <Link to="/terms">Terms</Link> and{" "}
              <Link to="/privacy">Privacy Notice.</Link>
            </label>
          </div>

          {error && (
            <p className="sign-in__error" id="sign-up-error" role="alert">
              {messages[error]}
            </p>
          )}

          <Button type="submit" full>
            Create account
          </Button>

          <div className="sign-in__divider" aria-hidden="true">
            <span>or</span>
          </div>

          <Button
            variant="secondary"
            full
            disabled
            title="Available when Google authentication is connected"
          >
            Continue with Google
          </Button>

          <p className="sign-in__switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>

          <p className="sign-up__notice">
            Only provide information necessary to use the service. Do not submit
            highly sensitive information unless required.
          </p>
        </form>
      </main>
    </div>
  );
}
