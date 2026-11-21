# Administrator pathway management

Use **Administrator → Pathways** (`/admin/pathways`) to create, view, edit,
publish, archive and delete unused drafts. The existing `/admin/pathways/new`
and `/admin/pathways/{id}/edit` routes now persist changes through the verified
administrator API. Seeker and provider accounts cannot read drafts or write.

## Content and publication

The editor supports a stable reference, title, descriptive category, related
published service, overview, audience, matters covered, requirements, starting
steps, next stages, official sources and preparation checklist items. Add or
remove steps and checklist items; keep item IDs stable when revising a prompt.
References use 3–64 lowercase letters, numbers and single hyphens. They cannot
be renamed or reused after deletion.

New entries are drafts. Public reads expose published entries only. Publishing
and editing a published guide require explicit source-review acknowledgement
and a review note. Dates use the Africa/Nairobi calendar day and cannot be in the future. Approved HTTPS source hosts
remain judiciary.go.ke, cak.go.ke, nlas.go.ke and their www variants. Entering a
link or review date does not independently verify its contents.

The related service must be published. A draft linked to a subsequently archived
service stays visible to administrators but must be relinked before publication.
A published pathway prevents its service from being archived. Both operations
read both Firestore catalogue documents within their transactions, preventing
simultaneous pathway publication and service archiving from breaking the link.

The existing assessment mapping uses `cak-consumer-complaint` and
`small-claims-information`. These two guides remain editable after review but
cannot be archived. Other published guides can be archived and republished.
Permanently delete only never-published, unused drafts; published history is
retained through archiving. Deleted references remain reserved.

Descriptive categories do not alter assessment matching. `selected-category-v1`
remains unchanged. New published guides enter public catalogue reads and
`/pathways/{id}` but are not automatically added to assessment category results.

## Saved user snapshots

New preparation templates use current published guide content. Editing a title,
source or preparation item changes its template fingerprint; a new checklist
save based on an outdated template returns 409 and must reload.

Existing saved checklists retain their labels, notes, source snapshot and ticks.
They can still reopen and save progress after editing or archiving the guide.
Existing private referrals keep their original pathway/service snapshot and
selection version. Catalogue edits never rewrite account records. Archived
guides return 404 for new public detail, template and referral-selection reads.

## Storage and API

The default Firestore document is `publicCatalogue/pathways-v1`. If absent,
reads expose the reviewed JSON baseline without writing. The first mutation
persists that baseline plus the change. Each mutation atomically appends a
metadata-only event to `pathwayCatalogueAudit`. Public responses exclude internal
notes, revisions and actor IDs. Recorded changes appear in [Administrator Audit Logs](audit-logs.md).

Limits: 30 live records, 1,000 reserved deleted IDs, 750,000 serialized UTF-8 bytes
per state document, 10 entries per guidance list, 15 preparation items and 8
sources. Calendar dates and timestamps are serialized as strings. Existing backend
credentials and deny-all browser Firestore rules apply; no manual seed is needed.

Without configured Firebase, public browsing uses reviewed source files and
management storage is unavailable. With Firebase configured, storage failures
return 503 instead of silently showing old files or guessed empty results.

| Method | Endpoint | Operation |
| --- | --- | --- |
| GET | `/api/v1/admin/pathway-records` | Records, protected IDs and published service choices |
| GET | `/api/v1/admin/pathway-records/{id}` | One full administrative record |
| PUT | `/api/v1/admin/pathway-records/{id}` | Create with expectedRevision 0, or edit the saved revision |
| PUT | `/api/v1/admin/pathway-records/{id}/publication` | Publish or archive with a revision check |
| DELETE | `/api/v1/admin/pathway-records/{id}` | Delete an unused draft with JSON expectedRevision |

Responses use Cache-Control: no-store. Errors are 401 for invalid identity, 403
for other roles, 404 for missing records, 409 for stale/protected operations, 422
for invalid input and 503 for unavailable storage. Rejected values are not echoed.
The earlier `/api/v1/admin/pathways` remains a read-only published projection;
overview totals count published entries. The browser shares the tested catalogue
lifecycle controller with service management: duplicate writes are blocked,
uncertain outcomes require reload, and departed-account responses are discarded.

## Live development check

Restart both servers and sign in as development administrator. Use non-sensitive
test inputs. For publication checks, copy already reviewed guide content and
genuine source links into a clearly labelled demonstration entry.

1. Choose **Create pathway**, enter a new reference and required fields, select
   a published service, and add a starting step and preparation item. Save draft.
2. Refresh. Use **View details** and **Edit pathway** to check all fields. Refresh
   the nested edit URL to verify it reloads confirmed data.
3. Add and remove steps and checklist items, change a requirement and save.
   Duplicate preparation references must be rejected.
4. Confirm drafts are absent publicly. Publish after source review and open
   **View public pathway** to check requirements, sources and checklist items.
5. As seeker, save a checklist with a tick and a private referral from the guide.
   Edit the guide as administrator. Reopen the seeker records: their snapshots
   and tick must remain unchanged.
6. Archive the temporary guide. New public access must be unavailable while saved
   seeker records still reopen. Republish after review to restore public access.
7. Create another draft; cancel deletion once, then confirm it. Refresh and verify
   it stays absent. Reusing its reference must be blocked.
8. The two assessment-linked baseline guides must not archive. Save an edit from
   one of two admin tabs; the older tab must require reload rather than overwrite.
9. Seeker/provider management access must fail. Archiving a service linked to a
   published guide must also fail.

Automated checks: backend `test_pathway_management.py`, frontend
`pathway-management.test.cjs`, existing regression suites, lint and build.
Browser fixtures use isolated storage; this sequence checks live Firestore.

## Employment release additions

The explicitly added employment seed record is included in older catalogue states
when its ID is absent from both records and deleted IDs. Existing edits, archives,
drafts and tombstones take precedence. Reads remain read-only; the next normal
transaction persists the overlay. A new employment pathway stays draft when its
service is not published. Source review dates for older records are unchanged.
