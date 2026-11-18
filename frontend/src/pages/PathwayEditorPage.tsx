import { useParams } from "react-router";
import { PathwayManagement } from "../components/PathwayManagement";

// Connect both existing editor routes to confirmed administrative records.
export function PathwayEditorPage() {
  const { pathwayId } = useParams();
  return (
    <PathwayManagement
      mode={pathwayId ? "edit" : "new"}
      pathwayId={pathwayId}
    />
  );
}
