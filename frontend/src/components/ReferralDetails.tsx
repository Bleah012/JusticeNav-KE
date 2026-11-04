import { Link } from "react-router";
import { referralTime } from "../referrals/referralApi";
import type { Referral } from "../referrals/referralApi";
export function ReferralDetails({
  record,
  privateDetails = false,
}: {
  record: Referral;
  privateDetails?: boolean;
}) {
  return (
    <>
      <dl className="seeker-page__details">
        <div>
          <dt>Referral ID</dt>
          <dd>{record.id}</dd>
        </div>
        <div>
          <dt>Project status</dt>
          <dd>Saved in JusticeNav KE</dd>
        </div>
        <div>
          <dt>Institutional delivery</dt>
          <dd>Not sent to an institution</dd>
        </div>
        <div>
          <dt>Date saved (Kenya)</dt>
          <dd>
            <time dateTime={record.savedAt}>
              {referralTime(record.savedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Service</dt>
          <dd>{record.selection.service.name}</dd>
        </div>
        <div>
          <dt>Pathway</dt>
          <dd>{record.selection.pathway.title}</dd>
        </div>
      </dl>
      {privateDetails && (
        <>
          <h2>Your saved information</h2>
          <dl className="seeker-page__details">
            <div>
              <dt>Full name</dt>
              <dd>{record.fullName}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{record.email}</dd>
            </div>
            <div>
              <dt>Phone number</dt>
              <dd>{record.phone ?? "Not supplied"}</dd>
            </div>
            <div>
              <dt>Preferred contact method</dt>
              <dd>
                {record.contactMethod === "phone" ? "Phone call" : "Email"}{" "}
                (unverified; no message sent)
              </dd>
            </div>
            <div>
              <dt>Brief description</dt>
              <dd className="referral-saved-description">
                {record.description}
              </dd>
            </div>
          </dl>
        </>
      )}
      <p>
        Contact the organisation through its official channels for assistance.
        Saving this record does not establish acceptance or representation.
      </p>
      <Link
        className="btn btn-secondary"
        to={`/services/${record.selection.service.id}`}
      >
        View current service information
      </Link>
    </>
  );
}
