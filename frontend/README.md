# JusticeNav KE frontend

React, TypeScript, Vite and React Router. Run frontend commands from the
repository root using `npm.cmd --prefix frontend ...` on Windows.

## Firebase development configuration

Enable Email/Password authentication for the Firebase project and register the
web app. Ensure `localhost` is an authorized domain. Put the web-app Config
values in the ignored `frontend/.env.local`, using these variable names:

```dotenv
VITE_API_BASE_URL=http://localhost:8000
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_firebase_app_id
```

Replace placeholders locally. Do not edit the repository-root `.env.example`.
Web-app configuration identifies the Firebase app and is included in the browser
bundle; it does not grant administrative authority. Never put a service-account
private key or backend credential in a `VITE_` variable or frontend source file.
Restart Vite after changing environment variables.

```powershell
npm.cmd --prefix frontend run dev
```

Use `http://localhost:5173` consistently. `127.0.0.1` is a different browser
origin and would require matching Firebase-domain and backend CORS settings.

## Authentication flow

- Registration creates a real Firebase account and attempts a display-name update.
  The optional phone field is disabled; there is no phone verification or profile
  database. The agreement checkbox is local validation, not a saved acceptance record.
- Sign-in uses Firebase email/password authentication. Google sign-in and
  long-term Remember me are disabled. Auth state uses Firebase's tab-session
  persistence. Sign out explicitly on shared devices; browser session restoration
  can retain tabs. Local sign-out is not account deletion or revocation of every device.
- `onIdTokenChanged` triggers a fresh identity check at
  `GET /api/v1/auth/me`. The API receives a bearer token, not the password.
  Responses must contain the matching UID, an allowed role and boolean emailVerified.
  Tokens are not logged, put in URLs, or copied into separate application storage.
- `/app/*` requires a verified backend identity. `/admin/*` additionally requires
  the backend-verified admin role; `/provider/*` requires the provider role.
  A new account without a custom role is a seeker. There is no client-side role picker.
  The guards improve navigation; backend authorization remains mandatory on every
  future endpoint, including ownership and provider-membership/assignment checks.
- Signing in does not populate saved assessments, counts, resources or referrals.
  Their unavailable states remain until the relevant data services are implemented.

The API must run with the same Firebase project and backend-only credentials;
see `../backend/README.md`. A healthy process is not Firebase readiness. If
Firebase sign-in succeeds but the API returns 503, the session page remains
blocked and offers retry/sign-out. It never substitutes a development identity.
The API root `/` intentionally returns 404; use `/docs` or `/api/v1/health`.

## Password recovery

The forgot-password form requests Firebase's reset email only after an explicit
submission. Its generic result does not reveal account existence or promise delivery.

To use the app's custom reset screen during local development, open Firebase
Authentication → Templates → Password reset → Edit, then customize the **action
URL** to `http://localhost:5173/reset-password`. This is the email-template action
handler, not an `ActionCodeSettings.url` continue URL. Revisit this setting before
hosting; production emails must not point to localhost. If the console will not
accept the local action URL, keep Firebase's hosted handler until an authorized
HTTPS handler is available; do not invent a successful custom-handler test.

The reset screen verifies the `oobCode` with the configured Firebase project
before enabling a password change. URL `apiKey`, `continueUrl` and role parameters
cannot override configuration or redirect the application. Success is shown only
after `confirmPasswordReset` resolves. Successful reset removes the query string
from the current history entry and offers sign-in; it does not automatically log in.
Expired, invalid and reused links remain blocked. Do not paste reset links or tokens
into chat, screenshots, Git, analytics or server logs.

## Verification

```powershell
npm.cmd --prefix frontend run lint
node --test frontend/tests/auth.test.cjs
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend audit
```

The Node tests use the already-installed TypeScript compiler and mocked SDK/network
operations. They cover malformed identities, denied roles/statuses, stale requests,
StrictMode restarts, sign-out failures, timeouts, password policy, partial registration
and honest reset outcomes. They do not create accounts or send email. CI runs these
tests without Firebase configuration. Live account, email/reset and browser tests
must be performed manually with a dedicated development account.

The package override for Firestore's transitive `@grpc/grpc-js` pins `1.13.6`
to address GHSA-m9gg-hp2v-232j and GHSA-f596-whhp-79r4. Keep the lockfile; reassess
the temporary override when Firebase updates its upstream dependency. This batch
imports `firebase/app` and `firebase/auth` only, not Firestore or Analytics.

References: [password authentication](https://firebase.google.com/docs/auth/web/password-auth),
[persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence),
[custom email handlers](https://firebase.google.com/docs/auth/custom-email-handler).
