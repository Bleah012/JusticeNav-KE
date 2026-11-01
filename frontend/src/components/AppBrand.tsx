import { Link } from "react-router";

// Share the original brand asset between seeker and administrative navigation.
export function AppBrand() {
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
