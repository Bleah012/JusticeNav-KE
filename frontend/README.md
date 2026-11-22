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
  The optional registration phone field is disabled. Profile data is saved separately
  from the Profile page; no phone verification is connected. The agreement checkbox
  is local validation, not a saved acceptance record.
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
- Signing in creates no assessment or referral. The dashboard reads counts and recent saves from existing records in the verified account; resource saving is not connected.
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
node --test frontend/tests/auth.test.cjs frontend/tests/profile.test.cjs frontend/tests/assessments.test.cjs frontend/tests/catalog.test.cjs
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

## Connected Profile page

The existing `/app/profile` page loads and saves the signed-in user's application
profile through authenticated GET/PUT `/api/v1/profile/me`. The backend's verified UID
selects the record. The browser never connects directly to Firestore or sends an
editable UID, role, email or password in the profile request body.

The page preserves its approved form and navigation. Full name, optional international
phone number and English/Kiswahili preference are writable. The email comes from the
matching Firebase Auth user and is read-only. Photo changes remain disabled. A saved
name does not update Firebase Auth's display name; language selection does not translate
the current interface.

Opening a new account's Profile page does not create data. It shows an explicit unsaved
state, using the real Auth display name as an editable initial value when available.
Saving requires explicit submission and shows success only after a valid API response.
Load failures offer retry. Edits remain in the form after a save failure; a stale revision
or uncertain response requires Reload profile before another save. Reloading replaces
unsaved edits, as stated beside the control. Concurrent saves cannot silently overwrite
a newer revision. Switching accounts or leaving the page discards stale in-flight results.

### Local browser checks

Use a dedicated development account and non-sensitive input. Keep both servers running.
Navigate within the signed-in tab; Firebase session persistence is per tab.

1. Open `/app/profile`. In browser Network, GET `/api/v1/profile/me` should return
   200 with `profile: null` for a new profile, without creating a document.
2. Complete Full name and Preferred language, leaving the optional phone blank.
   Select Save changes. Confirm PUT returns 200, revision 1 and the saved message.
   Never share Authorization headers, tokens or private response screenshots.
3. Refresh the same tab. The saved values should reload. Edit and save again; revision
   should increment. Empty name and malformed phone should show validation errors.
4. For a conflict check, independently sign into the same development account in a
   second tab and load Profile in both. Save an edit in the first tab, then save the
   stale second form. It should receive 409, preserve the draft and request a reload.
5. Sign out and sign in with a different development account if available. It must not
   receive the previous account's profile. Signing back into the first account restores
   its own saved profile. This is real profile storage, not seeded demonstration data.

The profile Node tests use fake tokens and network/storage models only. They verify
request boundaries, owner/revision checks, no automatic writes, stale-response cleanup,
conflicts, timeouts and truthful save states. CI runs both auth and profile test files.
Live database save/reload and visual browser review are separate manual checks.

## Saved assessment flow

- `/app/assessments/new` opens an unsaved description. It does not write automatically.
  Continue saves before opening clarification; Save & exit saves before returning to
  My Assessments. A description must contain 1–1,500 characters.
- `/app/assessments/:assessmentId/describe` reloads a saved description. Changing it
  clears earlier answers only after saving; leaving without saving discards edits.
- `/app/assessments/:assessmentId/clarify` restores saved answers and progress.
  Save & exit permits partial answers. Continue requires all three answers and saves
  before showing category-based public information links. **Suggest a category**
  optionally requests a suggestion for that saved revision. **Use this category**
  selects the radio option locally. The seeker can override it before saving.
- `/app/assessments` loads own metadata, filters by saved status and supports the next
  page/first page controls. Records reopen at Describe for Draft and Clarify otherwise.
  The list uses a short opaque reference as its title rather than exposing a private
  description. Complete answers are Awaiting pathways, not Results ready.
- Legacy `/app/assessments/clarify` without an identifier offers My Assessments;
  missing saved records show an error rather than an empty form that creates data.

Descriptions and answers never enter URLs, browser-managed application storage or
logs. URLs use opaque references, fixed status filters, pagination cursors and
the saved revision for category suggestions.
The existing SDK session persistence is unchanged. Account/route changes abort reads
and writes and ignore obsolete results. The server cannot cancel an already committed
write, so uncertain outcomes request a reload instead of claiming failure or retrying
automatically. Conflicts preserve the visible draft until explicit reload; this reload
replaces unsaved edits. There is no background autosave, automatic submit or fake result.

