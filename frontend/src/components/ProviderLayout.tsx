import { useEffect } from "react";
import type { ReactNode } from "react";
import { Building2, ClipboardList, FileText, Home, Info } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router";
import { AppBrand } from "./AppBrand";
import { SessionActions } from "./AuthSession";
import { WorkspaceMenu } from "./WorkspaceMenu";
import "./SeekerLayout.css";
import "../pages/SeekerPages.css";
import "../pages/AdminPages.css";
import "../pages/WorkspacePages.css";

function ProviderNavigation() {
  return (
    <nav className="seeker-shell__nav" aria-label="Provider navigation">
      <NavLink to="/provider" end>
        <Home size={18} aria-hidden="true" />
        <span>Overview</span>
      </NavLink>
      <Link to="/provider#provider-assigned-referrals">
        <ClipboardList size={18} aria-hidden="true" />
        <span>Assigned referrals</span>
      </Link>
      <Link to="/services">
        <Building2 size={18} aria-hidden="true" />
        <span>Justice services</span>
      </Link>
      <Link to="/resources">
        <FileText size={18} aria-hidden="true" />
        <span>Resources</span>
      </Link>
    </nav>
  );
}

// A verified provider role does not establish membership of a service or access to a referral.
export function ProviderLayout({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash === "#provider-assigned-referrals")
      document
        .getElementById("provider-assigned-referrals")
        ?.scrollIntoView({ block: "start" });
  }, [pathname, hash]);
  return (
    <div className="seeker-shell provider-shell">
      <a className="seeker-shell__skip" href="#main-content">
        Skip to content
      </a>
      <aside className="seeker-shell__sidebar">
        <AppBrand />
        <span className="admin-pages__role">
          Service provider · demonstration
        </span>
        <ProviderNavigation />
        <p className="seeker-shell__disclaimer">
          <Info size={18} aria-hidden="true" />
          JusticeNav KE provides navigation support, not legal advice.
        </p>
        <Link className="admin-pages__user-link" to="/">
          View public site
        </Link>
      </aside>
      <div className="seeker-shell__body">
        <header className="seeker-shell__topbar">
          <div className="seeker-shell__mobile-brand">
            <AppBrand />
          </div>
          <span className="seeker-shell__preview">Provider demonstration</span>
          <SessionActions />
        </header>
        <WorkspaceMenu>
          <ProviderNavigation />
          <Link className="admin-pages__user-link" to="/">
            View public site
          </Link>
        </WorkspaceMenu>
        <main id="main-content" className="seeker-shell__content" tabIndex={-1}>
          <div className="seeker-page__notice">
            <Info size={20} aria-hidden="true" />
            <p>
              Use this workspace to review assigned school demonstrations for
              your development service membership.
            </p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
