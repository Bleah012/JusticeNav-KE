import { Link } from "react-router";
import { Button } from "./ui/Button";
import type { ChecklistState } from "../checklists/ChecklistResource";

export function ChecklistFeedback<T>({ state, reload, dirty = false }: { state: ChecklistState<T>; reload: () => void; dirty?: boolean }) {
  if (state.status === "loading") return <p role="status">Loading checklist information...</p>;
  if (state.status === "error") return <section className="assessment-entry__error" role="alert"><p>{state.message}</p><Button variant="secondary" onClick={reload}>Try again</Button> <Link to="/app/checklists">My Checklists</Link></section>;
  return <>
    {dirty ? <p role="status">You have unsaved checklist changes.</p> : state.notice && <p role="status">{state.notice}</p>}
    {state.error && <p className="assessment-entry__error" role="alert">{state.error}</p>}
    {state.needsReload && <div><Button variant="secondary" onClick={reload}>Reload saved checklist</Button><p>Reloading replaces your unsaved ticks. <Link to="/app/checklists">My Checklists</Link></p></div>}
  </>;
}