Manual verification after restarting the servers:

1. Sign in with a development account and open New assessment in that same tab.
2. Enter non-sensitive text. Use Save & exit and confirm a Draft appears in My Assessments.
3. Reopen it, edit the description and select Continue. Refresh Clarify and confirm
   the saved record opens. Answer one question and Save & exit; reopen to confirm it.
4. Complete the other questions and Continue. The owner-scoped results route
   shows published links based only on the saved category. My Assessments retains
   the storage progress label Awaiting pathways; it is not a saved classification.
5. Reopen, go Back to Describe, change/save the description, and confirm old answers
   are cleared. Status filters should reflect the saved progress.
6. With a second development account, confirm that the first account's records do not
   appear or open. In two independently signed-in tabs for the same account, load the
   same record, save one, then save the stale other form: expect 409 with draft retained.

All test tokens and records in the Node suite are isolated fixtures. Browser/live cloud
checks remain user-run. Never share bearer headers, tokens or private descriptions.

## Connected public catalogue

The existing Justice Services, Service Profile and Resources pages now load real
public records from FastAPI. Their existing search, URL filters, sorting, categories,
links and responsive styles remain. Public routes work signed out and do not require
configured Firebase Authentication. The configured `VITE_API_BASE_URL` is reused.

Public requests use GET with no bearer token, cookies, body, search text or referrer;
redirects are rejected and requests are bounded by a timeout. The client checks
schema versions, field types, bounds, unique IDs, source URLs, calendar dates and
detail-identifier matches before rendering. Old requests are cancelled/ignored when
a page, identifier or StrictMode lifecycle changes. Failures offer explicit retry;
only a confirmed detail 404 becomes Service not found, and empty published data is
distinct from unavailable storage. No fallback demo records are shown.

Source badges say Official source and Source checked. Dates refer to this project's
review of the publisher's page, not institutional endorsement or a freshness promise.
Profiles expose the exact source links used for their records. Missing contact data
prompts confirmation with the official source. The map remains unavailable because
no geocoding/map service is connected. Referral entry links open private project request forms; they do not contact institutions.

The service catalogue includes Judiciary Small Claims Court and Employment and
Labour Relations Court information, CAK Consumer Protection and NLAS Legal Aid,
with seven official resource links. The NLAS
profile retains its published scope limitation. No assessment description or answer
is used to rank these public records, and no legal eligibility decision is made.
See [source notes](../docs/public-catalog-sources.md).

Manual checks with both servers running:

1. Open `/services` while signed out; expect four services and GET 200.
2. Search `CAK`, filter/sort and clear filters. Refresh to confirm URL state remains.
3. View a service, check its source links/check date and inspect known versus missing
   contact fields. An unknown `/services/not-a-listed-service` should show not found.
4. Open `/resources`; expect six records. Exercise every category and an external
   Read more link. External sources open in a new tab, without submitting a request.
5. Stop the backend and reload a public page; expect an error, not empty results.
   Restart the backend and select Try again to confirm recovery.
6. Confirm phone-width layout, keyboard focus and links. Public catalogue requests
   in Network should contain no Authorization header. Private APIs still require it.

## Connected pathway pages

Continue from saved clarification opens `/app/assessments/:assessmentId/results`.
The fixed category rule is explained on the page. The private request includes an
ephemeral token and opaque assessment reference; no description, answers, UID query
or request body is sent. Identity is checked again after token retrieval and after
reading the response. Components are keyed by owner and assessment so departed
account responses cannot restore old information. Read timeouts, explicit retry,
missing assessments and incomplete clarification have distinct states.

The generic `/app/assessments/results` route offers general browsing and a link to
My Assessments. Its four guides are explicitly not personalised results.
`/pathways/:pathwayId` is public and includes the related real service profile,
official sources, review date and a working Create my checklist link.
`/app/checklists/new?pathwayId=...` requires sign-in and loads a versioned checklist
template. Save checklist or Save & exit explicitly saves progress. My Checklists
reopens `/app/checklists/:checklistId` with the saved ticks and source snapshot.
Only unsaved changes are lost on refresh or departure. Continue to referral opens the project request form for that pathway. Saving a referral request is a separate, explicit action; unsaved checklist ticks are not saved by following the link. No upload, evidence validation, filing or deadline protection is performed.
An optional validated assessment reference preserves the return link only; it does
not change the public data request or establish ownership/eligibility.

