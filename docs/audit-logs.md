# Administrator catalogue audit logs

Open **Administrator → Audit Logs** (`/admin/audit-logs`). This is a read-only
history of successful Services, Pathways and Resources changes. It combines the
existing `serviceCatalogueAudit`, `pathwayCatalogueAudit` and
`resourceCatalogueAudit` collections. The existing CRUD transactions remain the
only writers; viewing, filtering, refreshing and paging do not append events.

## Scope and metadata

Supported actions are create, update, publish, archive and delete. Each event shows
its namespaced event ID, actual actor UID, target kind/reference, resulting saved
revision and timestamp in Kenya time. Results say **Succeeded** because an event
is committed atomically with a successful catalogue change. Failed writes,
sign-ins, denied requests and referral progress are not recorded in these three
collections and are not invented by this viewer. Seeded catalogue entries do not
acquire fabricated creation events. Older changes are visible if their original
audit records exist. Deleted draft and archived entry events remain visible.

The API whitelists metadata. It excludes descriptions, contacts, review notes,
tokens and unrelated stored fields. The page has no edit, delete or export action.
Actor UIDs are administrative identifiers, not public information.

## API and pagination

`GET /api/v1/admin/audit-logs` requires the verified administrator role before any
storage query. Seeker/provider tokens receive 403; missing/invalid tokens receive
401. The optional query parameters are:

| Parameter | Meaning |
| --- | --- |
| `kind` | `all`, `service`, `pathway`, `resource` |
| `action` | `all`, `create`, `update`, `publish`, `archive`, `delete` |
| `query` | Case-insensitive substring of event, actor or target reference, up to 200 characters |
| `from_date`, `to_date` | Inclusive Kenya calendar dates (`YYYY-MM-DD`) |
| `cursor` | Opaque continuation returned by the preceding matching request |

Responses contain schemaVersion 1, the verified UID, role `admin`, readOnly true,
up to 25 events, and nextCursor (or null). All API responses use no-store. Invalid
filters/cursors return a redacted 422; unavailable or malformed storage returns a
generic 503, never guessed empty history or a partial success from one collection.

Each relevant collection is ordered by occurredAt descending and document ID
descending, using its default single-field index. Date bounds use the same timestamp
field; no action/target composite index is needed. Fetches are limited to 151 rows
per collection per request, with explicit RPC timeout/retry bounds. A merge scans
at most 150 candidates and returns at most 25 matches. Filters can therefore yield
an empty page with a continuation; **Next** continues scanning older history.
This avoids unbounded reads and misleading complete-history totals.

Cursors preserve microsecond timestamps and the last consumed ID separately for
each collection, and are bound to normalized filters. Equal timestamps and
overlapping document IDs across collections remain distinct. They are validated
continuation positions, not authorization credentials or permanently frozen
snapshots. **Refresh audit logs** and filter changes start with the newest page.
Previous pages are re-read. A new event created during paging is reliably found by
refreshing. Events missing occurredAt cannot be returned by Firestore's timestamp
index; this viewer does not backfill or repair historical records.

Reads use the existing backend credentials and deny-all browser Firestore rules.
No new credentials, security-rule changes, seed operation or browser Firestore
connection are needed. Unconfigured credentials fail with an unavailable state.

The browser validates owner/role, known actions, target references, revisions,
filter consistency, stable ordering, unique IDs and cursor progress. It uses the
existing bounded read controller. Account changes, page changes and unmounting
discard late responses. Failed reads clear previous rows; timeouts show an error.

## Live development check

Restart both servers and sign in with your development administrator. Use only
non-sensitive drafts and genuine reviewed sources if publishing.

1. Open Audit Logs. Existing catalogue changes should appear newest first with
   Kenya timestamps. A genuinely unused project may have empty audit history.
2. Create a resource draft with a unique reference (for example
   `audit-check-resource`). Edit its description, save, then delete that unused
   draft. Refresh Audit Logs. Filter **Resource**, search the reference and apply.
   Expect one Created, one Updated and one Deleted draft event, with revisions
   1, 2 and 3. View each event; check the actor UID against your local account.
3. Filter each action and today's Kenya dates. Check the same recorded events,
   then clear filters. Reversed dates must show validation feedback.
4. Check Services and Pathways events from the previous CRUD tests. For a fresh
   check, create/edit/delete a separate unused draft of each type using those
   editors. Confirm the correct type, reference and revisions in Audit Logs.
5. If reviewing a genuine test publication, confirm its Published and Archived
   actions; do not publish fabricated institutional information for this check.
6. Where history has more than 25 matches, use Next and Previous. Events with the
   same time must not repeat within a page. An empty filtered page may still offer
   Next. Refresh starts at the newest events. Browser refresh must still load.
7. Open and filter the page repeatedly. No new events should appear from these
   reads. Deleted draft events must remain. There are no edit/delete controls.
8. Sign out, then test seeker and provider accounts. They cannot open
   `/admin/audit-logs` or access its API. Their normal workspaces still load.

Automated verification uses isolated records, not live Firestore. Run
`backend/tests/test_audit_logs.py`, `frontend/tests/audit-logs.test.cjs`, the full
existing suites, lint, formatting and the production build.
