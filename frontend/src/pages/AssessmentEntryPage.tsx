import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, ChevronDown, Info, ShieldCheck, Sparkles } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { AssessmentFeedback } from "../components/AssessmentFeedback";
import { Button } from "../components/ui/Button";
import { useAuth } from "../auth/useAuth";
import { validId } from "../assessments/assessmentApi";
import { useAssessmentRecord } from "../assessments/useAssessment";
const characterLimit = 1500;
const examples = ["I bought a phone and the seller refuses to repair or refund it.", "Someone owes me KSh 200,000 and refuses to pay."];
type Editor = ReturnType<typeof useAssessmentRecord>;
function DescriptionForm({ editor, id }: {
  editor: Editor;
  id: string;
}) {
  const { state, resource, api } = editor;
  const record = state.status === "ready" ? state.value : null;
  const [description, setDescription] = useState(record?.description ?? "");
  const [showExamples, setShowExamples] = useState(false);
  const [error, setError] = useState("");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  if (state.status !== "ready")
    return null;
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || state.saving || state.needsReload)
      return;
    if (!description.trim() || description.length > characterLimit) {
      setError(!description.trim() ? "Describe what happened before continuing." : "Keep your description within 1,500 characters.");
      descriptionRef.current?.focus();
      return;
    }
    setError("");
    const exit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "exit";
    const saved = await resource.mutate((previous, signal) => api.save(id, { step: "describe", description, proceed: !exit }, previous?.revision ?? 0, signal));
    if (saved)
      navigate(exit ? "/app/assessments" : `/app/assessments/${saved.id}/clarify`);
  }
  return <form id="assessment-description-form" onSubmit={handleSubmit} noValidate aria-busy={state.saving}>
  <div className="assessment-entry__field">
   <label htmlFor="assessment-description">Describe your problem</label>
   <textarea ref={descriptionRef} id="assessment-description" value={description} maxLength={characterLimit} required autoComplete="off" spellCheck={false} disabled={state.saving} aria-invalid={Boolean(error) || undefined} aria-describedby={`assessment-character-count assessment-privacy-note assessment-prototype-note${error ? " assessment-error" : ""}`} onChange={(event) => { setDescription(event.target.value); setError(""); }} placeholder="Describe your situation in your own words."/>
   <small id="assessment-character-count">{description.length.toLocaleString("en-KE")} / 1,500 characters</small>
  </div>
  <div className="assessment-entry__privacy" role="note" id="assessment-privacy-note"><ShieldCheck size={20} aria-hidden="true"/><div><strong>Protect your privacy</strong><p>Avoid sharing passwords, PINs, ID numbers or full financial details.</p></div></div>
  {record && <p>Changing your description clears its previous clarification answers when you save.</p>}
  <button className="assessment-entry__example-toggle" type="button" disabled={state.saving} aria-expanded={showExamples} aria-controls="assessment-examples" onClick={() => setShowExamples((shown) => !shown)}><span>Not sure what to write? See examples</span><ChevronDown size={16} aria-hidden="true"/></button>
  <div id="assessment-examples" hidden={!showExamples}><ul className="assessment-entry__examples" role="list">{examples.map((example) => <li key={example}><button type="button" disabled={state.saving} onClick={() => { setDescription(example); setError(""); descriptionRef.current?.focus(); }}>&ldquo;{example}&rdquo;</button></li>)}</ul></div>
  {error && <p className="assessment-entry__error" id="assessment-error" role="alert">{error}</p>}
  <AssessmentFeedback state={state} reload={() => void resource.reload()}/>
  <div className="assessment-entry__actions"><Link className="btn btn-ghost" to="/app/assessments">Back</Link><Button type="submit" name="intent" value="continue" icon={ArrowRight} disabled={state.saving || state.needsReload}>{state.saving ? "Saving…" : "Continue"}</Button></div>
 </form>;
}
function DescriptionAccount({ uid, assessmentId }: {
  uid: string;
  assessmentId?: string;
}) {
  const [id] = useState(() => assessmentId ?? crypto.randomUUID().replaceAll("-", ""));
  const editor = useAssessmentRecord(uid, id, !assessmentId);
  const { state, resource } = editor;
  return <AssessmentLayout step={1} saveFormId={state.status === "ready" ? "assessment-description-form" : undefined} saveDisabled={state.status !== "ready" || state.saving || state.needsReload}>
  <div className="assessment-entry__title"><span className="assessment-entry__badge"><Sparkles size={14} aria-hidden="true"/>AI-assisted navigation</span><h1>What happened?</h1><p>Describe your situation in your own words. You do not need to use legal terms.</p></div>
  <div className="assessment-entry__prototype" role="note" id="assessment-prototype-note"><Info size={18} aria-hidden="true"/><p>Continue and Save &amp; exit save your description to your private assessment. Use non-sensitive development inputs. Leaving without saving discards edits. AI classification and pathway processing are not connected.</p></div>
  {state.status === "ready" ? <DescriptionForm key={`${id}:${state.value?.revision ?? 0}`} editor={editor} id={id}/> : <AssessmentFeedback state={state} reload={() => void resource.reload()}/>}
 </AssessmentLayout>;
}
export function AssessmentEntryPage() {
  const { session } = useAuth();
  const { assessmentId } = useParams();
  if (assessmentId && !validId(assessmentId))
    return <p role="alert">Assessment not found. <Link to="/app/assessments">My Assessments</Link></p>;
  return session.status === "ready" ? <DescriptionAccount key={`${session.identity.uid}:${assessmentId ?? "new"}`} uid={session.identity.uid} assessmentId={assessmentId}/> : <p role="status">Verify your session to open assessments.</p>;
}
