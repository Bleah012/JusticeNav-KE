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

CORS currently permits GET with Authorization/Content-Type from the configured
frontend origin only. CORS is browser communication policy, not authorization.
When actual write endpoints are added, their methods will be enabled explicitly.

## Authorization boundaries and deferred work

`require_roles` is a reusable server-side dependency. No public endpoint can
create or change privileged claims. Role checks do not establish record
ownership or provider membership/assignment. Those checks must accompany every
future record query or update; they are not implemented by `/auth/me`.

Firestore, signup/sign-in/reset delivery, frontend session state, source-backed
records, classification, notifications and demonstration referral processing
remain separate work. Frontend preview URLs remain previews; they do not gain
authentication or access to private records from this batch.

Tests use isolated verifier/SDK mocks. Their `unit-*` identity strings are
test fixtures only, not Firebase accounts, saved cases or demo operational
records. The suite does not establish live Firebase readiness. A real-project
integration check remains pending setup.

## Primary implementation references

- [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Revocation and disabled-account checks](https://firebase.google.com/docs/auth/admin/manage-sessions)
- [FastAPI security dependencies](https://fastapi.tiangolo.com/reference/security/)
- [FastAPI settings](https://fastapi.tiangolo.com/advanced/settings/)
- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [FastAPI testing dependencies](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
