import { Link, Navigate, Outlet } from "react-router";
import { useAuth } from "../auth/useAuth";
import { unavailableMessage, workspaceFor } from "../auth/session";
import type { Role } from "../auth/session";
import "./AuthSession.css";
export function SessionActions() {
  const { session, logout } = useAuth();
  return <div className="auth-actions">
  {session.status === "ready" && <Link to={workspaceFor(session.identity.role)}>Dashboard</Link>}
  {session.hasSession ? <button type="button" disabled={session.status === "signing-out"} onClick={() => void logout()}>{session.status === "signing-out" ? "Signing out…" : "Sign out"}</button> : <Link to="/login">Sign in</Link>}
 </div>;
}
export function SessionPanel() {
  const { session, retry } = useAuth();
  const message = session.status === "unconfigured" ? unavailableMessage
    : session.status === "error" ? session.message
      : session.status === "ready" ? "You are signed in."
        : session.status === "signing-out" ? "Signing out…"
          : "Checking your application session…";
  return <section className="auth-panel" aria-label="Account session">
  <p role={session.status === "error" || session.status === "unconfigured" ? "alert" : "status"}>{message}</p>
  {session.status === "error" && session.hasSession && <button className="btn btn-secondary" type="button" onClick={retry}>Retry verification</button>}
  <SessionActions />
 </section>;
}
// Backend authorization remains mandatory for every future data endpoint.
export function RequireSession({ roles }: {
  roles?: Role[];
}) {
  const { session } = useAuth();
  if (session.status === "guest")
    return <Navigate to="/login" replace/>;
  if (session.status === "ready" && (!roles || roles.includes(session.identity.role)))
    return <Outlet />;
  const denied = session.status === "ready";
  return <main className="auth-gate" id="main-content" tabIndex={-1}>
  <h1>{denied ? "Access unavailable" : "Your account"}</h1>
  {denied && <p role="alert">Your verified account role cannot open this workspace.</p>}
  <SessionPanel />
  <Link to="/">Back to home</Link>
 </main>;
}
