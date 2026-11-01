import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

// Start client-side page changes at the heading without disturbing filters or anchors.
export function RouteNavigation() {
  const { pathname, hash } = useLocation();
  const previousPath = useRef(pathname);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;

    // Native anchors and the account/provider section handlers own hash navigation.
    if (hash) return;

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [pathname, hash]);

  return null;
}
