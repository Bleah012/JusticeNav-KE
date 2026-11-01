import type { ReactNode } from "react";
import {
  Building2,
  ClipboardCheck,
  FileText,
  Home,
  Info,
  Lock,
  Mail,
  Route,
  Sparkles,
  User,
} from "lucide-react";
import { Link, NavLink } from "react-router";
import "./SeekerLayout.css";

const navigation = [
  { label: "Dashboard", to: "/app", icon: Home, end: true },
  { label: "Find My Next Step", to: "/app/assessments/new", icon: Sparkles },
  { label: "My Assessments", icon: FileText },
  { label: "My Referrals", to: "/app/referrals", icon: Route },
  { label: "Justice Services", to: "/services", icon: Building2 },
  { label: "Checklists", to: "/app/checklists/new", icon: ClipboardCheck },
  { label: "Resources", to: "/resources", icon: FileText },
  { label: "Notifications", icon: Mail },
  { label: "Profile", icon: User },
  { label: "Privacy & Security", icon: Lock },
];

// Reuse the reference brand without inventing a signed-in identity.
function Brand() {
  return (
    <Link
      className="seeker-shell__brand"
      to="/"
      aria-label="JusticeNav KE home"
    >
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
  );
}

// Keep unfinished destinations disabled instead of navigating to blank pages.
function Navigation() {
  return (
    <nav className="seeker-shell__nav" aria-label="Seeker navigation">
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

// This shell is a frontend preview; it does not authenticate or authorize users.
export function SeekerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="seeker-shell">
      <a className="seeker-shell__skip" href="#main-content">
        Skip to content
      </a>
      <aside className="seeker-shell__sidebar">
        <Brand />
        <Navigation />
        <p className="seeker-shell__disclaimer">
          <Info size={18} aria-hidden="true" />
          JusticeNav KE provides navigation support, not legal advice.
        </p>
      </aside>
      <div className="seeker-shell__body">
        <header className="seeker-shell__topbar">
          <div className="seeker-shell__mobile-brand">
            <Brand />
          </div>
          <span className="seeker-shell__preview">Student prototype</span>
          <Link to="/login">Sign in</Link>
        </header>
        <details className="seeker-shell__mobile-nav">
          <summary>Menu</summary>
          <Navigation />
        </details>
        <main id="main-content" className="seeker-shell__content">
          {children}
        </main>
      </div>
    </div>
  );
}