Run `node --test tests/auth.test.cjs tests/profile.test.cjs tests/assessments.test.cjs tests/catalog.test.cjs tests/pathways.test.cjs`
from the frontend folder. See the bundle guide for browser acceptance checks.

## Saved checklist behaviour

Create checklist without a pathway opens a source-guide chooser. Opening a template
or saved list never saves a record. Each new editor keeps one opaque ID, including
uncertain-save recovery. Save progress with Save checklist; Save & exit confirms
the write before returning to My Checklists. In progress / Complete / No items
filters use paginated owner summaries. Counts reflect ticks saved to Firestore,
not legal completion or institutional review. Saved snapshots keep the original
item meanings and source-review date even if current public guides later change.

Editor and list children are keyed by UID plus route/filter. Private transports
capture and recheck the current Firebase user around token/fetch/JSON operations.
No credential, tick, source text, name or private description enters a URL. Only
opaque references, a public pathway ID and fixed filter values may appear there.
On conflict or an uncertain save, edits remain visible and another write is blocked
until Reload saved checklist replaces them. A confirmed response must match the
owner, reference, template, returned ticks and next revision. Sign-out clears pages.

Run all six suites:
`node --test tests/auth.test.cjs tests/profile.test.cjs tests/assessments.test.cjs tests/catalog.test.cjs tests/pathways.test.cjs tests/checklists.test.cjs`.
Browser acceptance: save partial ticks, refresh and reopen, complete and filter,
untick/save, test two-tab revision conflict and another account's inaccessible ID.


## Saved referral requests

`/app/referrals/new` chooses a real public pathway; `?pathwayId=...` resolves its related service from the API. Service entry points can filter the chooser with `?serviceId=...`. The selected service and pathway cannot be freely supplied in the form. Save referral request sends validated fields in an authenticated PUT body. Only public pathway/service references and an opaque `requestId` enter URLs. No request fields are put in browser storage.

One random request ID is kept before sending. Confirmed saves navigate to `/app/referrals/{id}/confirmation`; that page must GET the owned record before showing success. Refreshing or retrying the form checks the same request ID. Unknown write outcomes block another save until reload; use My Referrals to recover an existing record. A duplicate create never overwrites or creates a second record with that ID. Starting a separate new form deliberately creates a separate request intent.

`/app/referrals` lists only the account's summary records with cursor pagination; `/app/referrals/{id}` reads the private details. The only history event is the server-recorded project save. Missing, forbidden or failed reads never display success or fake empty results. API and resource lifecycles discard late responses after account/page changes. Authentication and configured backend/Firestore are required. No new environment settings or dependencies are needed.

The current project saves contact details and a description; it does **not** deliver them to the organisation, send email/SMS notifications or verify the stated contact preference. Successful saves create account-only in-app updates as described below. The development referral workflow handles optional sharing and progress from the saved request. Test only with non-sensitive inputs. Run the existing frontend tests plus `node --test tests/referrals.test.cjs` from frontend.


## Dashboard counts, recent saves and referral preview

`/app` reads authenticated `GET /api/v1/dashboard` using the verified session. The component/resource is keyed by UID. Token, response and JSON processing verify that the same Firebase user is still active. Abort, timeout, reload and unmount discard obsolete results; summary fields are not persisted in browser storage. Requests use GET only, no body or owner query, no cookies, no cached responses and no redirects. The returned UID and all displayed summaries are validated before publication.

Cards show **Saved assessments**, **Saved referrals**, **Checklist progress** and **Saved checklists**. The previous unsupported saved-resource figure is replaced with a supported saved-checklist total. Assessment totals include every saved draft/clarification state; referral totals mean project records, never open institutional cases. Progress describes the most recently updated saved checklist. A confirmed empty account shows three zero totals and no saved checklist; a zero-item checklist shows No items. Loading and failed reads never appear as zero or reuse old account data.

Recent activity shows the six most recent records' latest saves. Links resume the assessment's saved step, the checklist or the referral. The referral preview shows the latest account-owned summary and **Not sent to an institution**, with no contact or description fields. Refresh dashboard reloads the summary; navigating back from a saved form loads it again. Dashboard reads do not poll, create notifications, trigger provider workflow or make an institutional handoff. Saved-record notifications are handled separately below.

