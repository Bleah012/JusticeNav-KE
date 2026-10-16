import { Outlet, Route, Routes } from "react-router";
import { PublicHeader } from "./components/PublicHeader";
import { HomePage } from "./pages/HomePage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";

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
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      <Route path="/login" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
    </Routes>
  );
}

export default App;
