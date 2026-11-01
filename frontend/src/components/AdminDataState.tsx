import { Info } from "lucide-react";
import { Button } from "./ui/Button";

// Show actual request states without treating absent data as zero records.
export function AdminDataState({
  status,
  subject,
  retry,
}: {
  status: "unavailable" | "loading" | "error" | "forbidden";
  subject: string;
  retry?: () => void;
}) {
  return (
    <div
      className="seeker-page__state"
      role={status === "error" || status === "forbidden" ? "alert" : "status"}
    >
      <Info size={28} aria-hidden="true" />
      <h2>
        {status === "loading"
          ? `Loading ${subject}`
          : status === "forbidden"
            ? "Access unavailable"
            : status === "error"
              ? `${subject} could not be loaded.`
              : `${subject} is currently unavailable.`}
      </h2>
      <p>
        {status === "forbidden"
          ? "You do not have permission to view this administrative information."
          : status === "loading"
            ? "Please wait while the information is loaded."
            : status === "error"
              ? "Please try again later."
              : "Administrative data services are not connected."}
      </p>
      {status === "error" && retry && (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