Run all existing frontend tests plus `node --test tests/dashboard.test.cjs` from frontend. The backend suite automatically discovers `test_dashboard.py`. Browser verification should compare counts with saved lists, save an assessment/checklist/request, return to dashboard, and check links, latest-record updates, a second account, confirmed empty data and backend-unavailable retry behavior.


## Connected Notifications

`/app/notifications` is account/session protected and loads existing in-app save updates. `?unread=true` filters unread updates on the server; `?after={id}` pages through older updates. Filter changes reset pagination and create a UID/filter/cursor-keyed resource so late old-account/page responses cannot restore previous data. Requests check identity before/after token lookup, HTTP and JSON, and use no cookies, redirects, cached results or private query text. GET has no body. Mark requests contain selected notification IDs only.

Opening or refreshing the page does not change unread status. Each unread row offers Mark as read. Mark displayed as read applies only to the currently displayed unread rows, not unseen pages or future saves. The controller blocks repeated actions while saving, waits for API confirmation and reloads the list before publishing Read badges. Uncertain failures clear the list and require reload before further writes. A confirmed write followed by a failed refresh is reported separately. The source-record link opens the current saved record, not an editable historical revision. Read state remains saved after browser refresh or sign-out.

These notifications begin with successful saves after this feature is applied. Earlier records remain available in their normal lists but have no retroactively invented notifications. New saves of assessments/checklists and edits of unshared referrals create new updates; older events are not resubmitted. Fixed titles/body copy are derived from notification kind, never user-entered descriptions or backend-supplied HTML. Read status is not institutional review, email delivery or proof that a person opened the linked record. Preferences, deletion and external notification delivery remain unavailable.

Demonstration referral assignment, review started and review completed each add an unread update to the seeker's inbox. **View referral** opens the original private request and its current demonstration history. Earlier progress stays in referral history. Existing read controls apply to both progress updates and saved-record updates.

Run all existing frontend suites plus `node --test tests/notifications.test.cjs`. Backend tests automatically include `test_notifications.py`. Browser verification should create each source type using non-sensitive inputs, check notifications and links, mark one and displayed rows, refresh, filter and page, save another revision, test another account and verify unavailable/retry states.

## Connected administrator catalogues

Use `/admin`, `/admin/services`, `/admin/pathways` and `/admin/resources` with a verified development admin account. Overview shows published catalogue counts. Justice Services, Pathways and Resources support persistent draft creation, viewing, editing, reviewed publication, archiving and confirmed deletion of unused drafts. They include local search and publication filters. The pathway editor includes guidance lists, starting steps, preparation checklist items and published service choices. Resources adds category filters, ten-entry pages and official link metadata. Public-page and source links open the corresponding published information.

Run `node --test tests/resource-management.test.cjs` for resource boundaries and confirmed-write checks. Follow the [resource CRUD acceptance guide](../docs/resource-management.md) for live Firestore and public-library verification.

Run `node --test tests/pathway-management.test.cjs` for pathway writes, confirmation and lifecycle checks. Follow the [pathway CRUD acceptance guide](../docs/pathway-management.md) to verify live Firestore, nested editor refresh and preservation of saved user snapshots. Source-review dates use the Africa/Nairobi calendar day.

Run `node --test tests/service-management.test.cjs` for service-management boundaries and state checks. Follow the [service CRUD acceptance guide](../docs/service-management.md) to verify the live Firestore workflow.

The page checks the verified role before mounting its request controller. Every fetch sends the current account token to a fixed admin API path. The controller clears old data when the account or page changes and distinguishes permission denial, catalogue errors and confirmed empty results. Run `node --test tests/admin-catalog.test.cjs` from frontend for the new boundary and filtering checks.

## Demonstration referral views

In My Referrals, open a saved request and opt in to sharing the demonstration metadata. Use `/admin/referrals`, click **Choose provider**, select a matching development provider by name/account label, then click **Assign provider**. Use `/provider` as the assigned provider to start and complete a demo review. Return to My Referrals to read the event history or withdraw sharing. These views use the existing authenticated referral transport and refresh controls. A confirmed update changes the visible status. A conflict or uncertain save requires a refresh before retrying.

Search and browsing remain in the account and catalogue routes. The demonstration queues page through twenty results at a time. Run `node --test tests/demo-referrals.test.cjs` from frontend to verify transport, metadata parsing and saved outcomes.

