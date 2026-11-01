import { SearchX } from "lucide-react";
import { Link } from "react-router";
import "./SeekerPages.css";
import "./SeekerTools.css";

// Offer fixed safe destinations without echoing unknown URLs or private query text.
export function NotFoundPage({
  seeker = false,
  admin = false,
}: {
  seeker?: boolean;
  admin?: boolean;
}) {
  return (
    <section
      className="seeker-tools__not-found"
      aria-labelledby="not-found-title"
    >
      <SearchX size={42} aria-hidden="true" />
      <span className="seeker-page__eyebrow">404</span>
      <h1 id="not-found-title">Page not found</h1>
      <p>
        The page you’re looking for could not be found. Check the address or use
        one of the links below.
      </p>
      <div className="seeker-page__actions">
        <Link
          className="btn btn-primary"
          to={admin ? "/admin" : seeker ? "/app" : "/"}
        >
          {admin
            ? "Return to overview"
            : seeker
              ? "Return to dashboard"
              : "Back to home"}
        </Link>
        <Link className="btn btn-secondary" to="/services">
          Explore justice services
        </Link>
      </div>
    </section>
  );
}
