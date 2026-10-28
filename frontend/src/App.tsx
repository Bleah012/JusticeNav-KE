import { Outlet, Route, Routes, useNavigate } from "react-router";
import { PublicHeader } from "./components/PublicHeader";
import { HomePage } from "./pages/HomePage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { JusticeServicesPage } from "./pages/JusticeServicesPage";
import { ServiceProfilePage } from "./pages/ServiceProfilePage";
import { ResourcesPage } from "./pages/ResourcesPage";
import { PrivacyNoticePage } from "./pages/PrivacyNoticePage";
import { TermsOfUsePage } from "./pages/TermsOfUsePage";
import { AssessmentEntryPage } from "./pages/AssessmentEntryPage";
import { AssessmentClarificationPage } from "./pages/AssessmentClarificationPage";
import { AssessmentResultsPage } from "./pages/AssessmentResultsPage";
import { PathwayDetailsPage } from "./pages/PathwayDetailsPage";

// Share public navigation without placing it above standalone account pages.
function PublicLayout() {
  return (
    <>
      <PublicHeader />
      <main id="main-content">
        <Outlet />
      </main>
    </>
  );
}

// Match each URL to its page inside the existing BrowserRouter.
function App() {
  const navigate = useNavigate();

  // Open the public detail route only for the selected supplied result identifier.
  function handleViewPathway(pathwayId: string) {
    navigate(`/pathways/${encodeURIComponent(pathwayId)}`);
  }

  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/services" element={<JusticeServicesPage />} />
        <Route path="/services/:serviceId" element={<ServiceProfilePage />} />
        <Route path="/resources" element={<ResourcesPage />} />
        <Route path="/privacy" element={<PrivacyNoticePage />} />
        <Route path="/terms" element={<TermsOfUsePage />} />
        <Route path="/pathways/:pathwayId" element={<PathwayDetailsPage />} />
      </Route>
      <Route path="/login" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/app/assessments/new" element={<AssessmentEntryPage />} />
      <Route
        path="/app/assessments/clarify"
        element={<AssessmentClarificationPage />}
      />
      <Route
        path="/app/assessments/results"
        element={<AssessmentResultsPage onViewPathway={handleViewPathway} />}
      />
    </Routes>
  );
}

export default App;
