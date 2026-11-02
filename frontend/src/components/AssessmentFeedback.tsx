import { Link } from "react-router";
import { Button } from "./ui/Button";
import type { ResourceState } from "../assessments/AssessmentResource";
export function AssessmentFeedback<T>({ state, reload }: {
  state: ResourceState<T>;
  reload: () => void;
}) {
  if (state.status === "loading")
    return <p role="status">Loading your assessment information…</p>;
  if (state.status === "error")
    return <section className="assessment-entry__error" role="alert"><p>{state.message}</p><Button type="button" variant="secondary" onClick={reload}>Try again</Button> <Link to="/app/assessments">My Assessments</Link></section>;
  return <>
  {state.notice && <p role="status">{state.notice}</p>}
  {state.error && <p role="alert" className="assessment-entry__error">{state.error}</p>}
  {state.needsReload && <div><Button type="button" variant="secondary" onClick={reload}>Reload saved assessment</Button><p>Reloading replaces unsaved edits. <Link to="/app/assessments">My Assessments</Link></p></div>}
 </>;
}
