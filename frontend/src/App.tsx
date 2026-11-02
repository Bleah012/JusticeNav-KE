import { Outlet, Route, Routes, useNavigate } from "react-router";
import { PublicHeader } from "./components/PublicHeader";
import { SeekerLayout } from "./components/SeekerLayout";
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
import { PreparationChecklistPage } from "./pages/PreparationChecklistPage";
import { ReferralRequestPage } from "./pages/ReferralRequestPage";
import { ReferralConfirmationPage } from "./pages/ReferralConfirmationPage";
import { ReferralTrackingPage } from "./pages/ReferralTrackingPage";
import { SeekerDashboardPage } from "./pages/SeekerDashboardPage";
import { MyAssessmentsPage } from "./pages/MyAssessmentsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { PrivacySecurityPage } from "./pages/PrivacySecurityPage";
import { MyChecklistsPage } from "./pages/MyChecklistsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { AdminLayout } from "./components/AdminLayout";
import { AdminOverviewPage } from "./pages/AdminOverviewPage";
import { AdminServicesPage } from "./pages/AdminServicesPage";
import { AdminPathwaysPage } from "./pages/AdminPathwaysPage";
import { AdminReferralsPage } from "./pages/AdminReferralsPage";
import { AdminVerificationPage } from "./pages/AdminVerificationPage";
import { AdminAuditLogsPage } from "./pages/AdminAuditLogsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { PathwayEditorPage } from "./pages/PathwayEditorPage";
import { ProviderLayout } from "./components/ProviderLayout";
import { ProviderDashboardPage } from "./pages/ProviderDashboardPage";
import { RequireSession } from "./components/AuthSession";
import { RouteNavigation } from "./components/RouteNavigation";
// Share public navigation without placing it above standalone account pages.
function PublicLayout() {
  return (<>
  <PublicHeader />
  <main id="main-content" className="public-main" tabIndex={-1}>
  <Outlet />
  </main>
 </>);
}
// Match each URL to its page inside the existing BrowserRouter.
function App() {
  const navigate = useNavigate();
  // Open the public detail route for the selected supplied result identifier.
  function handleViewPathway(pathwayId: string) {
    navigate(`/pathways/${encodeURIComponent(pathwayId)}`);
  }
  return (<>
  <RouteNavigation />
  <Routes>
  <Route element={<PublicLayout />}>
   <Route path="/" element={<HomePage />}/>
   <Route path="/services" element={<JusticeServicesPage />}/>
   <Route path="/services/:serviceId" element={<ServiceProfilePage />}/>
   <Route path="/resources" element={<ResourcesPage />}/>
   <Route path="/privacy" element={<PrivacyNoticePage />}/>
   <Route path="/terms" element={<TermsOfUsePage />}/>
   <Route path="/pathways/:pathwayId" element={<PathwayDetailsPage />}/>
   <Route path="*" element={<NotFoundPage />}/>
  </Route>

  <Route path="/login" element={<SignInPage />}/>
  <Route path="/signup" element={<SignUpPage />}/>
  <Route path="/forgot-password" element={<ForgotPasswordPage />}/>
  <Route path="/reset-password" element={<ResetPasswordPage />}/>

  <Route element={<RequireSession />}>
   <Route path="/app/assessments/new" element={<AssessmentEntryPage />}/>
   <Route path="/app/assessments/clarify" element={<AssessmentClarificationPage />}/>
   <Route path="/app/assessments/:assessmentId/describe" element={<AssessmentEntryPage />}/>
   <Route path="/app/assessments/:assessmentId/clarify" element={<AssessmentClarificationPage />}/>
   <Route path="/app/assessments/results" element={<AssessmentResultsPage onViewPathway={handleViewPathway}/>}/>
   <Route path="/app/checklists/new" element={<PreparationChecklistPage />}/>
   <Route path="/app/referrals/new" element={<ReferralRequestPage />}/>
   <Route path="/app/referrals/:referralId/confirmation" element={<ReferralConfirmationPage />}/>

   <Route element={<SeekerLayout>
    <Outlet />
    </SeekerLayout>}>
   <Route path="/app" element={<SeekerDashboardPage />}/>
   <Route path="/app/assessments" element={<MyAssessmentsPage />}/>
   <Route path="/app/notifications" element={<NotificationsPage />}/>
   <Route path="/app/profile" element={<ProfilePage />}/>
   <Route path="/app/privacy-security" element={<PrivacySecurityPage />}/>
   <Route path="/app/checklists" element={<MyChecklistsPage />}/>
   <Route path="/app/referrals" element={<ReferralTrackingPage />}/>
   <Route path="/app/referrals/:referralId" element={<ReferralTrackingPage />}/>
   <Route path="/app/*" element={<NotFoundPage seeker/>}/>
  </Route>
  </Route>
  <Route element={<RequireSession roles={["admin"]}/>}>
   <Route element={<AdminLayout>
    <Outlet />
    </AdminLayout>}>
   <Route path="/admin" element={<AdminOverviewPage />}/>
   <Route path="/admin/users" element={<AdminUsersPage />}/>
   <Route path="/admin/services" element={<AdminServicesPage />}/>
   <Route path="/admin/pathways" element={<AdminPathwaysPage />}/>
   <Route path="/admin/pathways/new" element={<PathwayEditorPage />}/>
   <Route path="/admin/pathways/:pathwayId/edit" element={<PathwayEditorPage />}/>
   <Route path="/admin/referrals" element={<AdminReferralsPage />}/>
   <Route path="/admin/verification" element={<AdminVerificationPage />}/>
   <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />}/>
   <Route path="/admin/*" element={<NotFoundPage admin/>}/>
  </Route>
  </Route>
  <Route element={<RequireSession roles={["provider"]}/>}>
   <Route element={<ProviderLayout>
    <Outlet />
    </ProviderLayout>}>
   <Route path="/provider" element={<ProviderDashboardPage />}/>
   <Route path="/provider/*" element={<NotFoundPage provider/>}/>
  </Route>
  </Route>
  </Routes>
  </>);
}
export default App;
