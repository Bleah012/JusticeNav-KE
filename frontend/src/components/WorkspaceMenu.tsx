import { useRef } from "react";
import type { ReactNode } from "react";

// Share native mobile disclosure behavior across the three workspace shells.
export function WorkspaceMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  return (
    <details
      ref={ref}
      className="seeker-shell__mobile-nav"
      onClick={(event) => {
        // Close for a chosen destination, including links to the current page.
        if (event.target instanceof Element && event.target.closest("a[href]"))
          event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          event.preventDefault();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary>Menu</summary>
      {children}
    </details>
  );
}
