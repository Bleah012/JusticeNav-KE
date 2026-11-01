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
import { AppBrand } from "./AppBrand";
import { WorkspaceMenu } from "./WorkspaceMenu";
import "./SeekerLayout.css";

const navigation = [
  {
    label: "Dashboard",
    to: "/app",
    icon: Home,
    end: true,
  },
  {
    label: "Find My Next Step",
    to: "/app/assessments/new",
    icon: Sparkles,
  },
  {
    label: "My Assessments",
    to: "/app/assessments",
    icon: FileText,
    end: true,
  },
  {
    label: "My Referrals",
    to: "/app/referrals",
    icon: Route,
  },
  {
    label: "Justice Services",
    to: "/services",
    icon: Building2,
  },
  {
    label: "Checklists",
    to: "/app/checklists",
    icon: ClipboardCheck,
    end: true,
  },
  {
    label: "Resources",
    to: "/resources",
    icon: FileText,
  },
  {
    label: "Notifications",
    to: "/app/notifications",
    icon: Mail,
  },
  {
    label: "Profile",
    to: "/app/profile",
    icon: User,
  },
  {
    label: "Privacy & Security",
    to: "/app/privacy-security",
    icon: Lock,
  },
];

// Share seeker destinations across desktop and mobile navigation.
function Navigation() {
  return (
    <nav className="seeker-shell__nav" aria-label="Seeker navigation">
      {navigation.map(({ label, to, icon: Icon, end }) => (
        <NavLink key={label} to={to} end={end}>
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
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
        <AppBrand />
        <Navigation />

        <p className="seeker-shell__disclaimer">
          <Info size={18} aria-hidden="true" />
          JusticeNav KE provides navigation support, not legal advice.
        </p>
      </aside>

      <div className="seeker-shell__body">
        <header className="seeker-shell__topbar">
          <div className="seeker-shell__mobile-brand">
            <AppBrand />
          </div>

          <span className="seeker-shell__preview">Student prototype</span>

          <Link to="/login">Sign in</Link>
        </header>

        <WorkspaceMenu>
          <Navigation />
        </WorkspaceMenu>

        <main id="main-content" className="seeker-shell__content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
