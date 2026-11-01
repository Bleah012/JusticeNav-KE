import { Info } from "lucide-react";
import { Button } from "./ui/Button";

type AccountDataStateProps = {
  status: "unavailable" | "loading" | "error";
  subject: string;
  retry?: () => void;
};

// Distinguish missing integration, loading and failed requests without fake records.
export function AccountDataState({
  status,
  subject,
  retry,
}: AccountDataStateProps) {
  return (
    <section
      className="seeker-page__state"
      role={status === "error" ? "alert" : "status"}
    >
      <Info size={30} aria-hidden="true" />
      <h2>
        {status === "loading"
          ? `Loading ${subject}`
          : status === "error"
            ? `${subject} could not be loaded.`
            : `${subject} is currently unavailable.`}
      </h2>
      <p>
        {status === "loading"
          ? "Please wait while your account information is loaded."
          : status === "error"
            ? "Please try again later."
            : "Account services and saved records are not connected."}
      </p>
      {status === "error" && retry && (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </section>
  );
}
