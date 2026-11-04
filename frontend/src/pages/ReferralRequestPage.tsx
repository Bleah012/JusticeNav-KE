import { useState } from "react";
import type { FormEvent } from "react";
import { Info } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { backendUrl } from "../auth/firebaseClient";
import { validId } from "../assessments/assessmentApi";
import { validServiceId } from "../catalog/catalogApi";
import { usePublicResource } from "../catalog/usePublicResource";
import { createPathwayApi } from "../pathways/pathwayApi";
import { acknowledgement, validateContact } from "../referrals/referralApi";
import type { Contact } from "../referrals/referralApi";
import { useReferralEditor } from "../referrals/useReferrals";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { ReferralFeedback } from "../components/ReferralFeedback";
import { PathwaySources } from "../components/PathwaySources";
import { Button } from "../components/ui/Button";
import "./ReferralRequestPage.css";

function Heading() { return <><div className="assessment-entry__title referral-request__title"><span className="assessment-entry__badge">Referral request</span><h1>Request assistance</h1><p>Prepare a request within the JusticeNav KE student project.</p></div><div className="assessment-entry__prototype" id="assessment-prototype-note" role="note"><Info size={18} aria-hidden="true"/><p>Save referral request or Save &amp; exit stores your request privately in your account. It does not send information to an institution, email address or phone number. Use non-sensitive test inputs. Unsaved entries are lost when you leave or refresh.</p></div></>; }
function RequestForm({ editor }: { editor: ReturnType<typeof useReferralEditor> }) {
  const { state, api, resource } = editor;
  const [contact, setContact] = useState<Contact>({ fullName: "", email: "", phone: null, contactMethod: "email", description: "", acknowledged: false });
  const [error, setError] = useState("");
  const navigate = useNavigate();
  if (state.status !== "ready") return null;
  const { id, selection, record } = state.value;
  if (record) return <section><h2>This request is already saved</h2><p>No new request was created by opening this page.</p><Link className="btn btn-primary" to={`/app/referrals/${record.id}/confirmation`}>View saved confirmation</Link></section>;
  const disabled = state.saving || state.needsReload;
  function update<K extends keyof Contact>(key: K, value: Contact[K]) { setContact((previous) => ({ ...previous, [key]: value })); setError(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return;
    const exit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "exit";
    const problem = validateContact({ ...contact, fullName: contact.fullName.trim(), email: contact.email.trim(), phone: contact.phone?.trim() || null, description: contact.description.trim() });
    if (problem) { setError(problem); const form = event.currentTarget; const key = !contact.fullName.trim() ? "fullName" : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim()) ? "email" : contact.contactMethod === "phone" && !contact.phone || contact.phone && !/^\+[1-9][0-9]{7,14}$/.test(contact.phone.trim()) ? "phone" : !contact.description.trim() ? "description" : !contact.acknowledged ? "acknowledged" : "fullName"; (form.elements.namedItem(key) as HTMLElement | null)?.focus(); return; }
    const saved = await resource.mutate(async (previous, signal) => ({ ...previous, record: await api.save(id, previous.selection, contact, signal) }));
    if (saved?.record) navigate(exit ? "/app/referrals" : `/app/referrals/${saved.record.id}/confirmation`, { replace: true });
  }
  return <><PathwaySources review={selection.sourceReview}/><form id="saved-referral-form" className="referral-request__form" onSubmit={submit} noValidate aria-busy={state.saving} aria-describedby="referral-form-error">
    <section className="referral-request__section"><h2>Your information</h2><fieldset disabled={disabled} className="referral-request__fields"><legend className="sr-only">Contact details for this project request</legend><div className="referral-request__grid">
      <label className="referral-request__field">Full name<input name="fullName" value={contact.fullName} onChange={(e) => update("fullName", e.target.value)} maxLength={120} required autoComplete="off"/></label>
      <label className="referral-request__field">Email address<input name="email" type="email" value={contact.email} onChange={(e) => update("email", e.target.value)} maxLength={254} required autoComplete="off"/></label>
      <label className="referral-request__field">Phone number {contact.contactMethod === "phone" ? "(required)" : "(optional)"}<input name="phone" type="tel" value={contact.phone ?? ""} onChange={(e) => update("phone", e.target.value)} maxLength={16} required={contact.contactMethod === "phone"} autoComplete="off"/><small>International format, such as +254 followed by the number.</small></label>
      <label className="referral-request__field">Preferred contact method<select name="contactMethod" value={contact.contactMethod} onChange={(e) => update("contactMethod", e.target.value as "email" | "phone")}><option value="email">Email</option><option value="phone">Phone call</option></select><small>Recorded preference only. No contact or verification message is sent.</small></label>
    </div></fieldset></section>
    <section className="referral-request__section"><h2>Request details</h2><div className="referral-request__grid"><div className="referral-request__field">Selected pathway<output className="referral-request__selected">{selection.pathway.title}</output></div><div className="referral-request__field">Selected service<output className="referral-request__selected">{selection.service.name}</output></div></div><label className="referral-request__field">Brief description<textarea name="description" value={contact.description} onChange={(e) => update("description", e.target.value)} maxLength={1500} disabled={disabled} required/></label><output className="referral-request__count">{contact.description.length} / 1,500 characters</output></section>
    <div className="referral-request__privacy"><Info size={18} aria-hidden="true"/><div><strong>Only provide information necessary for the referral.</strong><p>Remove passwords, PINs, full financial details and unrelated personal information.</p></div></div>
    <label className="referral-request__consent"><input name="acknowledged" type="checkbox" checked={contact.acknowledged} onChange={(e) => update("acknowledged", e.target.checked)} disabled={disabled} required/><span>{acknowledgement}</span></label>
    <p id="referral-form-error" role={error ? "alert" : undefined}>{error}</p><ReferralFeedback state={state} reload={() => void resource.reload()}/>
    <p className="referral-request__privacy-link"><Link to="/privacy">Privacy Notice</Link></p><div className="assessment-entry__actions referral-request__actions"><Link className="btn btn-secondary" to={`/pathways/${selection.pathway.id}`}>Back</Link><Button type="submit" disabled={disabled}>{state.saving ? "Saving..." : "Save referral request"}</Button></div>
  </form></>;
}
function AllocateRequest({ pathwayId }: { pathwayId: string }) {
  const [id] = useState(() => crypto.randomUUID().replaceAll("-", ""));
  return <Navigate replace to={`/app/referrals/new?pathwayId=${pathwayId}&requestId=${id}`}/>;
}
function RequestAccount({ uid, pathwayId, requestId }: { uid: string; pathwayId: string; requestId: string }) {
  const editor = useReferralEditor(uid, requestId, pathwayId);
  return <AssessmentLayout step={5} saveFormId={editor.state.status === "ready" && !editor.state.value.record ? "saved-referral-form" : undefined} saveDisabled={editor.state.status !== "ready" || editor.state.saving || editor.state.needsReload}><Heading/>{editor.state.status === "ready" ? <RequestForm editor={editor}/> : <ReferralFeedback state={editor.state} reload={() => void editor.resource.reload()}/>}<Link className="btn btn-ghost" to="/app/referrals">My Referrals</Link></AssessmentLayout>;
}
function ChoosePathway({ serviceId }: { serviceId?: string }) {
  const { state, retry } = usePublicResource((signal) => createPathwayApi(backendUrl).list(signal));
  return <AssessmentLayout step={5}><Heading/><h2>Choose a pathway</h2>{state.status === "loading" ? <p role="status">Loading pathway information...</p> : state.status !== "ready" ? <section role="alert"><p>Pathway information could not be loaded.</p><Button variant="secondary" onClick={retry}>Try again</Button></section> : <ul className="preparation-checklist__choices">{state.value.filter((pathway) => !serviceId || pathway.serviceId === serviceId).map((pathway) => <li key={pathway.id}><Link className="btn btn-secondary btn-full" to={`/app/referrals/new?pathwayId=${pathway.id}`}>{pathway.title}</Link></li>)}{!state.value.some((pathway) => !serviceId || pathway.serviceId === serviceId) && <li>No related pathways are currently listed.</li>}</ul>}<Link className="btn btn-secondary" to="/services">Explore justice services</Link></AssessmentLayout>;
}
export function ReferralRequestPage() {
  const { session } = useAuth(); const [params] = useSearchParams();
  const pathwayId = params.get("pathwayId"), serviceId = params.get("serviceId"), requestId = params.get("requestId");
  if (pathwayId !== null && !validServiceId(pathwayId) || serviceId !== null && !validServiceId(serviceId) || requestId !== null && (!validId(requestId) || !pathwayId)) return <AssessmentLayout step={5}><Heading/><h2>Request information could not be opened</h2><Link to="/app/referrals">My Referrals</Link></AssessmentLayout>;
  if (!pathwayId) return <ChoosePathway key={serviceId ?? "all"} serviceId={serviceId ?? undefined}/>;
  if (session.status !== "ready") return <p role="status">Verify your session to open referral requests.</p>;
  if (!requestId) return <AllocateRequest key={`${session.identity.uid}:${pathwayId}`} pathwayId={pathwayId}/>;
  return <RequestAccount key={`${session.identity.uid}:${pathwayId}:${requestId}`} uid={session.identity.uid} pathwayId={pathwayId} requestId={requestId}/>;
}
