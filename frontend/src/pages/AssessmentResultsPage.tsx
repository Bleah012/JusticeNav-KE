import { Building2, Info, LoaderCircle, Route as RouteIcon } from "lucide-react";
import { Link } from "react-router";
import { AssessmentLayout } from "../components/AssessmentLayout";
import { Button } from "../components/ui/Button";
import type { Navigation } from "../pathways/pathwayApi";
import "./AssessmentResultsPage.css";

export type AssessmentResultsData =
  | { status: "loading" | "not-found" | "incomplete" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; navigation: Navigation };

export function AssessmentResultsPage({ assessmentId, results }: { assessmentId: string; results: AssessmentResultsData }) {
  const navigation = results.status === "ready" ? results.navigation : null;
  const label = navigation ? { consumer: "Consumer", "money-debt": "Money / Debt", other: "Something else" }[navigation.selectedIssue] : null;
  return <AssessmentLayout step={3}>
    <div className="assessment-entry__title assessment-results__title"><span className="assessment-entry__badge">Navigation result</span><h1>Potentially relevant pathways</h1>{navigation && <p>Information linked to your saved {label} selection.</p>}</div>
    <div className="assessment-entry__prototype" id="assessment-prototype-note" role="note"><Info size={18} aria-hidden="true"/><p>These published information links use the issue category you selected. Check the official sources for eligibility and deadlines.</p></div>
    <section className="assessment-results" aria-label="Pathway results" aria-busy={results.status === "loading"}>
      {results.status === "loading" && <div className="assessment-results__state" role="status"><LoaderCircle size={30} aria-hidden="true"/><h2>Loading pathway information.</h2></div>}
      {results.status === "error" && <div className="assessment-results__state" role="alert"><h2>We could not load your pathway information.</h2><p>No results are displayed. Check your session and API connection, then retry.</p><Button variant="secondary" onClick={results.retry}>Try again</Button></div>}
      {results.status === "not-found" && <div className="assessment-results__state" role="status"><h2>Assessment not found</h2><p>No saved assessment could be opened for your account.</p></div>}
      {results.status === "incomplete" && <div className="assessment-results__state" role="status"><h2>Complete your clarification answers</h2><p>Save all three answers before exploring category-based links.</p><Link className="btn btn-primary" to={`/app/assessments/${assessmentId}/clarify`}>Continue clarification</Link></div>}
      {navigation && <>
        <p className="catalog-source-note">Based on saved revision {navigation.revision}. Order is editorial, not a ranking of suitability. Source review: {navigation.checkedOn}. <Link to={`/app/assessments/${assessmentId}/clarify`}>Review or change answers</Link></p>
        {!navigation.pathways.length && <div className="assessment-results__state" role="status"><RouteIcon size={30} aria-hidden="true"/><h2>No category-based links to display.</h2><p>Something else has no automatic mapping in this version. This does not mean no help exists.</p><Link className="btn btn-secondary" to="/app/assessments/results">Explore general pathway information</Link></div>}
        <div className="assessment-results__list">{navigation.pathways.map(({ pathway, reason }) => <article className="assessment-results__card" key={pathway.id}>
          <div className="assessment-results__main"><span className="assessment-entry__badge">Category-based information</span><div className="assessment-results__name"><Building2 size={28} aria-hidden="true"/><div><h2>{pathway.title}</h2><p>{pathway.category}</p></div></div><div className="assessment-results__explanation"><h3>Why this is shown</h3><p>{reason}</p></div><p className="assessment-results__notice">{pathway.whoMayUse}</p><div className="assessment-results__source">{pathway.sourceReview.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a>)}</div><div className="assessment-results__buttons"><Link className="btn btn-primary" to={`/pathways/${pathway.id}?assessmentId=${assessmentId}`}>View pathway</Link></div></div>
          <aside className="assessment-results__details"><h3>Before proceeding</h3><p>Confirm current scope and requirements with the official source. This is navigation information, not legal advice.</p></aside>
        </article>)}</div>
      </>}
    </section>
    <div className="assessment-entry__actions assessment-results__actions"><Link className="btn btn-ghost" to="/app/assessments">My Assessments</Link><Link className="btn btn-secondary" to="/services">Explore justice services</Link></div>
  </AssessmentLayout>;
}
