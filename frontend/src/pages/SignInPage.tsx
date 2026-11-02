import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react";
import { Link, Navigate } from "react-router";
import { Button } from "../components/ui/Button";
import "./SignInPage.css";
import { useAuth } from "../auth/useAuth";
import { signIn } from "../auth/firebaseClient";
import { workspaceFor } from "../auth/session";
import { useAuthAction } from "../auth/useAuthAction";
import { SessionPanel } from "../components/AuthSession";

// Sign in with Firebase, then wait for the backend to verify identity and role.
export function SignInPage() {
  const { session } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const { busy, error, message, run } = useAuthAction();
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(() => signIn(String(fields.get("email") ?? ""), String(fields.get("password") ?? "")));
  }
  if (session.status === "ready") return <Navigate to={workspaceFor(session.identity.role)} replace />;

  return (
    <div className="sign-in">
      <aside className="sign-in__aside" aria-labelledby="sign-in-intro">
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
          <h2 id="sign-in-intro">
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

        {session.hasSession || session.status === "loading" || session.status === "unconfigured" || session.status === "error" ? <section className="sign-in__form"><h1>Sign in to JusticeNav KE</h1><SessionPanel /></section> : (
        <form
          className="sign-in__form"
          onSubmit={handleSubmit}
          aria-labelledby="sign-in-title"
        >
          <span className="sign-in__badge">Welcome back</span>
          <h1 id="sign-in-title">Sign in to JusticeNav KE</h1>
          <p>Continue to your assessments, referrals and saved resources.</p>

          <div className="sign-in__field">
            <label htmlFor="sign-in-email">Email address</label>
            <input
              id="sign-in-email"
              name="email"
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              disabled={busy}
              required
            />
          </div>

          <div className="sign-in__field">
            <label htmlFor="sign-in-password">Password</label>
            <div className="sign-in__password">
              <input
                id="sign-in-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                disabled={busy}
              required
              />
              <button
                type="button"
                className="sign-in__password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                aria-controls="sign-in-password"
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

          <p className="auth-help">Your sign-in session is stored for this browser tab. Use a dedicated test account and a password you do not use elsewhere.</p>
          <div className="sign-in__options">
            <label title="This application uses the current tab session only">
              <input type="checkbox" name="remember" disabled />
              Remember me
            </label>
            <Link to="/forgot-password">Forgot password?</Link>
          </div>

          {message && <p className="auth-feedback" role="status">{message}</p>}
          {error && (
            <p className="sign-in__error" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" full disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
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
            New to JusticeNav KE? <Link to="/signup">Create account</Link>
          </p>
        </form>
        )}
      </main>
    </div>
  );
}
