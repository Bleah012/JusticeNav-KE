# JusticeNav KE backend foundation

This batch adds FastAPI, health reporting, Firebase ID-token verification,
minimal identity metadata, a reusable role dependency and offline unit tests.
It does not enable login, create accounts, provision Firebase or store records.

Use Python 3.14, matching the installed development interpreter and backend CI.
The pinned requirements include runtime and development/test tools for this
student-project development environment. Separate production packaging will be
reviewed before deployment. `requirements.in` documents the direct inputs;
`requirements.txt` records the tested full dependency resolution.

## Install and check from the repository root

```powershell
python -m venv backend/.venv
if ($LASTEXITCODE -ne 0) { throw "Virtual environment creation failed." }

& ".\backend\.venv\Scripts\python.exe" -m pip install -r backend/requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

& ".\backend\.venv\Scripts\python.exe" -m pip check
if ($LASTEXITCODE -ne 0) { throw "Dependency consistency check failed." }

& ".\backend\.venv\Scripts\python.exe" -m ruff check backend
if ($LASTEXITCODE -ne 0) { throw "Backend lint failed." }

& ".\backend\.venv\Scripts\python.exe" -m ruff format --check backend
if ($LASTEXITCODE -ne 0) { throw "Backend format check failed." }

& ".\backend\.venv\Scripts\python.exe" -m pytest -c backend/pyproject.toml backend/tests -q
if ($LASTEXITCODE -ne 0) { throw "Backend tests failed." }
```

The virtual environment is ignored by Git. Calling its Python directly avoids
requiring PowerShell activation or an execution-policy change.

## Start in a separate terminal

```powershell
Set-Location "C:\Users\Abraham Barasa\Documents\Projects\JusticeNav-KE"
& ".\backend\.venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir backend --reload --reload-dir backend/app --host 127.0.0.1 --port 8000 --no-access-log
```

The server binds to the local computer. The existing frontend development server
can keep running on port 5173.

## Endpoints

| Method | URL                                    | Behavior                                                          |
| ------ | -------------------------------------- | ----------------------------------------------------------------- |
| GET    | `http://localhost:8000/api/v1/health`  | 200, process liveness only                                        |
| GET    | `http://localhost:8000/api/v1/auth/me` | Requires a valid Firebase ID token in `Authorization: Bearer ...` |
| GET    | `http://localhost:8000/docs`           | Development API documentation; disabled for production settings   |

Health returns `{"status":"ok","service":"justicenav-api"}`. This means the API
process is running; it does not claim that Firebase, Firestore or AI is ready.

Missing, empty or wrong-scheme credentials return 401 with a Bearer challenge.
Invalid/expired/revoked tokens and disabled/deleted accounts are rejected.
A supplied bearer value cannot be checked before Firebase is configured, so it
returns 503. These responses are actual authentication failures/unavailability,
not a simulated sign-in. API responses use `Cache-Control: no-store`.

The successful identity DTO contains only `uid`, `role` and `emailVerified`.
It does not expose email addresses, raw claims, passwords, tokens or credential
file paths. A missing custom `role` claim defaults to `seeker`; recognized roles
are `seeker`, `provider` and `admin`. Unsupported values return 403. Query
parameters and client role/user headers cannot grant a role.

## Configuration

The backend reads the repository-root `.env`, if present, using only:

- `APP_ENV`: development, test or production; default development.
- `FRONTEND_ORIGIN`: one explicit origin; default http://localhost:5173.
- `FIREBASE_PROJECT_ID`: initially absent or the agreed placeholder.
- `GOOGLE_APPLICATION_CREDENTIALS`: optional backend-only credential file path.

The existing `.env.example` is unchanged. Unrelated `VITE_` entries are ignored
by backend settings. Environment variables take priority over the local file.
Do not copy a real credential or private environment file into the repository,
frontend, chat, screenshots or Git. No Firebase project or credentials are
needed for health checks, unit tests or CI.

When Firebase setup is approved, configure a real project ID and backend
Application Default Credentials or a private service-account file outside the
repository. The Firebase Admin SDK checks the token signature, issuer/audience,
expiry and revocation. This foundation rejects authentication emulator mode;
it has no unsigned-token or development-user bypass.

CORS permits GET and PUT with Authorization/Content-Type from the configured
frontend origin only. CORS is browser communication policy, not authorization.

## Authorization boundaries and deferred work

