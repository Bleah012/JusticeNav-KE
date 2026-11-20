# Administrator justice service management

The first catalogue CRUD feature is available at `/admin/services`. Only a
Firebase identity verified by the API with the `admin` role can read drafts or
change services. Seeker and provider accounts cannot use the management API.

## Storage and publication

The reviewed JSON catalogue supplies the initial service entries. When Firebase
is configured, the API reads the Firestore document
`publicCatalogue/services-v1`. If the document does not exist, reads expose the
reviewed baseline without writing it. The first administrator mutation atomically
saves the complete catalogue and creates a metadata-only event in
`serviceCatalogueAudit`. Subsequent changes use Firestore transactions and
per-service revisions. No manual seed import is needed.

The document holds at most 50 live service entries, up to 1,000 reserved deleted
identifiers, and at most 750,000 UTF-8 bytes of serialized content. These bounds
keep this small project catalogue within a single Firestore transaction document.
For a larger directory, replace this bounded repository with paginated documents
and a separate publication/index strategy.

The default Firestore database and existing backend credentials are used. Browser
Firestore access remains denied by `firestore.rules`; writes pass through FastAPI.
No credentials or live records are needed by automated tests.

Without a configured Firebase project, public browsing continues to use the
reviewed JSON baseline and management writes report unavailable storage. With a
configured project, failed Firestore reads return 503; they do not silently show
old JSON content or report an empty catalogue. [Resources are now managed
separately](resource-management.md). [Pathways are also managed separately](pathway-management.md)
with transactionally protected service links.

New services start as drafts. Publishing or editing a published entry requires
an explicit source-review acknowledgement and a review note. The editor supports
all public profile fields, source links and institutional contact details.
Source dates must be real calendar dates no later than today. Approved HTTPS
source hosts remain `judiciary.go.ke`, `cak.go.ke`, `nlas.go.ke` and their `www`
variants; this feature does not widen that existing allowlist.

Only published services enter public service lists, detail pages, admin overview
counts and referral selection. Drafts and archived records are administrator-only.
Administrative revision metadata, actor identities and review notes are excluded
from public responses.

Published entries can be archived and subsequently republished after review.
Services referenced by the current published pathway catalogue cannot be archived;
this prevents broken pathways. Previously saved checklist and referral snapshots
are never rewritten by catalogue edits. Only never-published, unused drafts can
be permanently deleted. Deleted references remain reserved, preventing a retry
or later create from restoring a removed entry accidentally.

## API contract

All endpoints below require the verified administrator token and return
`Cache-Control: no-store`:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/admin/service-records` | List records and protected service references |
| GET | `/api/v1/admin/service-records/{id}` | Read a full administrative record |
| PUT | `/api/v1/admin/service-records/{id}` | Create a draft (`expectedRevision: 0`) or edit an existing revision |
| PUT | `/api/v1/admin/service-records/{id}/publication` | Publish or archive an existing revision |
| DELETE | `/api/v1/admin/service-records/{id}` | Delete an unused draft using a JSON `expectedRevision` body |

Every write checks the saved revision. Missing or invalid authentication returns
401, other roles receive 403, missing records return 404, conflicting revisions
or protected operations return 409, invalid input returns 422, and unavailable
storage returns 503. Error bodies do not echo submitted values or storage errors.

The earlier `/api/v1/admin/services` endpoint remains a read-only projection of
published entries for compatibility. The management page uses the new endpoints.
Audit events are recorded atomically and appear in
[Administrator Audit Logs](audit-logs.md).

## Local acceptance check

Restart the API and frontend, then sign in with your development administrator.
Use only clearly labelled, non-sensitive test entries and genuine official source
links already present in the catalogue. Do not publish invented institutional
facts. To test publication without creating new claims, copy the public details
of an existing service into a clearly labelled temporary demonstration entry.

1. Open **Justice Services**, then **Add service**. Choose a new stable reference.
   Fill the required profile and official-source fields. Save the draft.
2. Refresh the browser. Find the draft and use **View details** to check its fields.
   Open the public service directory separately: the draft must be absent.
3. Edit the draft, save a changed description, refresh and verify it persisted.
4. Select **Publish**. Record the actual review note and acknowledge the source
   review. Confirm publication. Check the public directory and detail page.
5. Archive this unlinked test service. Check that it disappears publicly and
   remains under the administrator's **Archived** filter. Republish after review.
6. Create a second test draft. Cancel its deletion once, then confirm deletion.
   Refresh and confirm the draft remains absent. Reusing its reference is blocked.
7. Confirm that services labelled **Linked to a published pathway** cannot be
   archived and published entries do not offer permanent deletion.
8. Open the same service in two admin tabs. Save in one; saving the old revision
   in the other must require a reload rather than overwrite the newer change.
9. Sign in as a seeker and then a provider. Neither may access the service manager
   or call its write endpoints successfully.

Automated checks: backend `test_service_management.py`, frontend
`service-management.test.cjs`, the existing regression suites, lint, formatting
and production build. Browser fixture checks exercise forms without live writes;
the acceptance sequence above verifies your actual Firestore connection.