## Connected administrator audit logs

`/admin/audit-logs` displays recorded successful Services, Pathways and Resources
changes. Apply record type, action, reference and inclusive Kenya-date filters;
open read-only details and page through history. Refresh starts with newest events.
Empty filtered pages may still offer Next. Actor UIDs, target references and saved
revisions come from the API; descriptions and contacts are excluded. There are no
edit, delete or export controls. Account changes and failures clear stale rows.
Run `node --test tests/audit-logs.test.cjs` and follow the
[live audit-log check](../docs/audit-logs.md).

MVP check: share a fresh test referral as seeker. In Administrator → Referrals,
click **Choose provider**, select the matching provider by label, then **Assign
provider**. No UID entry is needed. Sign in as that provider, start and complete
review, then confirm the seeker’s status history and notifications. A provider
registered for another service must not appear. The existing development role
setup still applies once when preparing provider accounts.

## Delete a saved checklist

In My Checklists, choose **Delete checklist** and accept the browser confirmation.
Cancel makes no request. The API checks the current account and saved revision.
The list refreshes only after an exact deletion receipt; repeated clicks are
blocked. Conflicts and uncertain outcomes require **Reload checklists** before
another deletion. Confirmed deletion with failed list refresh is reported separately.
A refreshed dashboard excludes the removed checklist. Assessments/referrals and
previous notification history are kept; deleted checklist links show not found.

Live check: create a non-sensitive checklist, save a tick, then open My Checklists.
Cancel deletion once and confirm it stays. Delete it, refresh, and confirm it stays
absent. Check the dashboard count, another account's checklist, and an old editor
or direct URL. In two tabs, save an edit in one and delete the stale revision in
the other; reload must be required. The existing create/view/update flow must
continue working. Automated checks remain in tests/checklists.test.cjs and
backend/tests/test_checklists.py.

## Delete a saved assessment

My Assessments offers **Delete assessment** with browser confirmation for Draft,
Needs clarification and Awaiting pathways records. Cancel sends no request. Only
the current account's record and saved revision can be deleted. An exact receipt
is required before refreshing the list; repeated clicks are blocked. Conflicts or
uncertain outcomes require **Reload assessments**. A confirmed deletion followed
by failed refresh is reported separately. Saved checklists/referrals and earlier
notifications remain. An old assessment or result link shows not found; new
assessments receive fresh IDs. Refreshed dashboard counts exclude deleted records.

Live check: save a disposable assessment and, if desired, a checklist/referral
from its results. Cancel deletion once, then delete and refresh. Check the
assessment remains absent, dashboard counts update, and saved checklist/referral
copies still open. Test a different account and an old editor. In two tabs, save
an edit in one, then attempt stale deletion in the other; reload must be required.
Existing description, clarification and optional suggestion flows must still work.
Tests remain in tests/assessments.test.cjs and backend/tests/test_assessments.py.


## Manage an unshared saved referral

Open My Referrals, then View details. Manage saved request offers Edit request
and Delete request only when the API confirms no sharing history exists. Edits
allow contact fields and description, require a fresh acknowledgement, and keep
the selected pathway/service and original save date. Save changes waits for an
exact owner/reference/next-revision/field confirmation. Cancel editing discards
local edits. No form values are saved in browser storage or page URLs.

Delete request uses a confirmation dialog, sends only the expected revision in an
authenticated DELETE body, validates the receipt and returns to the freshly
loaded list. A stale or uncertain mutation blocks further writes until Reload
referral checks the saved state. A deleted record returns not found; start a new
request instead of reusing its old link. Historical notification links may no
longer open it. Shared, withdrawn and completed demonstrations keep their history
and cannot be edited or deleted. Sharing/withdrawal refreshes the management
permission; the backend always enforces it even from an older tab.

Live acceptance using non-sensitive development data:
1. Save a new referral without sharing. Open details, edit name/description,
   acknowledge and save. Refresh and verify the edits and original service.
2. Cancel an edit and a deletion; verify the record stays unchanged.
3. Confirm deletion of that unshared request. Refresh the list and dashboard,
   and verify the old details link cannot reopen it. Other records stay present.
4. Share another fresh request. Confirm edit/delete controls disappear; assign
   a provider, complete review and verify seeker history and notifications.
5. Withdraw sharing; confirm edit/delete stay unavailable. Another account must
   not open or mutate either private request. Two-tab stale edits must require
   reload rather than overwrite a newer save.

