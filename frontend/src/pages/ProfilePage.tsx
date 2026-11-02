import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { Info, User } from "lucide-react";
import { AccountSettingsNav } from "../components/AccountSettingsNav";
import { Button } from "../components/ui/Button";
import { createAuthenticatedRequest } from "../api/authenticatedRequest";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { useAuth } from "../auth/useAuth";
import { createProfileApi } from "../profile/profileModel";
import { ProfileController } from "../profile/ProfileController";
import type { ProfileState } from "../profile/ProfileController";
import "./SeekerPages.css";
import "./AccountPages.css";
type ReadyProfile = Extract<ProfileState, {
  status: "ready";
}>;
type FormError = {
  field: "fullName" | "phone" | "language";
  message: string;
};
// Keep the design's fields while making only application profile data writable.
function ProfileForm({ state, controller, email, displayName }: {
  state: ReadyProfile;
  controller: ProfileController;
  email: string;
  displayName: string;
}) {
  const [error, setError] = useState<FormError | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const languageRef = useRef<HTMLSelectElement>(null);
  const profile = state.profile;
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.saving || state.needsReload)
      return;
    const fullName = nameRef.current?.value.trim() ?? "";
    const phone = phoneRef.current?.value.trim() || null;
    const preferredLanguage = languageRef.current?.value;
    if (!fullName || fullName.length > 120 || /\p{Cc}/u.test(fullName)) {
      setError({ field: "fullName", message: "Enter a full name of up to 120 characters without control characters." });
      nameRef.current?.focus();
      return;
    }
    if (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      setError({ field: "phone", message: "Use international phone format starting with +, or leave the field blank." });
      phoneRef.current?.focus();
      return;
    }
    if (preferredLanguage !== "en" && preferredLanguage !== "sw") {
      setError({ field: "language", message: "Select a preferred language." });
      languageRef.current?.focus();
      return;
    }
    setError(null);
    void controller.save({ fullName, phone, preferredLanguage });
  }
  return <form className="seeker-page__panel account-pages__profile-form" noValidate autoComplete="off" onSubmit={handleSubmit} onChange={() => setError(null)} aria-describedby="profile-prototype-note" aria-busy={state.saving}>
  <div className="account-pages__identity">
   <User size={42} aria-hidden="true"/>
   <div><h2>{profile?.fullName || "Personal information"}</h2><p>{email || "Email address unavailable."}</p></div>
   <Button variant="secondary" disabled title="Photo changes and uploads are currently unavailable.">Change photo</Button>
  </div>
  {!profile && <p className="profile-persistence__status">Your profile has not been saved yet. Complete the fields and select Save changes.</p>}
  {state.notice && <p className="profile-persistence__status" role="status">{state.notice}</p>}
  <div className="account-pages__form-grid">
   <div className="account-pages__field" id="profile-personal-information">
    <label htmlFor="profile-full-name">Full name</label>
    <input id="profile-full-name" name="fullName" ref={nameRef} defaultValue={profile?.fullName ?? displayName} type="text" required maxLength={120} placeholder="Full name" spellCheck={false} disabled={state.saving} aria-invalid={error?.field === "fullName" || undefined} aria-describedby={error?.field === "fullName" ? "profile-form-error" : undefined}/>
   </div>
   <div className="account-pages__field" id="profile-contact-details">
    <label htmlFor="profile-email">Email address</label>
    <input id="profile-email" name="email" value={email} type="email" readOnly placeholder="Email address" spellCheck={false} aria-describedby="profile-email-help"/>
    <small id="profile-email-help">Your sign-in address is read-only here.</small>
   </div>
   <div className="account-pages__field">
    <label htmlFor="profile-phone">Phone number (optional)</label>
    <input id="profile-phone" name="phone" ref={phoneRef} type="tel" maxLength={16} defaultValue={profile?.phone ?? ""} disabled={state.saving} aria-invalid={error?.field === "phone" || undefined} aria-describedby={`profile-phone-help${error?.field === "phone" ? " profile-form-error" : ""}`}/>
    <small id="profile-phone-help">Use international format starting with +. No phone verification or SMS service is connected.</small>
   </div>
   <div className="account-pages__field" id="profile-language">
    <label htmlFor="profile-language-select">Preferred language</label>
    <select id="profile-language-select" name="preferredLanguage" required ref={languageRef} defaultValue={profile?.preferredLanguage ?? ""} disabled={state.saving} aria-invalid={error?.field === "language" || undefined} aria-describedby={`profile-language-help${error?.field === "language" ? " profile-form-error" : ""}`}>
     <option value="">Select a language</option><option value="en">English</option><option value="sw">Kiswahili</option>
    </select>
    <small id="profile-language-help">This preference does not translate the current interface.</small>
   </div>
  </div>
  {(error || state.error) && <p id="profile-form-error" className="account-pages__form-error" role="alert">{error?.message || state.error}</p>}
  <div className="account-pages__form-actions profile-persistence__actions">
   <Button type="button" variant="secondary" disabled={state.saving} title="Reloading replaces unsaved edits with the latest saved profile." onClick={() => void controller.reload()}>Reload profile</Button>
   <Button type="submit" disabled={state.saving || state.needsReload}>{state.saving ? "Saving…" : "Save changes"}</Button>
  </div>
  <p className="profile-persistence__help">Reload profile replaces unsaved edits with the latest saved information.</p>
 </form>;
}
// A new account gets a separate controller and draft; stale responses are discarded on unmount.
function ProfileAccount({ uid }: {
  uid: string;
}) {
  const [controller] = useState(() => new ProfileController(createProfileApi(uid, createAuthenticatedRequest({ baseUrl: backendUrl, currentUser: () => firebaseAuth().currentUser }))));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => controller.start(), [controller]);
  const user = firebaseAuth().currentUser;
  const ownUser = user?.uid === uid ? user : null;
  return <>
  <header className="seeker-page__heading"><span className="seeker-page__eyebrow">Account settings</span><h1>Profile</h1><p>Manage your personal information and preferences.</p></header>
  <div className="seeker-page__notice" id="profile-prototype-note"><Info size={20} aria-hidden="true"/><p>Your name, optional phone number and language preference are saved to your private JusticeNav profile when you select Save changes. Use non-sensitive development inputs. Your sign-in email is read-only; saving this form does not change your password or account role.</p></div>
  <div className="account-pages__settings">
   <AccountSettingsNav current="profile"/>
   {state.status === "ready" ? <ProfileForm key={`${uid}:${state.profile?.revision ?? 0}`} state={state} controller={controller} email={ownUser?.email ?? ""} displayName={ownUser?.displayName ?? ""}/> : <section className="seeker-page__state" role={state.status === "error" ? "alert" : "status"}><Info size={30} aria-hidden="true"/><h2>{state.status === "loading" ? "Loading Profile information" : "Profile information could not be loaded."}</h2><p>{state.status === "error" ? state.message : "Please wait while your account information is loaded."}</p>{state.status === "error" && <Button variant="secondary" onClick={() => void controller.reload()}>Try again</Button>}</section>}
  </div>
 </>;
}
export function ProfilePage() {
  const { session } = useAuth();
  return session.status === "ready" ? <ProfileAccount key={session.identity.uid} uid={session.identity.uid}/> : <p role="status">Verify your session to load your profile.</p>;
}
