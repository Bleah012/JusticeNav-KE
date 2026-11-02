# Initial public catalogue: source notes

Project source-review date: **2026-11-02**, Africa/Nairobi calendar date.

This is a small editorial catalogue of published facts and outbound links. It is
not a training dataset, a complete national service register, an affiliation list
or a set of fabricated demonstration organisations. Facts were checked against
official content available through web retrieval, which may include cached pages.
Institutions were not contacted and live application/filing flows were not tested.
`checkedOn` is the project's review date, not the publisher's update date or a
guarantee of live availability. No auto-refresh or official certification is claimed.

The maintained file is `backend/app/public_catalog.json`. Text is brief, original
paraphrase of published facts; full documents, guide images and logos are not copied.

| Catalogue record          | Primary source and basis                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `small-claims-courts`     | [Judiciary overview](https://judiciary.go.ke/small-claims-court/) supports the court description and listed claim types. [Judiciary forms](https://judiciary.go.ke/small-claims-court-forms/) supports the forms link.                                                       |
| `cak-consumer-protection` | [CAK Consumer Protection](https://www.cak.go.ke/consumer-protection) supports complaint channels and the included business contact fields. [Forms and Guidelines](https://www.cak.go.ke/mandate/Consumer-Protection/Forms-Guidelines) supports the complaint-form reference. |
| `nlas-legal-aid`          | [NLAS Legal Aid](https://www.nlas.go.ke/legal-aid) supports application and scope information, including the debt-recovery exclusion. [NLAS FAQs](https://www.nlas.go.ke/faqs) supports general service and enquiry information.                                             |

Resource links point to those publishers' own pages:

- [Small Claims Court overview](https://judiciary.go.ke/small-claims-court/)
- [Small Claims Court step-by-step guide](https://judiciary.go.ke/mall-claims-courts-step-by-step-guide/)
- [Small Claims Court forms](https://judiciary.go.ke/small-claims-court-forms/)
- [CAK complaint information](https://www.cak.go.ke/consumer-protection)
- [CAK forms and guidelines](https://www.cak.go.ke/mandate/Consumer-Protection/Forms-Guidelines)
- [NLAS legal aid guidance](https://www.nlas.go.ke/legal-aid)

The `mall-claims...` spelling in the guide URL is the publisher's linked address;
it is intentionally preserved. Procedural infographics are linked, not interpreted
as a complete filing checklist. Resource category tags are editorial navigation
labels; they do not establish legal applicability to an individual case.

## Editorial choices

- Amount limits, filing fees, deadlines and outcome estimates are not supplied.
  The user is directed to the current official requirements rather than a computed
  jurisdiction/eligibility conclusion.
- The profile records published scope limitations rather than promising aid for
  every money dispute. No personalised legal-aid eligibility assessment is made.
- Unknown hours, coverage or contact fields are null. A null means not included in
  this catalogue, not that the publisher has never supplied the information.
- The older CAK PDF form includes a different address from its current public
  consumer-protection page. Included business contact data follows the public page;
  users must confirm before visiting. The old address is not reproduced.
- A State Law Office search result had unrelated gambling text in its title and
  was excluded. Third-party summaries, forum posts and unofficial advice were not
  used as provenance. Supreme Court-specific guidance was not transferred to SCC.
- No coordinates, nearest-service claims, opening-hours claims, referral delivery,
  institution participation or real-time service capacity are invented.

## Updating the catalogue

Review each affected official page and the precise field being changed. Keep IDs
stable, use only approved HTTPS publishers, retain unknowns as null, and update
record check dates plus the catalogue date to the actual review date. Explain
material scope/source changes in the PR. Run catalogue schema/API/client tests and
review the three public pages. A future publisher requires updating both explicit
host allowlists and documenting provenance. Do not turn a link check into a claim
that an organisation reviewed or endorsed this project.

Edits are version-controlled source changes. Administrator preview forms remain
unconnected to publication; this batch introduces no public write endpoint.
