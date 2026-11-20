# Administrator resource management

Use **Administrator → Resources** (`/admin/resources`) to create, view, edit,
publish, archive and delete unused resource drafts. The overview links to this
page. The public library remains at `/resources` and shows published entries only.

## Content and publication

A resource contains a stable reference, title, description, one or more categories,
official source name, official HTTPS URL and actual source-review date. Categories
remain `preparation`, `self-representation`, `consumer` and `civil`, matching the
existing public library filters. Duplicate and unsupported categories are rejected.

References use 3–64 lowercase letters, numbers and single hyphens. They cannot be
renamed or reused after deletion. Source links use the existing allowlist:
judiciary.go.ke, cak.go.ke, nlas.go.ke and their www variants. Credentials, query
strings, fragments, ports and non-HTTPS links are rejected. Titles, descriptions
and source names are bounded to 2,000 characters. Review dates use the
Africa/Nairobi calendar day and cannot be in the future.

New entries are private drafts. Publishing or editing a published entry requires
a review note and explicit source-review acknowledgement. Entering a URL or date
does not independently verify the source's contents. Publishing updates the public
library and overview totals after confirmation. Archiving removes the public
entry while preserving its administrative record. Republish after source review.
Permanently delete only never-published drafts, with a separate confirmation.

The editor manages descriptions and links; it does not upload documents, fetch
publisher content, send messages to institutions or change the assessment model.
Resources do not modify service/pathway definitions or saved user snapshots.

## Storage and API

Existing reviewed entries in `backend/app/public_catalog.json` provide the baseline.
The Firestore document is `publicCatalogue/resources-v1`. Reads of a missing
document expose the baseline without writing. The first explicit mutation saves
that baseline and the change. Each subsequent write uses a revision-checked
transaction and atomically creates metadata in `resourceCatalogueAudit`.
View recorded changes in [Administrator Audit Logs](audit-logs.md).

Limits are 100 live entries, 1,000 reserved deleted references and 750,000 UTF-8
bytes of serialized state. Archived entries count toward the live-entry bound.
Source calendar dates and timestamps are stored as JSON-compatible strings.
Existing backend credentials and deny-all browser Firestore rules apply.

With Firebase configured, the public catalogue combines managed services and
resources; published resources supply `/api/v1/resources` and overview counts.
Storage failure is a generic 503, never guessed empty data or silent fallback to
older files. Without Firebase configured, public browsing still uses the reviewed
file and management storage is unavailable. No manual seed or index is required.

| Method | Endpoint | Operation |
| --- | --- | --- |
| GET | `/api/v1/admin/resource-records` | Full administrative list |
| GET | `/api/v1/admin/resource-records/{id}` | One administrative record |
| PUT | `/api/v1/admin/resource-records/{id}` | Create with expectedRevision 0, or update the saved revision |
| PUT | `/api/v1/admin/resource-records/{id}/publication` | Publish or archive |
| DELETE | `/api/v1/admin/resource-records/{id}` | Delete a draft with JSON expectedRevision |

The API verifies the Firebase administrator role before storage access. Invalid
identity returns 401; seeker and provider access returns 403; missing records return
404; conflicts/protected operations return 409; invalid input returns redacted
422; unavailable storage returns 503. Responses use Cache-Control: no-store.
Public projections omit internal notes, revisions, actor IDs and deleted references.

The browser uses the shared catalogue controller. It validates owner, role, IDs,
publication state and exact save/delete confirmations. Writes are serialized;
timeouts, conflicts and uncertain outcomes require reload before another action.
Account changes and unmounting discard late responses. Search, publication/category
filters and ten-entry pages operate on the confirmed bounded list. Filtering and
opening details never submit a write.

## Live development check

Restart both servers. Sign in using your development administrator and use only
non-sensitive test entries. For publication, copy reviewed public information and
genuine source links into a clearly labelled demonstration resource.

1. Open **Resources → Add resource**. Enter a unique reference, title, description,
   category, source name, official link and actual review date. Save the draft.
2. Refresh, search for it and use **View details**. Edit the description or selected
   categories, save and refresh again. Confirm that no selected category is lost.
3. Use **View public library** in a separate tab. The draft must be absent.
4. Publish after recording the actual review note and acknowledging source review.
   Reload the public library; check the title, description, source link and each
   relevant category filter. Check the overview's published resource total.
5. Edit the published entry after review and confirm the public update. Archive
   it; verify public absence and administrative visibility under **Archived**.
   Republish after review to restore it.
6. Create a second draft. Cancel deletion once, then confirm deletion. Refresh and
   verify it remains absent. Reusing its reference must be blocked. Published and
   archived entries must not offer permanent deletion.
7. Open the same draft in two admin tabs. Save in one; the stale tab must require
   reload instead of overwriting the newer revision.
8. Verify seeker and provider accounts cannot open `/admin/resources` or write its
   API. Their normal public Resources links should still work.

Automated checks: backend `test_resource_management.py`, frontend
`resource-management.test.cjs`, the existing suites, lint and production build.
Browser fixture checks use isolated storage; this sequence verifies live Firestore.