## Administrator Users page

`/admin/users` lists up to 50 Firebase Authentication accounts per API page, with
page-local name/email/reference search, role filtering, cursor paging and a View
account dialog. New account opens a short form for name, email, role and initial
password. A provider must choose a published service; an administrator must
explicitly confirm the broader access shown in the form. Published services have
their own reload control if that catalogue read fails.

The form requires a 12–128 character initial password and clears it as soon as a
creation request starts. It never stores it in local/session storage, URLs or the
account result. Creating an account does not sign out or replace the current
administrator session. No welcome email, account-role editing, disabling, deletion
or export is included in this school MVP batch. Public sign-up stays seeker-only.

Exact name/email/role/service/active-status confirmation is required before success
is shown. Repeated submit is blocked. A conflict or uncertain outcome requires
Reload accounts, which inspects the exact creation reference before refreshing the
list. A disabled recovered account is shown as disabled, not as successfully
provisioned. A confirmed creation with a failed list refresh is reported separately.
Account changes and page departure discard late responses and clear loaded data.

Live acceptance with development accounts you control:
1. As admin, open Users → New account. Enter a name, an unused test email you
   control, a unique initial password and Service provider. Choose the same
   service as a test referral, confirm its access, and create. Refresh and check
   the account is active with that role/service. The current admin stays signed in.
2. In a separate browser session, sign in using the new provider account. Assign
   a shared test referral for its service through the admin provider dropdown,
   then start/complete review as that provider.
3. Create an Administrator with another unused test email, confirming the admin
   access. Sign in separately and verify the admin workspace opens.
4. Retry an existing email: expect a conflict and no change to that account.
   Reload accounts to inspect it. Cancel a filled form and verify no creation.
5. Sign in as a seeker/provider and verify the Users route/API are denied. New
   normal registrations must still receive the seeker role.

## Larger dashboards with complete totals

Charts have larger canvases, readable values and horizontal bars for long labels.
The theme is unchanged. The seeker dashboard retains full own-account counts,
latest checklist and recent-save summaries. Referral previews now link to any
recorded demonstration history rather than claiming that no action is recorded.

The administrator overview reads /api/v1/admin/dashboard for catalogue, all-account
role/status and demonstration totals. The provider queue loads a separate complete
membership summary; its chart covers all assigned records, not its 20-row page.
A confirmed progress write refreshes the summary. Zero values require confirmed
reads; failed refreshes clear old figures. Text counts remain if chart rendering
fails. Private descriptions and contact fields are excluded from these summaries.

Live acceptance: save/edit/delete a seeker record and refresh; check counts and
latest-record links. Create a provider/admin account and refresh admin totals.
Share, assign, start and complete a school demonstration, then refresh both role
dashboards. Provider totals must remain stable while paging beyond 20 records.
Withdrawal removes the record from provider totals. Check mobile readability
and a failed API read before restoring the connection.

## Employment browser check

1. Save a new fictional assessment: “My employer has not paid my salary for
   two months despite my scheduled work.” On Clarify request a suggestion;
   expect Employment, then select Use this category. Choose the timeframe and
   prior-contact answers truthfully for this fictional case, and Continue.
2. Expect Employment dispute information, linked to the official Judiciary
   source. Open preparation, tick two items, save and refresh. They stay ticked.
3. Save a test private referral. Confirm it targets the employment information
   service; editing/deletion and demo sharing follow the existing rules.
4. To test all roles, create a separate development Provider for this service
   from Administrator → Users. Share the request as seeker, choose that provider
   as administrator, then start and complete review as provider. Confirm the
   seeker's history and notifications. This does not enrol the Judiciary.
5. Reopen an older Other assessment whose narrative mentions employment.
   Reading/requesting a suggestion must not change its saved category or
   revision. Only explicitly selecting Employment and saving changes results.
6. Try “I need some help please.” Expect Unsure and usable manual choices.
   Resource browsing and administrator resource editing include Employment.

## Abstention browser regression

Restart the backend and follow [the four examples](../docs/issue-abstention.md#limits-and-browser-check).
Mixed complaints and vague wording should show Unsure with manual choices usable.
A clear shop complaint with ordinary loan repayment as background should remain
Consumer. A clear employment complaint should still suggest Employment. Confirm
that manually choosing a category after Unsure saves and survives refresh.
