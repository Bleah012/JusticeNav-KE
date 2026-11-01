import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import "../pages/SeekerTools.css";

type AccountSettingsNavProps = {
  current: "profile" | "security";
};

// Scroll section links after React Router has rendered the destination page.
export function AccountSettingsNav({ current }: AccountSettingsNavProps) {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const sections = new Set([
      "profile-personal-information",
      "profile-contact-details",
      "profile-language",
      "account-security",
      "account-data",
    ]);
    const id = hash.slice(1);
    if (sections.has(id))
      document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [pathname, hash]);

  return (
    <nav aria-label="Account settings sections">
      <Link
        to="/app/profile#profile-personal-information"
        aria-current={current === "profile" ? "page" : undefined}
      >
        Personal information
      </Link>
      <Link to="/app/profile#profile-contact-details">Contact details</Link>
      <Link
        to="/app/privacy-security#account-security"
        aria-current={current === "security" ? "page" : undefined}
      >
        Security
      </Link>
      <Link to="/app/privacy-security#account-data">Privacy &amp; data</Link>
      <Link to="/app/notifications">Notifications</Link>
      <Link to="/app/profile#profile-language">
        Language &amp; accessibility
      </Link>
    </nav>
  );
}
