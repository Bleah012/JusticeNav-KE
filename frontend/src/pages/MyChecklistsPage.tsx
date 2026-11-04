import { ClipboardCheck, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { validId } from "../assessments/assessmentApi";
import { checklistStatuses, validStatus } from "../checklists/checklistApi";
import type { ChecklistStatus } from "../checklists/checklistApi";
import { useChecklistList } from "../checklists/useChecklists";
import { ChecklistFeedback } from "../components/ChecklistFeedback";
import { referralDate as formatDate } from "../types/referralData";
import "./SeekerPages.css";
import "./AccountPages.css";
import "./SeekerTools.css";

function ChecklistList({ uid, status, after }: { uid: string; status?: ChecklistStatus; after?: string }) {
  const { state, resource } = useChecklistList(uid, status, after);
  const [params, setParams] = useSearchParams();
  function page(cursor?: string) { const next = new URLSearchParams(params); if (cursor) next.set("after", cursor); else next.delete("after"); setParams(next); }
  return <>
    {state.status !== "ready" ? <ChecklistFeedback state={state} reload={() => void resource.reload()}/> : <>
      <p role="status">{state.value.checklists.length} {state.value.checklists.length === 1 ? "checklist" : "checklists"} on this page</p>
      {state.value.checklists.length ? <ul className="account-pages__assessments" aria-label="Saved checklists">{state.value.checklists.map((record) => <li key={record.id}><ClipboardCheck size={24} aria-hidden="true"/><div><h2>{record.pathwayTitle} preparation</h2><span className="seeker-page__badge">{checklistStatuses[record.status]}</span><div className="seeker-tools__checklist-progress"><p>{record.completedItems} of {record.totalItems} items complete</p>{record.totalItems > 0 && <progress value={record.completedItems} max={record.totalItems} aria-label={`${record.completedItems} of ${record.totalItems} preparation items saved complete`}/>}</div><p>Last updated <time dateTime={record.updatedAt}>{formatDate(record.updatedAt)}</time></p></div><Link className="btn btn-secondary" to={`/app/checklists/${record.id}`}>View checklist</Link></li>)}</ul> : <section className="seeker-page__state"><ClipboardCheck size={30} aria-hidden="true"/><h2>{status ? "No checklists match this status." : "No saved checklists to display."}</h2><p>{status ? "Choose another status to see your checklists." : "Create a checklist from a pathway and save your preparation progress."}</p></section>}
      {state.value.nextCursor && <button className="btn btn-secondary" type="button" onClick={() => page(state.value.nextCursor ?? undefined)}>Next page</button>}
    </>}
    {after && <button className="btn btn-secondary" type="button" onClick={() => page()}>First page</button>}
  </>;
}
export function MyChecklistsPage() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status"), rawAfter = params.get("after");
  const status = validStatus(rawStatus) ? rawStatus : undefined;
  const after = validId(rawAfter) ? rawAfter : undefined;
  return <>
    <header className="seeker-page__heading account-pages__heading"><div><span className="seeker-page__eyebrow">Preparation</span><h1>My Checklists</h1><p>Review your saved preparation checklists and progress.</p></div><Link className="btn btn-primary" to="/app/checklists/new"><Plus size={18} aria-hidden="true"/>Create checklist</Link></header>
    <div className="account-pages__toolbar"><label htmlFor="checklist-status-filter">Status</label><select id="checklist-status-filter" value={status ?? "all"} onChange={(event) => { const next = new URLSearchParams(params); next.delete("after"); if (event.target.value === "all") next.delete("status"); else next.set("status", event.target.value); setParams(next, { replace: true }); }}><option value="all">All checklists</option>{Object.entries(checklistStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    {session.status === "ready" ? <ChecklistList key={`${session.identity.uid}:${status ?? "all"}:${after ?? "first"}`} uid={session.identity.uid} status={status} after={after}/> : <p role="status">Verify your session to load saved checklists.</p>}
  </>;
}