`require_roles` is a reusable server-side dependency. No public endpoint can
create or change privileged claims. Role checks do not establish record
ownership or provider membership/assignment. Those checks must accompany every
future record query or update; they are not implemented by `/auth/me`.

Firebase signup/sign-in/password recovery and protected frontend workspaces
are connected. The own-profile endpoints below use Firestore when configured.
Saved assessments, source-backed records, classification, notifications and
demonstration referral processing remain separate work.

Tests use isolated verifier/SDK mocks. Their `unit-*` identity strings are
test fixtures only, not Firebase accounts, saved cases or demo operational
records. The suite does not establish live Firebase readiness. A real-project
integration check must be performed locally after setup.

## Primary implementation references

- [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Revocation and disabled-account checks](https://firebase.google.com/docs/auth/admin/manage-sessions)
- [FastAPI security dependencies](https://fastapi.tiangolo.com/reference/security/)
- [FastAPI settings](https://fastapi.tiangolo.com/advanced/settings/)
- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [FastAPI testing dependencies](https://fastapi.tiangolo.com/advanced/testing-dependencies/)

## Firestore own-profile persistence

Create Cloud Firestore in Firebase project `justicenav-ke` using Standard edition,
database ID `(default)`, Johannesburg (`africa-south1`) and Production mode.
Database location cannot be changed after creation. Do not create a second database
or upgrade billing for this batch. Leave the database empty until the first explicit
profile save. Existing Firebase backend credentials are reused; no new environment
variables or private keys are required.

The root `firestore.rules` file denies every browser/mobile read and write. In the
Firestore console's Rules tab, confirm the active rule is equivalent to this file.
The Firebase Admin SDK bypasses these rules and uses IAM. Every API profile operation
therefore selects its document from the verified bearer identity, regardless of any
client UID, role header or query parameter. Browser code never initializes Firestore.

| Method | URL | Behavior |
| --- | --- | --- |
| GET | `/api/v1/profile/me` | Own saved profile, or `{"profile": null}` if none exists; does not write. |
| PUT | `/api/v1/profile/me` | Validate and atomically create/update the authenticated user's profile. |

Both methods require the existing Firebase bearer token. The request body accepts
only `fullName` (trimmed, 1–120 characters, no control characters), optional `phone`
(null or international format starting with `+`, 8–15 digits), `preferredLanguage`
(`en` or `sw`) and `expectedRevision` (integer, 0 for the first save). Extra fields
including UID, role, email, password and timestamps are rejected. Invalid inputs
return a generic 422 response without echoing submitted values.

Successful responses contain `profile` with those three profile fields, `uid`,
`revision`, `createdAt` and `updatedAt`. Timestamps come from the backend's UTC clock.
The `profiles` collection uses SHA-256 of the verified UID as the document ID to
avoid interpreting UID characters as a Firestore path. Hashing is not encryption;
the record retains its UID for an additional ownership check.

A transaction reads the latest revision before writing. A stale `expectedRevision`
returns 409 without replacing the newer profile. The first save creates revision 1;
subsequent saves increment it and preserve `createdAt`. A lost HTTP response is an
uncertain outcome: reload the profile before another save rather than claiming the
write failed or retrying it automatically. Missing/denied/unreachable storage and
invalid stored records return generic 503 responses. Health and `/auth/me` remain
independent of Firestore readiness. API responses disable caching.

No email, password, role, photo, saved assessment, referral, notification, account
deletion or Auth display-name change is performed by this endpoint. Names saved
here belong to the application profile; Firebase Authentication remains separate.
The language field is a preference and does not translate the interface.

### Troubleshooting and verification

Restart the backend after applying the batch. If `/auth/me` succeeds but the profile
request returns 503, check that `(default)` exists in the same project, the Firestore
API is enabled, and the existing backend service account has Firestore data access
through IAM. Firebase Authentication lookup permission alone is not Firestore access.
Do not loosen browser rules, copy keys into the frontend or grant an application user
an administrator role to resolve a storage configuration error.

The backend tests use verifier and Firestore mocks, explicit test settings and no live
credentials. They cover ownership, input rejection, missing profiles, transactions,
revision conflicts, storage failures and CORS. They do not create cloud records.
Run the commands in the setup section; a real save/reload remains a local manual check.

References: [create a database](https://firebase.google.com/docs/firestore/quickstart),
[database locations](https://firebase.google.com/docs/firestore/locations),
[rules and server access](https://firebase.google.com/docs/firestore/security/rules-conditions),
[transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).
