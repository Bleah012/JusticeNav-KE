import type { ComponentPropsWithoutRef } from "react";
import type { LucideIcon } from "lucide-react";
import "./Button.css";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: LucideIcon;
  full?: boolean;
};

// Render a reusable button without changing its supplied wording.
export function Button({
  children,
  variant = "primary",
  icon: Icon,
  full = false,
  type = "button",
  className = "",
  ...props
}: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, full ? "btn-full" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button {...props} type={type} className={classes}>
      {children}
      {Icon && <Icon size={18} aria-hidden="true" />}
    </button>
  );
}
