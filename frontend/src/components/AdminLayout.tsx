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
import "./SeekerLayout.css";
import "../pages/SeekerPages.css";
import "../pages/AdminPages.css";

const navigation = [
  { label: "Overview", to: "/admin", icon: Home, end: true },
  { label: "Users", icon: Users },
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

// Preview navigation provides no administrator authorization or access to private data.
export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="seeker-shell admin-shell">
      <a className="seeker-shell__skip" href="#main-content">
        Skip to content
      </a>
      <aside className="seeker-shell__sidebar">
        <AppBrand />
        <span className="admin-pages__role">Administrator · preview</span>
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
          <Link to="/login">Sign in</Link>
        </header>
        <details className="seeker-shell__mobile-nav">
          <summary>Menu</summary>
          <AdminNavigation />
          <Link className="admin-pages__user-link" to="/app">
            Switch to user view
          </Link>
        </details>
        <main id="main-content" className="seeker-shell__content">
          <div className="seeker-page__notice" id="admin-prototype-note">
            <Info size={20} aria-hidden="true" />
            <p>
              Administrative preview only. Authentication, administrator role
              checks and management services are not connected. No changes are
              saved, published, archived or verified.
            </p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
