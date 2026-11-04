import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Info } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { backendUrl } from "../auth/firebaseClient";
import { validId } from "../assessments/assessmentApi";
import { validServiceId } from "../catalog/catalogApi";
import { usePublicResource } from "../catalog/usePublicResource";
import { createPathwayApi } from "../pathways/pathwayApi";
import { useChecklistEditor } from "../checklists/useChecklists";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { ChecklistFeedback } from "../components/ChecklistFeedback";
import { PathwaySources } from "../components/PathwaySources";
import { Button } from "../components/ui/Button";
import "./PreparationChecklistPage.css";

type Editor = ReturnType<typeof useChecklistEditor>;
function Heading() {
  return <><div className="assessment-entry__title preparation-checklist__title"><span className="assessment-entry__badge">Preparation checklist</span><h1>Prepare before you contact the service</h1><p>Save your checklist and reopen it from My Checklists.</p></div>
    <div className="assessment-entry__prototype" id="assessment-prototype-note" role="note"><Info size={18} aria-hidden="true"/><p>Save checklist or Save &amp; exit stores your ticks in your account. Unsaved edits are lost on refresh or departure. Ticks record your preparation progress; they do not validate documents or submit a referral.</p></div></>;
}
function ChecklistForm({ editor }: { editor: Editor }) {
  const { state, resource, api } = editor;
  const initial = state.status === "ready" ? state.value.record?.checkedIds ?? [] : [];
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(initial));
  const navigate = useNavigate();
  if (state.status !== "ready") return null;
  const { id, template, record } = state.value;
  const dirty = [...checked].some((id) => !initial.includes(id)) || checked.size !== initial.length;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || state.saving || state.needsReload) return;
    const exit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "exit";
    const saved = await resource.mutate(async (previous, signal) => {
      const record = await api.save(id, previous.template, [...checked], previous.record?.revision ?? 0, signal);
      return { id, template: previous.template, record };
    });
    if (saved) navigate(exit ? "/app/checklists" : `/app/checklists/${id}`, { replace: true });
  }
  function toggle(id: string) { setChecked((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <>
    <PathwaySources review={template.sourceReview}/>
    <p className="catalog-source-note">{record ? "Your saved checklist." : "This checklist has not been saved yet."} Items are a copy of the guide shown when the checklist is created. Confirm current requirements through the sources.</p>
    <div className="preparation-checklist__layout"><section className="preparation-checklist__tool" aria-labelledby="preparation-list-title">
      <div className="preparation-checklist__head"><div><span className="assessment-entry__badge">Preparation checklist</span><h2 id="preparation-list-title">{template.pathwayTitle} preparation</h2><p>Review prompts based on official sources; not a complete filing checklist.</p></div><output className="preparation-checklist__count" aria-live="polite" aria-label={`${checked.size} of ${template.items.length} preparation items selected`}><span>{checked.size}/{template.items.length}</span><small>complete</small></output></div>
      {template.items.length > 0 ? <progress className="preparation-checklist__progress" value={checked.size} max={template.items.length} aria-label="Current preparation selection"/> : <p role="status">No preparation items are recorded in this guide.</p>}
      <form id="saved-checklist-form" onSubmit={submit} aria-busy={state.saving}>
        <fieldset className="preparation-checklist__items" disabled={state.saving}><legend className="preparation-checklist__sr-only">Preparation items</legend>{template.items.map((item) => <label key={item.id}><input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)}/><span><strong>{item.label}</strong><small>{item.note}</small></span></label>)}</fieldset>
        <ChecklistFeedback state={state} dirty={dirty} reload={() => void resource.reload()}/>
        <div className="preparation-checklist__buttons"><Button variant="secondary" type="submit" disabled={state.saving || state.needsReload}>{state.saving ? "Saving..." : "Save checklist"}</Button><Button icon={ArrowRight} disabled title="Referral submission is currently unavailable.">Continue to referral</Button></div>
      </form>
    </section><aside className="preparation-checklist__aside"><div className="preparation-checklist__why" role="note"><Info size={20} aria-hidden="true"/><div><h2>Why prepare?</h2><p>Having relevant information ready may make it easier for a service to understand your request. Only share what is necessary.</p></div></div><section className="preparation-checklist__related"><h2>Related pathway</h2><p>{template.pathwayTitle}</p><Link to={`/pathways/${template.pathwayId}`}>View current pathway <ArrowRight size={16} aria-hidden="true"/></Link></section></aside></div>
  </>;
}
function ChecklistAccount({ uid, savedId, pathwayId }: { uid: string; savedId?: string; pathwayId?: string }) {
  const [id] = useState(() => savedId ?? crypto.randomUUID().replaceAll("-", ""));
  const editor = useChecklistEditor(uid, id, savedId ? undefined : pathwayId);
  const { state, resource } = editor;
  return <AssessmentLayout step={4} saveFormId={state.status === "ready" ? "saved-checklist-form" : undefined} saveDisabled={state.status !== "ready" || state.saving || state.needsReload}>
    <Heading/>
    {state.status === "ready" ? <ChecklistForm key={`${id}:${state.value.record?.revision ?? 0}`} editor={editor}/> : <ChecklistFeedback state={state} reload={() => void resource.reload()}/>}
    <div className="assessment-entry__actions preparation-checklist__navigation"><Link className="btn btn-ghost" to="/app/checklists">My Checklists</Link><Link className="btn btn-secondary" to="/services">Explore justice services</Link></div>
  </AssessmentLayout>;
}
function ChoosePathway() {
  const { state, retry } = usePublicResource((signal) => createPathwayApi(backendUrl).list(signal));
  return <AssessmentLayout step={4}><Heading/><h2>Choose a pathway</h2>{state.status === "loading" ? <p role="status">Loading pathway information...</p> : state.status !== "ready" ? <section role="alert"><p>Pathway information could not be loaded.</p><Button variant="secondary" onClick={retry}>Try again</Button></section> : <ul className="preparation-checklist__choices">{state.value.map((pathway) => <li key={pathway.id}><Link className="btn btn-secondary btn-full" to={`/app/checklists/new?pathwayId=${pathway.id}`}>{pathway.title}</Link></li>)}{state.value.length === 0 && <li>No pathways are currently listed.</li>}</ul>}<Link className="btn btn-secondary" to="/app/checklists">My Checklists</Link></AssessmentLayout>;
}
export function PreparationChecklistPage() {
  const { session } = useAuth();
  const { checklistId } = useParams();
  const [params] = useSearchParams();
  const pathwayId = params.get("pathwayId");
  if (checklistId && !validId(checklistId) || !checklistId && pathwayId !== null && !validServiceId(pathwayId)) return <AssessmentLayout step={4}><Heading/><h2>Checklist information could not be opened.</h2><Link to="/app/checklists">My Checklists</Link></AssessmentLayout>;
  if (!checklistId && !pathwayId) return <ChoosePathway/>;
  return session.status === "ready" ? <ChecklistAccount key={`${session.identity.uid}:${checklistId ?? `new:${pathwayId}`}`} uid={session.identity.uid} savedId={checklistId} pathwayId={pathwayId ?? undefined}/> : <p role="status">Verify your session to open checklists.</p>;
}
