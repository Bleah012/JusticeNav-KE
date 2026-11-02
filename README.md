# JusticeNav KE

A school software engineering project that helps people in Kenya
understand possible justice pathways and prepare to seek assistance.

## Project Status

The React frontend contains the public, account, assessment, seeker,
administrator and provider page layouts, with local form validation.

The FastAPI backend foundation provides process health and Firebase ID-token
verification support. Firebase email/password authentication is integrated with the
frontend and requires local Firebase and backend credential configuration. The identity endpoint denies unauthenticated requests and reports
unavailable verification when configuration is missing.

Own-profile persistence uses the authenticated FastAPI backend and the default
Firestore database when configured. Assessment descriptions and clarification
answers can also be saved, listed and reopened for the signed-in account.
Classification, notifications and referral processing remain unconnected. The interface does not create successful
operations or operational records to fill those gaps.

See [backend setup and endpoint checks](backend/README.md). Frontend development
commands are in [frontend/README.md](frontend/README.md).

## MVP Scope

The initial focus is money, debt, and consumer disputes.
Small Claims Court is one pathway to assess using official Kenyan sources.

The application provides information and navigation support.
It does not replace a lawyer or provide case-outcome predictions.

## User Roles

- Justice seeker: describes a problem and follows suggested next steps.
- Demo provider: reviews assigned demonstration referrals and updates status.
- Administrator: maintains services, pathways, and verification records.

Real organizations are not assumed to participate in referral processing.

## Planned MVP Features

- Email/password registration, login, and password reset.
- Saved problem descriptions and clarifying questions.
- AI-assisted broad issue classification.
- Source-backed Kenyan pathway and service information.
- Saved preparation checklists.
- Consent-based demo referrals and status history.
- In-app notifications.
- Minimal provider and administrator workspaces.

## Technology Stack

- Frontend: React, TypeScript, Vite, React Router, Tailwind CSS, Lucide.
- Authentication and database: Firebase Authentication and Firestore.
- Backend: Python and FastAPI.
- AI baseline: scikit-learn, TF-IDF, and Logistic Regression.
- Backend testing: Pytest and FastAPI TestClient; linting and formatting: Ruff.
- Frontend authentication boundary tests: Node test runner with mocked SDK/network operations.
- Version control and CI/CD: Git, GitHub, and GitHub Actions.
- Planned hosting: Firebase Hosting and Render.

## Project Structure

- frontend/: user interface and frontend tests.
- backend/: API, classification integration, and backend tests.
- data/: dataset documentation and approved small samples.
- docs/: requirements, design notes, and testing evidence.
- .github/workflows/: automated checks and deployment workflows.

## Design and Data

JusticeNav KE Wireframes.zip is the approved visual reference.
Optional prototype features are not automatically part of the MVP.

Training data and Kenyan evaluation examples will be documented separately.
Dataset permissions and suitability must be checked before use.
Official Kenyan sources will support pathway and service information.

## Development Rules

Work proceeds one approved substep at a time.
Important functions receive brief purpose comments.
Tests are added alongside implementation.
Secrets, personal data, and large datasets must not be committed.
Production deployment requires passing checks and explicit approval.
