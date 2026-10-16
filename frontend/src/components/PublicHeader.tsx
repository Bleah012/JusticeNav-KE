import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Link, NavLink } from "react-router";
import "./ui/Button.css";
import "./PublicHeader.css";

// Render the approved public header with accessible mobile navigation.
export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    headerRef.current
      ?.querySelector<HTMLAnchorElement>("#public-navigation a")
      ?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !headerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <header className="public-header" ref={headerRef}>
      <div className="public-header__inner">
        <Link
          className="public-header__brand"
          to="/"
          onClick={closeMenu}
          aria-label="JusticeNav KE home"
        >
          <svg
            className="public-header__mark"
            viewBox="0 0 40 40"
            aria-hidden="true"
          >
            <rect width="40" height="40" rx="12" />
            <path
              d="M12 28V15.5c0-2.5 2-4.5 4.5-4.5S21 13 21 15.5v9c0 2 1.6 3.5 3.5 3.5S28 26.4 28 24.5V12"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="m24.5 15 3.5-3.5 3.5 3.5"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>
            JusticeNav <strong>KE</strong>
          </span>
        </Link>
        <nav
          id="public-navigation"
          className={`public-header__nav${open ? " is-open" : ""}`}
          aria-label="Main navigation"
        >
          <NavLink to="/" end onClick={closeMenu}>
            Home
          </NavLink>
          <a href="/#how-it-works" onClick={closeMenu}>
            How it works
          </a>
          <NavLink to="/services" onClick={closeMenu}>
            Justice services
          </NavLink>
          <NavLink to="/resources" onClick={closeMenu}>
            Resources
          </NavLink>
          <a href="/#about" onClick={closeMenu}>
            About
          </a>
          <Link
            className="public-header__mobile-action"
            to="/login"
            onClick={closeMenu}
          >
            Sign in
          </Link>
          <Link
            className="btn btn-primary public-header__mobile-action"
            to="/app/assessments/new"
            onClick={closeMenu}
          >
            Find my next step
          </Link>
        </nav>
        <div className="public-header__actions">
          <Link className="public-header__signin" to="/login">
            Sign in
          </Link>
          <Link
            className="btn btn-primary public-header__start"
            to="/app/assessments/new"
          >
            Find my next step
          </Link>
          <button
            ref={menuRef}
            className="public-header__toggle"
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="public-navigation"
            title={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((previous) => !previous)}
          >
            {open ? (
              <X size={24} aria-hidden="true" />
            ) : (
              <Menu size={24} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
