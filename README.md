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
Preparation checklists persist source-item snapshots and explicit progress saves.
The public service directory and resource library use a versioned catalogue of
reviewed official sources served through FastAPI. Seekers can request an
issue category suggestion from a saved assessment. The interface does not create successful
operations or operational records to fill those gaps.

See [backend setup and endpoint checks](backend/README.md). Frontend development
commands are in [frontend/README.md](frontend/README.md).

## MVP Scope

The initial focus is money, debt, and consumer disputes.
Small Claims Court is one pathway to assess using official Kenyan sources.

The application provides information and navigation support.
It does not replace a lawyer or provide case-outcome predictions.

## User Roles

Administrator Justice Services management now includes Firestore-backed drafts,
editing, source-reviewed publication, archiving and deletion of unused drafts.
See [service management and verification](docs/service-management.md).

Pathways also support persistent guide and preparation-item editing, reviewed
publication, archiving and draft deletion, with protected service references and
saved user snapshots. See [pathway management](docs/pathway-management.md).

Resources now have administrator CRUD for source-backed links, categories and
review dates, including reviewed publication, archiving and draft deletion.
See [resource management](docs/resource-management.md).

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
- Issue suggestion baseline: TF-IDF and multinomial logistic regression in Python.
- Backend testing: Pytest and FastAPI TestClient; linting and formatting: Ruff.
- Frontend authentication boundary tests: Node test runner with mocked SDK/network operations.
- Version control and CI/CD: Git, GitHub, and GitHub Actions.
- Planned hosting: Firebase Hosting and Render.

## Project Structure

- frontend/: user interface and frontend tests.
- backend/: API, classification integration, and backend tests.
- [data/](data/README.md) provides dataset setup, reviewed labels and the offline evaluator.
- docs/: requirements, design notes, and testing evidence.
- .github/workflows/: automated checks and deployment workflows.

## Design and Data

JusticeNav KE Wireframes.zip is the approved visual reference.
Optional prototype features are not automatically part of the MVP.

The issue suggestion model uses versioned synthetic training examples and a
separate synthetic Kenyan evaluation set. See [issue suggestion notes](docs/issue-suggestions.md).
Official Kenyan sources support the initial public service and resource catalogue.
See [public catalogue source notes](docs/public-catalog-sources.md). Saved issue categories now select a small, documented set of public pathway links.
The seeker chooses the category used by this fixed navigation rule.
See [pathway guidance notes](docs/pathway-guidance-sources.md). Checklist snapshots and ticks can be saved to the signed-in account, listed and reopened
through My Checklists. Referral delivery remains separate work.

## Development Rules

Work proceeds one approved substep at a time.
Important functions receive brief purpose comments.
Tests are added alongside implementation.
Secrets, personal data, and large datasets must not be committed.
Production deployment requires passing checks and explicit approval.


## Private saved project requests

Signed-in users can explicitly save a referral request, reload its confirmation, and reopen its own-account tracking record. Records use real submitted test inputs and the existing official-source catalogue, not seeded personal data. The only current status is **Saved in JusticeNav KE**; delivery is **Not sent to an institution**. The development demonstration supports an optional sharing and progress workflow alongside the private saved request. In-app saved-record notifications are available as described below.


## Connected seeker dashboard

The own-account dashboard reads total saved assessments, checklists and project requests, recent saves, latest-checklist progress and the latest saved project-request preview. Counts cover all saved records, not just the first list page. It does not create notifications, institutional status updates or a separate activity log. Saved referrals remain **not sent to an institution**.


## In-app saved-record notifications

Successful assessment, checklist and project-request saves now create an account-only metadata update in the same Firestore transaction as the record. Notifications support unread filtering, cursor pagination, individual mark-as-read and **Mark displayed as read**, with persistent read status. No events are seeded or backfilled for earlier saves. Notification reads and read-status changes do not send email/SMS, create provider messages or deliver referrals to institutions.

## Read-only administration

Administrators can open Overview, Justice Services and Pathways. The overview counts published services, pathways and resources. The catalogue pages show source links and review dates from the same versioned files as the public site. Each API request requires the verified Firebase admin role. See the [backend setup and development account guide](backend/README.md).

## Development referral workflow

A seeker can share the reference and public source metadata from an existing saved request. An administrator assigns that demonstration to a development provider with a matching service membership. The provider records review and completion. The seeker sees those events in My Referrals and can withdraw sharing. The saved request retains its separate institutional delivery status.

## Catalogue audit history

Administrator → Audit Logs now reads successful Services, Pathways and Resources
changes from their existing transactional audit collections. It supports record,
action, reference and Kenya-date filters, event details and bounded cursor paging.
The viewer never writes events or exposes saved case text. See the
[audit-log guide](docs/audit-logs.md) for scope and live acceptance checks.

## Seeker referral management

Seekers can edit contact details and descriptions, or delete their own saved
requests, before any demonstration sharing. Shared requests retain their history
and stay locked after withdrawal or completion. The existing three-role
demonstration flow remains available. See the backend and frontend READMEs for
the API contract and acceptance checks.

## Administrator account creation

Administrator → Users now reads Firebase Authentication account metadata and
creates separate provider or administrator accounts. Providers select a published
service and become available in matching demonstration assignments. Public
registration continues to create seekers. Existing accounts cannot be re-roled,
disabled or deleted from this page. See the backend and frontend guides for setup
and acceptance checks.

## Dashboard and data review

Dashboard charts and counts are larger. Administrator totals include Firebase
accounts and school demonstration statuses. Provider status charts cover every
current assignment, not just the current page. Seeker counts still cover all
saved records in that account.

The data folder has a reproducible completeness/evaluation audit and a clearly
labeled synthetic development CSV. The subsequent employment release uses 156
synthetic examples across four categories. See [employment scope](docs/employment-scope.md)
for source and training research, and [MVP review](docs/mvp-review.md) for proposal
alignment and remaining report, logbook and independent evaluation work.
The three-role workflow remains a school demonstration. Hosting is a separate,
final task.

## Employment information

Employment is a fourth optional suggestion and manual assessment category.
It opens the Judiciary employment-dispute information guide, a preparation
checklist and the existing private referral/school-demonstration flow.
Existing Other answers stay unchanged until the owner explicitly edits them.
The model uses 156 synthetic examples; raw external or seeker descriptions
are not training inputs. See [employment scope](docs/employment-scope.md).
