import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Info, User } from "lucide-react";
import { Link } from "react-router";
import { AccountDataState } from "../components/AccountDataState";
import { Button } from "../components/ui/Button";
import type { AccountData, AccountProfile } from "../types/accountData";
import "./SeekerPages.css";
import "./AccountPages.css";

type ProfileError = {
  field: "fullName" | "email" | "language" | "form";
  message: string;
};

// Key this form by the loaded profile so edits do not carry across accounts.
function ProfileForm({ profile }: { profile: AccountProfile | null }) {
  const [error, setError] = useState<ProfileError | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const languageRef = useRef<HTMLSelectElement>(null);

  // Validate locally without submitting or storing profile entries.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!nameRef.current?.value.trim()) {
      setError({
        field: "fullName",
        message: "Enter your full name.",
      });
      nameRef.current?.focus();
      return;
    }

    if (
      !emailRef.current?.value.trim() ||
      emailRef.current.validity.typeMismatch
    ) {
      setError({
        field: "email",
        message: "Enter a valid email address.",
      });
      emailRef.current?.focus();
      return;
    }

    const language = languageRef.current?.value;

    if (language !== "en" && language !== "sw") {
      setError({
        field: "language",
        message: "Select a preferred language.",
      });
      languageRef.current?.focus();
      return;
    }

    setError({
      field: "form",
      message:
        "Profile saving is currently unavailable. Your changes have not been submitted or saved.",
    });
  }

  return (
    <form
      className="seeker-page__panel account-pages__profile-form"
      noValidate
      autoComplete="off"
      onSubmit={handleSubmit}
      onChange={() => setError(null)}
      aria-describedby="profile-prototype-note"
    >
      <div className="account-pages__identity">
        <User size={42} aria-hidden="true" />

        <div>
          <h2>{profile?.fullName || "Personal information"}</h2>
          <p>
            {profile?.email || "Account information is currently unavailable."}
          </p>
        </div>

        <Button
          variant="secondary"
          disabled
          title="Photo changes and uploads are currently unavailable."
        >
          Change photo
        </Button>
      </div>

      <div className="account-pages__form-grid">
        <div className="account-pages__field" id="profile-personal-information">
          <label htmlFor="profile-full-name">Full name</label>

          <input
            id="profile-full-name"
            name="fullName"
            ref={nameRef}
            defaultValue={profile?.fullName ?? ""}
            type="text"
            required
            maxLength={120}
            placeholder="Full name"
            spellCheck={false}
            aria-invalid={error?.field === "fullName" || undefined}
            aria-describedby={
              error?.field === "fullName" ? "profile-form-error" : undefined
            }
          />
        </div>

        <div className="account-pages__field" id="profile-contact-details">
          <label htmlFor="profile-email">Email address</label>

          <input
            id="profile-email"
            name="email"
            ref={emailRef}
            defaultValue={profile?.email ?? ""}
            type="email"
            required
            maxLength={254}
            placeholder="Email address"
            spellCheck={false}
            aria-invalid={error?.field === "email" || undefined}
            aria-describedby={
              error?.field === "email" ? "profile-form-error" : undefined
            }
          />
        </div>

        <div className="account-pages__field">
          <label htmlFor="profile-phone">Phone number (optional)</label>

          <input
            id="profile-phone"
            name="phone"
            type="tel"
            maxLength={32}
            defaultValue={profile?.phone ?? ""}
            aria-describedby="profile-phone-help"
          />

          <small id="profile-phone-help">
            No phone verification or SMS service is connected.
          </small>
        </div>

        <div className="account-pages__field" id="profile-language">
          <label htmlFor="profile-language-select">Preferred language</label>

          <select
            id="profile-language-select"
            name="preferredLanguage"
            required
            ref={languageRef}
            defaultValue={profile?.preferredLanguage ?? ""}
            aria-invalid={error?.field === "language" || undefined}
            aria-describedby={`profile-language-help${
              error?.field === "language" ? " profile-form-error" : ""
            }`}
          >
            <option value="">Select a language</option>
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>

          <small id="profile-language-help">
            This preference does not translate the current interface.
          </small>
        </div>
      </div>

      {error && (
        <p
          id="profile-form-error"
          className="account-pages__form-error"
          role="alert"
        >
          {error.message}
        </p>
      )}

      <div className="account-pages__form-actions">
        <Button type="submit">Save changes</Button>
      </div>
    </form>
  );
}

// Keep fields blank unless an authenticated backend supplies account values.
export function ProfilePage({
  data = { status: "unavailable" },
}: {
  data?: AccountData<AccountProfile>;
}) {
  const profile = data.status === "ready" ? data.value : null;
  const editable = data.status === "unavailable" || data.status === "ready";

  return (
    <>
      <header className="seeker-page__heading">
        <span className="seeker-page__eyebrow">Account settings</span>
        <h1>Profile</h1>
        <p>Manage your personal information and preferences.</p>
      </header>

      <div className="seeker-page__notice" id="profile-prototype-note">
        <Info size={20} aria-hidden="true" />

        <p>
          Account editing and saving are currently unavailable. Use
          non-sensitive test inputs only. Entries are used for local validation
          and are not submitted or saved. Changing the email field does not
          change a sign-in address.
        </p>
      </div>

      <div className="account-pages__settings">
        <nav aria-label="Account settings sections">
          <a href="#profile-personal-information">Personal information</a>

          <a href="#profile-contact-details">Contact details</a>

          <button
            type="button"
            disabled
            title="Security settings are not available yet."
          >
            Security
          </button>

          <Link to="/privacy">Privacy &amp; data</Link>

          <Link to="/app/notifications">Notifications</Link>

          <a href="#profile-language">Language &amp; accessibility</a>
        </nav>

        {editable ? (
          <ProfileForm key={JSON.stringify(profile)} profile={profile} />
        ) : (
          <AccountDataState
            subject="Profile information"
            status={data.status === "error" ? "error" : "loading"}
            retry={data.status === "error" ? data.retry : undefined}
          />
        )}
      </div>
    </>
  );
}
