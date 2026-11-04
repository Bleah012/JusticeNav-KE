import { Link, useParams } from "react-router";
import { useAuth } from "../auth/useAuth";
import { validId } from "../assessments/assessmentApi";
import { useReferralRecord } from "../referrals/useReferrals";
import { ReferralDetails } from "../components/ReferralDetails";
import { ReferralFeedback } from "../components/ReferralFeedback";
import "./SeekerPages.css";
function Confirmation({ uid, id }: { uid: string; id: string }) {
  const { state, resource } = useReferralRecord(uid, id);
  return <main id="main-content" className="referral-confirmation"><span className="seeker-page__badge">Referral confirmation</span><h1>{state.status === "ready" ? "Your project request has been saved" : "Check your saved request"}</h1><p>Opening this page does not save or send a request. A confirmation is shown only after your saved record is loaded.</p>{state.status === "ready" ? <><ReferralDetails record={state.value}/><div className="referral-confirmation__actions"><Link className="btn btn-primary" to={`/app/referrals/${id}`}>Track my referral</Link><Link className="btn btn-secondary" to="/app">Return to dashboard</Link></div></> : <ReferralFeedback state={state} reload={() => void resource.reload()}/>}<p className="seeker-page__notice">School-project records only. Institutional delivery, provider responses and notification services are not connected.</p><Link to="/app/referrals">My Referrals</Link></main>;
}
export function ReferralConfirmationPage() {
  const { session } = useAuth(), { referralId } = useParams();
  if (!referralId || !validId(referralId)) return <main id="main-content" className="referral-confirmation"><h1>Referral not found</h1><Link to="/app/referrals">My Referrals</Link></main>;
  return session.status === "ready" ? <Confirmation key={`${session.identity.uid}:${referralId}`} uid={session.identity.uid} id={referralId}/> : <p role="status">Verify your session to view the saved request.</p>;
}
