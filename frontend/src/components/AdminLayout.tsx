import type { ReactNode } from "react";
import {
  Building2,
  ClipboardList,
  Clock,
  Home,
  Info,
  Route,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link, NavLink } from "react-router";
import { AppBrand } from "./AppBrand";
import { SessionActions } from "./AuthSession";
import { WorkspaceMenu } from "./WorkspaceMenu";
import "./SeekerLayout.css";
import "../pages/SeekerPages.css";
import "../pages/AdminPages.css";

const navigation = [
  { label: "Overview", to: "/admin", icon: Home, end: true },
  { label: "Users", to: "/admin/users", icon: Users },
  { label: "Justice Services", to: "/admin/services", icon: Building2 },
  { label: "Pathways", to: "/admin/pathways", icon: Route },
  { label: "Referrals", to: "/admin/referrals", icon: ClipboardList },
  {
    label: "Content Verification",
    to: "/admin/verification",
    icon: ShieldCheck,
  },
  { label: "Audit Logs", to: "/admin/audit-logs", icon: Clock },
];

// Keep unfinished administrative destinations disabled rather than aliasing other pages.
function AdminNavigation() {
  return (
    <nav className="seeker-shell__nav" aria-label="Administrative navigation">
      {navigation.map(({ label, to, icon: Icon, end }) =>
        to ? (
          <NavLink key={label} to={to} end={end}>
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ) : (
          <button
            key={label}
            type="button"
            disabled
            title="This page is not available yet."
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ),
      )}
    </nav>
  );
}

// Verify role on the route and each catalogue API request; editing remains unavailable.
export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="seeker-shell admin-shell">
      <a className="seeker-shell__skip" href="#main-content">
        Skip to content
      </a>
      <aside className="seeker-shell__sidebar">
        <AppBrand />
        <span className="admin-pages__role">Administrator Â· preview</span>
        <AdminNavigation />
        <p className="seeker-shell__disclaimer">
          <Info size={18} aria-hidden="true" />
          JusticeNav KE provides navigation support, not legal advice.
        </p>
        <Link className="admin-pages__user-link" to="/app">
          Switch to user view
        </Link>
      </aside>
      <div className="seeker-shell__body">
        <header className="seeker-shell__topbar">
          <div className="seeker-shell__mobile-brand">
            <AppBrand />
          </div>
          <span className="seeker-shell__preview">Administrative preview</span>
          <SessionActions />
        </header>
        <WorkspaceMenu>
          <AdminNavigation />
          <Link className="admin-pages__user-link" to="/app">
            Switch to user view
          </Link>
        </WorkspaceMenu>
        <main id="main-content" className="seeker-shell__content" tabIndex={-1}>
          <div className="seeker-page__notice" id="admin-prototype-note">
            <Info size={20} aria-hidden="true" />
            <p>
              Your administrator role is checked by the API. Overview, Justice
              Services and Pathways show read-only published catalogue
              information. Referrals lets you assign school demonstrations
              shared by seekers.
            </p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
