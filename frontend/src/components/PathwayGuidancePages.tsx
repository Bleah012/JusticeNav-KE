import { Link, useParams, useSearchParams } from "react-router";
import { backendUrl, firebaseAuth } from "../auth/firebaseClient";
import { useAuth } from "../auth/useAuth";
import { validId } from "../assessments/assessmentApi";
import { CatalogError } from "../catalog/catalogApi";
import { usePublicResource } from "../catalog/usePublicResource";
import {
  createNavigationRequest,
  createPathwayApi,
} from "../pathways/pathwayApi";
import type { Navigation } from "../pathways/pathwayApi";
import { AssessmentLayout } from "./AssessmentLayout";
import { PathwayDetailsPage } from "../pages/PathwayDetailsPage";
import { AssessmentResultsPage } from "../pages/AssessmentResultsPage";
import { PreparationChecklistPage } from "../pages/PreparationChecklistPage";

function PathwayRecord({ id }: { id: string }) {
  const { state, retry } = usePublicResource(
    (signal) => createPathwayApi(backendUrl).get(id, signal),
    true,
  );
  return (
    <PathwayDetailsPage
      details={
        state.status === "ready"
          ? { status: "ready", pathway: state.value }
          : state.status === "loading"
            ? { status: "loading" }
            : state.status === "not-found"
              ? { status: "not-found" }
              : { status: "error", retry }
      }
    />
  );
}
export function ConnectedPathwayDetailsPage() {
  const { pathwayId = "" } = useParams();
  return <PathwayRecord key={pathwayId} id={pathwayId} />;
}
function PreparationRecord({ id }: { id: string }) {
  const { state, retry } = usePublicResource(
    (signal) => createPathwayApi(backendUrl).preparation(id, signal),
    true,
  );
  return (
    <PreparationChecklistPage
      checklist={
        state.status === "ready"
          ? { status: "ready", requirements: state.value }
          : state.status === "loading"
            ? { status: "loading" }
            : state.status === "not-found"
              ? { status: "not-found" }
              : { status: "error", retry }
      }
    />
  );
}
export function ConnectedPreparationPage() {
  const [params] = useSearchParams();
  const id = params.get("pathwayId") ?? "";
  return <PreparationRecord key={id} id={id} />;
}
function BrowsePathways() {
  const { state, retry } = usePublicResource((signal) =>
    createPathwayApi(backendUrl).list(signal),
  );
  return (
    <AssessmentLayout step={3}>
      <div className="assessment-entry__title">
        <h1>Explore pathway information</h1>
        <p id="assessment-prototype-note">
          Choose a saved assessment in My Assessments for category-based links.
          The guides below are general information and are not results for your
          case.
        </p>
      </div>
      <Link className="btn btn-primary" to="/app/assessments">
        My Assessments
      </Link>
      {state.status === "loading" ? (
        <p role="status">Loading pathway informationâ€¦</p>
      ) : state.status !== "ready" ? (
        <section role="alert">
          <p>Pathway information could not be loaded.</p>
          <button className="btn btn-secondary" onClick={retry}>
            Try again
          </button>
        </section>
      ) : (
        <div className="assessment-results__list">
          {state.value.length === 0 && (
            <p role="status">No pathway guides are currently listed.</p>
          )}
          {state.value.map((pathway) => (
            <article className="assessment-results__card" key={pathway.id}>
              <div className="assessment-results__main">
                <h2>{pathway.title}</h2>
                <p>{pathway.whoMayUse}</p>
                <Link
                  className="btn btn-secondary"
                  to={`/pathways/${pathway.id}`}
                >
                  View pathway
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </AssessmentLayout>
  );
}
type ResultRead =
  | { kind: "ready"; navigation: Navigation }
  | { kind: "incomplete" };
function AccountResults({ uid, id }: { uid: string; id: string }) {
  const { state, retry } = usePublicResource<ResultRead>(async (signal) => {
    try {
      return {
        kind: "ready",
        navigation: await createNavigationRequest({
          baseUrl: backendUrl,
          currentUser: () => firebaseAuth().currentUser,
        })(uid, id, signal),
      };
    } catch (error) {
      if (error instanceof CatalogError && error.status === 409)
        return { kind: "incomplete" };
      throw error;
    }
  }, true);
  return (
    <AssessmentResultsPage
      assessmentId={id}
      results={
        state.status === "ready"
          ? state.value.kind === "incomplete"
            ? { status: "incomplete" }
            : { status: "ready", navigation: state.value.navigation }
          : state.status === "loading"
            ? { status: "loading" }
            : state.status === "not-found"
              ? { status: "not-found" }
              : { status: "error", retry }
      }
    />
  );
}
export function ConnectedAssessmentResultsPage() {
  const { assessmentId } = useParams();
  const { session } = useAuth();
  if (assessmentId === undefined) return <BrowsePathways />;
  if (!validId(assessmentId))
    return (
      <AssessmentLayout step={3}>
        <h1>Assessment not found</h1>
        <p id="assessment-prototype-note">
          Choose one of your saved assessments.
        </p>
        <Link to="/app/assessments">My Assessments</Link>
      </AssessmentLayout>
    );
  return session.status === "ready" ? (
    <AccountResults
      key={`${session.identity.uid}:${assessmentId}`}
      uid={session.identity.uid}
      id={assessmentId}
    />
  ) : (
    <p role="status">Verify your session to view pathway information.</p>
  );
}
