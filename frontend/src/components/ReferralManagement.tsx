import { useState } from "react";
import { useNavigate } from "react-router";
import {
  acknowledgement,
  referralTime,
  validateContact,
} from "../referrals/referralApi";
import type {
  Contact,
  ManagedReferral,
  createReferralApi,
} from "../referrals/referralApi";
import type {
  ReferralResource,
  ReferralState,
} from "../referrals/ReferralResource";
import { ReferralFeedback } from "./ReferralFeedback";
import "../pages/ReferralRequestPage.css";

export function ReferralManagement({
  state,
  resource,
  api,
}: {
  state: Extract<ReferralState<ManagedReferral>, { status: "ready" }>;
  resource: ReferralResource<ManagedReferral>;
  api: ReturnType<typeof createReferralApi>;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<Contact>({
    ...state.value.record,
    acknowledged: false,
  });
  const [validation, setValidation] = useState("");
  const busy = state.saving || state.needsReload;
  const reload = () => void resource.reload();
  const messages = {
    conflict:
      "This request changed or has been shared. Reload before continuing.",
    unconfirmed:
      "The change could not be confirmed. Reload this referral to check its saved state before trying again.",
  };
  const field = (key: keyof Contact, value: string | boolean) =>
    setContact((previous) => ({ ...previous, [key]: value }));
  return (
    <section className="referral-management" aria-label="Manage saved referral">
      <h3>Manage saved request</h3>
      <p>
        You can edit contact details and the description, or delete a request,
        before it is shared for demonstration. Shared requests keep their
        history, including after withdrawal.
      </p>
      {state.value.record.revision > 1 && (
        <p>
          Last updated:{" "}
          <time dateTime={state.value.record.updatedAt}>
            {referralTime(state.value.record.updatedAt)}
          </time>
        </p>
      )}
      <ReferralFeedback state={state} reload={reload} />
      {!state.value.canModify ? (
        <p>
          This request has been shared. Editing and deletion are unavailable.
          You can create a new request if needed.
        </p>
      ) : editing ? (
        <form
          className="referral-request__form"
          onSubmit={async (event) => {
            event.preventDefault();
            const clean = {
              ...contact,
              fullName: contact.fullName.trim(),
              email: contact.email.trim(),
              phone: contact.phone?.trim() || null,
              description: contact.description.trim(),
            };
            const error = validateContact(clean);
            setValidation(error);
            if (error) return;
            const saved = await resource.mutate(
              async (current, signal) => ({
                record: await api.update(current.record, clean, signal),
                canModify: true,
              }),
              {
                ...messages,
                success: "Your changes were saved privately in JusticeNav KE.",
              },
            );
            if (saved) setEditing(false);
          }}
        >
          <fieldset disabled={busy} className="referral-management__fields">
            <legend>Edit private request details</legend>
            <label className="referral-request__field">
              Full name
              <input
                value={contact.fullName}
                maxLength={120}
                required
                autoComplete="name"
                onChange={(event) => field("fullName", event.target.value)}
              />
            </label>
            <label className="referral-request__field">
              Email
              <input
                type="email"
                value={contact.email}
                maxLength={254}
                required
                autoComplete="email"
                onChange={(event) => field("email", event.target.value)}
              />
            </label>
            <label className="referral-request__field">
              Phone (optional unless selected)
              <input
                type="tel"
                value={contact.phone ?? ""}
                maxLength={16}
                autoComplete="tel"
                placeholder="+254700000000"
                onChange={(event) => field("phone", event.target.value)}
              />
            </label>
            <label className="referral-request__field">
              Preferred contact method
              <select
                value={contact.contactMethod}
                onChange={(event) => field("contactMethod", event.target.value)}
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
            </label>
            <label className="referral-request__field">
              Description
              <textarea
                value={contact.description}
                maxLength={1500}
                required
                rows={5}
                onChange={(event) => field("description", event.target.value)}
              />
            </label>
            <label className="referral-request__consent">
              <input
                type="checkbox"
                checked={contact.acknowledged}
                onChange={(event) =>
                  field("acknowledged", event.target.checked)
                }
              />
              <span>{acknowledgement}</span>
            </label>
          </fieldset>
          {validation && <p role="alert">{validation}</p>}
          <div className="referral-management__actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Save changes
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={state.saving}
              onClick={() => setEditing(false)}
            >
              Cancel editing
            </button>
          </div>
        </form>
      ) : (
        <div className="referral-management__actions">
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              setContact({ ...state.value.record, acknowledged: false });
              setValidation("");
              setEditing(true);
            }}
          >
            Edit request
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  "Delete this private referral request? This cannot be undone. Historical notifications may remain, but their link will no longer open this request.",
                )
              )
                return;
              const result = await resource.mutate(
                async (current, signal) => {
                  await api.remove(current.record, signal);
                  return current;
                },
                { ...messages, success: "Referral deleted." },
              );
              if (result) navigate("/app/referrals", { replace: true });
            }}
          >
            Delete request
          </button>
        </div>
      )}
      <button
        className="btn btn-secondary"
        disabled={state.saving}
        onClick={reload}
      >
        Reload referral
      </button>
    </section>
  );
}
