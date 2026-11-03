import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Check, Info } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { AssessmentFeedback } from "../components/AssessmentFeedback";
import { Button } from "../components/ui/Button";
import { useAuth } from "../auth/useAuth";
import { validId } from "../assessments/assessmentApi";
import type { Answers } from "../assessments/assessmentApi";
import { useAssessmentRecord } from "../assessments/useAssessment";
import "./AssessmentClarificationPage.css";
const issueOptions = [["consumer", "Consumer"], ["money-debt", "Money / Debt"], ["other", "Something else"]] as const;
const timeframeOptions = [["recent", "Within the last 3 months"], ["months", "3–12 months ago"], ["older", "More than a year ago"], ["unsure", "Not sure"]] as const;
const contactOptions = [["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]] as const;
type Editor = ReturnType<typeof useAssessmentRecord>;
function ClarificationHeading() {
  return <>
  <div className="assessment-entry__title assessment-clarification__title"><h1>Help us understand your situation</h1><p>Your answers help us show more relevant information.</p></div>
  <div className="assessment-entry__prototype" role="note" id="assessment-prototype-note"><Info size={18} aria-hidden="true"/><p>These fixed questions are not AI-generated. Save &amp; exit saves partial answers; Continue saves all three answers. Use non-sensitive development inputs. Continue opens published links based only on your saved issue category; your description is not analysed.</p></div>
 </>;
}
function ClarificationForm({ editor, id }: {
  editor: Editor;
  id: string;
}) {
  const { state, resource, api } = editor;
  const initial = state.status === "ready" ? state.value?.answers : null;
  const [answers, setAnswers] = useState<Answers>(initial ?? { issue: null, timeframe: null, contact: null });
  const [error, setError] = useState<"issue" | "timeframe" | "contact" | null>(null);
  const issueRef = useRef<HTMLInputElement>(null), timeframeRef = useRef<HTMLSelectElement>(null), contactRef = useRef<HTMLSelectElement>(null);
  const navigate = useNavigate();
  if (state.status !== "ready" || !state.value)
    return null;
  const answeredCount = Object.values(answers).filter(Boolean).length;
  const update = (part: Partial<Answers>) => { setAnswers((previous) => ({ ...previous, ...part })); setError(null); };
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "ready" || state.saving || state.needsReload)
      return;
    const exit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "exit";
    if (!exit) {
      for (const [field, ref] of [["issue", issueRef], ["timeframe", timeframeRef], ["contact", contactRef]] as const) {
        if (!answers[field]) {
          setError(field);
          ref.current?.focus();
          return;
        }
      }
    }
    setError(null);
    const saved = await resource.mutate((previous, signal) => api.save(id, { step: "clarify", answers, proceed: !exit }, previous?.revision ?? 0, signal));
    if (saved)
      navigate(exit ? "/app/assessments" : `/app/assessments/${id}/results`);
  }
  return <>
  <div className="assessment-clarification__meta" id="clarification-progress-label"><span>{answeredCount} of 3 questions answered on this page</span><strong>{Math.round(answeredCount / 3 * 100)}% complete</strong></div>
  <progress className="assessment-clarification__progress" value={answeredCount} max={3} aria-labelledby="clarification-progress-label"/>
  <ClarificationHeading />
  <form id="assessment-clarification-form" onSubmit={handleSubmit} noValidate aria-busy={state.saving}>
   <fieldset className="assessment-clarification__question" aria-describedby={error === "issue" ? "clarification-error" : undefined} disabled={state.saving}><legend>What type of issue best describes your situation?</legend><div className="assessment-clarification__options">{issueOptions.map(([value, label], index) => <label key={value}><input ref={index === 0 ? issueRef : undefined} type="radio" name="clarification-issue" value={value} checked={answers.issue === value} required aria-invalid={error === "issue" || undefined} onChange={() => update({ issue: value })}/><span>{label}</span><Check size={18} aria-hidden="true"/></label>)}</div></fieldset>
   <div className="assessment-clarification__fields">
    <label><span>When did the problem occur?</span><select ref={timeframeRef} value={answers.timeframe ?? ""} required disabled={state.saving} aria-invalid={error === "timeframe" || undefined} aria-describedby={error === "timeframe" ? "clarification-error" : undefined} onChange={(event) => update({ timeframe: event.target.value as Answers["timeframe"] })}><option value="" disabled>Select a timeframe</option>{timeframeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>Have you contacted the other party?</span><select ref={contactRef} value={answers.contact ?? ""} required disabled={state.saving} aria-invalid={error === "contact" || undefined} aria-describedby={error === "contact" ? "clarification-error" : undefined} onChange={(event) => update({ contact: event.target.value as Answers["contact"] })}><option value="" disabled>Select an answer</option>{contactOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
   </div>
   {error && <p className="assessment-entry__error" id="clarification-error" role="alert">{error === "issue" ? "Choose the type of issue that best describes your situation." : error === "timeframe" ? "Select when the problem occurred, or choose Not sure." : "Select whether you contacted the other party, or choose Not sure."}</p>}
   <AssessmentFeedback state={state} reload={() => void resource.reload()}/>
   <div className="assessment-entry__actions"><Link className="btn btn-ghost" to={`/app/assessments/${id}/describe`}>Back</Link><Button type="submit" name="intent" value="continue" icon={ArrowRight} disabled={state.saving || state.needsReload}>{state.saving ? "Saving…" : "Continue"}</Button></div>
  </form>
 </>;
}
function ClarificationAccount({ uid, id }: {
  uid: string;
  id: string;
}) {
  const editor = useAssessmentRecord(uid, id, false);
  const { state, resource } = editor;
  return <AssessmentLayout step={2} saveFormId={state.status === "ready" ? "assessment-clarification-form" : undefined} saveDisabled={state.status !== "ready" || state.saving || state.needsReload}>
  {state.status === "ready" ? <ClarificationForm key={`${id}:${state.value?.revision ?? 0}`} editor={editor} id={id}/> : <><ClarificationHeading /><AssessmentFeedback state={state} reload={() => void resource.reload()}/></>}
 </AssessmentLayout>;
}
export function AssessmentClarificationPage() {
  const { session } = useAuth();
  const { assessmentId } = useParams();
  if (!validId(assessmentId))
    return <AssessmentLayout step={2}><h1>Open a saved assessment</h1><p id="assessment-prototype-note">Choose an assessment before answering clarification questions.</p><Link className="btn btn-secondary" to="/app/assessments">My Assessments</Link></AssessmentLayout>;
  return session.status === "ready" ? <ClarificationAccount key={`${session.identity.uid}:${assessmentId}`} uid={session.identity.uid} id={assessmentId}/> : <p role="status">Verify your session to open assessments.</p>;
}
