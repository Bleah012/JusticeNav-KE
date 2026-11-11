import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

// Focus the heading on page changes and when a Home link requests a scroll reset.
export function RouteNavigation() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(location.pathname);

  useEffect(() => {
    const { pathname, search, hash, state } = location;
    const pathChanged = previousPath.current !== pathname;
    previousPath.current = pathname;
    const homeRequested =
      pathname === "/" && !search && navigationType !== "POP" &&
      state?.scrollToHome === true;

    // Native anchors and the account/provider section handlers own hash navigation.
    if (hash || (!pathChanged && !homeRequested)) return;

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [location, navigationType]);

  return null;
}
