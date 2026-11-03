# Pathway guidance and preparation provenance

Project review date: **2026-11-03**, Africa/Nairobi calendar date. This is a
versioned editorial guide, not a complete national register or legal opinion.
Official content was reviewed through web retrieval, which may include cached
pages. No institution was contacted and no filing/application portal was tested.

| Record                         | Primary sources and scope                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cak-consumer-complaint`       | [CAK Consumer Protection](https://www.cak.go.ke/consumer-protection) supports the complaint scope, form/information requirement and outline of handling.                                                     |
| `small-claims-information`     | [Judiciary overview](https://judiciary.go.ke/small-claims-court/) supports the limited example claim types. [Official forms](https://judiciary.go.ke/small-claims-court-forms/) supports the form reference. |
| `nlas-application-information` | [NLAS Legal Aid](https://www.nlas.go.ke/legal-aid) supports application/eligibility information, income-evidence requirements and the debt-recovery exclusion.                                               |

Preparation items are **editorial review prompts** linked to these sources. They
are not purported quotations, a complete evidence list, mandatory filing steps or
an institutional checklist. Source documents and infographics are linked rather
than reproduced. Unknown processes are left unlisted. No fee, amount threshold,
deadline, response-time promise, personal eligibility or outcome is calculated.
The displayed check date describes this project's review, not official approval,
the publisher's update date or continuous source availability.

## Explicit navigation rule

`selected-category-v1` uses **only the saved issue selection**:

| Saved selection | Public links, in editorial order                                         |
| --------------- | ------------------------------------------------------------------------ |
| Consumer        | CAK complaint information; Small Claims Court information                |
| Money / Debt    | Small Claims Court information                                           |
| Something else  | No automatic links; general guides and service browsing remain available |

These mappings are project navigation choices. The sources do not endorse them or
establish relevance to an individual dispute. Ordering is not a suitability rank.
Private descriptions, timeframes and contact answers are not analysed. NLAS is
browse-only and is never automatically suggested for debt recovery. No classifier,
language model, confidence score, jurisdiction test or eligibility decision exists
in this batch. A later AI/matching integration requires its own documented data,
evaluation and review; it must not be implied by these fixed rules.

## Read and state boundaries

The public guide file is `backend/app/public_pathways.json`. Public list, detail
and preparation endpoints require no account and perform no cloud writes. Related
service IDs must exist in the public service catalogue. Invalid source data is an
unavailable error, not an empty list or a false missing-record response.

Owner-specific navigation reads an authenticated saved assessment through the
existing owner boundary. It returns the saved revision and category plus public
guides; it never returns the narrative, writes results, changes status or increments
revision. Complete clarification is required. Current guides are used on each read,
so results are not a historical snapshot. Refresh to see newly saved answers.

Checklist ticks live only in React page memory. Refreshing, leaving or changing the
selected guide discards them. There is no document upload, evidence validation,
saved checklist, filing, institutional delivery or referral submission. Existing
My Checklists remains unavailable until private checklist persistence is built.

To update a guide, review every affected source and field, retain stable IDs and
unknowns, update actual review dates, explain material changes in the PR and run
schema/API/transport/page checks. Update the explicit mapping and its client tests
together if navigation choices change. Source links alone never mark eligibility
or institutional participation as verified.
