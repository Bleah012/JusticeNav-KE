import { getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  initializeAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  validatePassword,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "firebase/auth";
import type { Auth } from "firebase/auth";
import { unavailableMessage } from "./session";
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const firebaseConfigured = Object.values(config).every(
  (value) =>
    typeof value === "string" && value.trim() && !/PASTE_|your_/i.test(value),
);
export const backendUrl = import.meta.env.VITE_API_BASE_URL ?? "";
let auth: Auth | undefined;
// Initialize only Authentication, with tab-session persistence and no analytics.
export function firebaseAuth(): Auth {
  if (!firebaseConfigured) throw new Error(unavailableMessage);
  if (!auth) {
    const name = "justicenav-web";
    const app =
      getApps().find((item) => item.name === name) ??
      initializeApp(config, name);
    auth = initializeAuth(app, { persistence: browserSessionPersistence });
  }
  return auth;
}
export async function signIn(email: string, password: string): Promise<string> {
  await signInWithEmailAndPassword(firebaseAuth(), email.trim(), password);
  return "Signed in to Firebase. Verifying your application session.";
}
async function checkPassword(password: string) {
  const result = await validatePassword(firebaseAuth(), password);
  if (!result.isValid)
    throw { code: "auth/password-does-not-meet-requirements" };
}
// Account creation is real; a failed display-name update must not prompt duplicate signup.
export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<string> {
  await checkPassword(password);
  const result = await createUserWithEmailAndPassword(
    firebaseAuth(),
    email.trim(),
    password,
  );
  try {
    await updateProfile(result.user, { displayName: fullName.trim() });
    return "Your Firebase account was created. Continue to your account to check backend verification.";
  } catch {
    return "Your Firebase account was created, but your name could not be saved. Do not create another account. Continue to your account or sign in with the email and password you just used.";
  }
}
export async function requestReset(email: string): Promise<string> {
  try {
    await sendPasswordResetEmail(firebaseAuth(), email.trim());
  } catch (cause) {
    // Preserve the same UI outcome even if email-enumeration protection is disabled.
    if (
      (
        cause as {
          code?: string;
        } | null
      )?.code !== "auth/user-not-found"
    )
      throw cause;
  }
  return "If an account exists for this email address, password-reset instructions have been requested. Check your inbox and spam folder.";
}
export async function checkReset(code: string): Promise<void> {
  await verifyPasswordResetCode(firebaseAuth(), code);
}
export async function finishReset(
  code: string,
  password: string,
): Promise<string> {
  await checkPassword(password);
  await confirmPasswordReset(firebaseAuth(), code, password);
  return "Your password was reset. Sign in using your new password.";
}
// Fixed messages keep raw SDK responses, submitted email addresses and codes out of the UI.
export function authError(error: unknown): string {
  const code = (
    error as {
      code?: string;
    } | null
  )?.code;
  if (
    [
      "auth/invalid-credential",
      "auth/user-not-found",
      "auth/wrong-password",
      "auth/user-disabled",
    ].includes(code ?? "")
  )
    return "Sign-in failed. Check your email and password, or request a password reset.";
  if (code === "auth/email-already-in-use")
    return "Account creation could not be completed. Try signing in or requesting a password reset.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (
    ["auth/weak-password", "auth/password-does-not-meet-requirements"].includes(
      code ?? "",
    )
  )
    return "Use a stronger password that meets this Firebase project's password policy.";
  if (
    ["auth/invalid-action-code", "auth/expired-action-code"].includes(
      code ?? "",
    )
  )
    return "This password-reset link is invalid, expired or already used. Request a new link.";
  if (code === "auth/too-many-requests")
    return "Too many attempts. Wait a while before trying again.";
  if (code === "auth/network-request-failed")
    return "The authentication service could not be reached. Check your connection and try again.";
  return "Authentication could not be completed. Check the Firebase configuration and try again.";
}
