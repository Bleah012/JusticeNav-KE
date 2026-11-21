# JusticeNav KE MVP review

Review date: 21 November 2026. Baseline: merged main 4fbe1b9, including PR 50.
This review compares the supplied project proposal, report template, local
logbook reference and current code. The user confirmed that the three-role school
demonstration remains the intended referral scope. Dashboard changes in this
working batch still require the user's live Firebase acceptance check.

## Proposal alignment

| Proposal objective | Current implementation | Status and report wording |
| --- | --- | --- |
| Ordinary-language problem entry and access to service information | Saved assessment descriptions, clarification forms, public service/resource catalogue and source links. | Implemented within the school MVP; own-account reads and writes are authenticated. |
| AI-assisted classification and pathway matching | Optional TF-IDF/logistic-regression category suggestion, manual choice, three fixed clarification questions and category-based pathway links. | Limited implementation. Pathways use the saved category, not a learned ranking or an automated eligibility decision. The model can abstain. |
| Published provider, eligibility, procedure and preparation information | Reviewed service/pathway/resource CRUD, source dates, published guides and saved checklist snapshots. | Implemented for the current Consumer and Money/Debt scope. Published conditions are information to check with the source, not a finding about an individual case. |
| Referral requests, tracking and updates | Private request CRUD before sharing, consent-based metadata sharing, admin assignment, provider review/completion, withdrawal, history and persistent in-app read status. | Implemented as the user-confirmed school demonstration. Organisations do not receive the private request through this app. |
| Employment among the proposed example topics | Employment language currently maps to Other; no dedicated Employment answer or guide. | Open extension. Source research and candidate data are recorded in employment-scope.md. |
| Authorised administration and provider workspaces | Published catalogue CRUD/audit history, account creation, provider membership and role-protected assignment/review. | Implemented within documented operations. Existing-account role changes, disable/delete and export remain unavailable in the UI. |

## Dashboard findings and changes

- The seeker backend already counts entire own-account collections, rather than
  only a list page. Recent activity is the latest save per record, not an event
  history. Deletions leave active counts when the dashboard is refreshed.
- Administrator overview previously counted only the published catalogue.
  The new dashboard adds complete Firebase account role/status counts and school
  demonstration status counts. Private case text is excluded.
- The provider chart previously counted only its displayed page. It now reads
  a separate complete current-membership summary and refreshes after progress
  writes. Withdrawal removes provider access and removes that assignment from
  provider totals.
- Charts, labels and metric values are larger. Horizontal bars accommodate longer
  labels. Loading and failed reads do not display invented zero totals.
- Old seeker preview/confirmation copy incorrectly said progress or notifications
  were unconnected. The text now points to tracking and the inbox while retaining
  the institutional-delivery boundary.

The new account and demonstration summary scans have explicit school-MVP bounds.
They fail as unavailable if the bounds are exceeded; they do not publish partial
counts. Separate source reads are not a single transactional snapshot.

## Data and evaluation findings

| Item | Finding |
| --- | --- |
| Runtime training | 128 synthetic English descriptions: 40 Consumer, 40 Money/Debt, 48 Other. |
| Learned Hands raw source | Present locally, checksum verified; 2,811 rows. It is evaluation-only in the current app. |
| Reviewed external sample | 30 development cases; 15 correct, zero wrong and 15 Unsure with the current model. This sample already informed development and is not an independent final test. |
| Existing synthetic coverage fixture | 30 labeled cases: 20 correct, zero wrong, ten Unsure; six additional ambiguous cases abstain. |
| Additional synthetic development CSV | 30 labeled cases: 27 correct, zero wrong, three Unsure; six additional vague cases abstain. It is assistant-authored, not a participant study. |
| Independent Kenyan English working CSV | Still a blank template with zero completed cases at review time. |
| Trial training expansions | 192- and 176-example candidates each lost one ambiguous-input abstention. Neither replaced runtime training. |
| Employment candidates | 363 positive source annotations; 265 within the app input limit; 18 also Consumer/Money positives. All remain pending review, not automatically accepted training cases. |

Run data/evaluate_classifier.py to reproduce aggregate model/data checks.
No stored seeker descriptions were used for model training. Independent Kenyan
English authorship, labeling and testing remain necessary before claiming
real-user accuracy or improved multilingual coverage.

## Remaining prototype controls

The separate Content Verification queue is still a supplied-data preview.
Actual source review and publication are carried out in Services, Pathways and
Resources management. Profile photos, interactive maps, account exports,
application account deletion and session-management controls also remain
unavailable. These are not silently counted as completed features. They need
either an explicit future batch or a clear scope statement in the final report.

Employment is the requested next research/implementation topic. The
three-role demonstration remains in scope; external institutional delivery and
institutional provider partnerships are not required for this school MVP.

## Report and logbook work still required

The lecturer's report template requires preliminary pages, Chapters One through
Six, implementation code with titles and screenshots, conclusions, limitations,
APA 7 references and appendices. Earlier chapter drafts and screenshot material
are reference material; this review does not establish that a final consolidated
report or Blackboard submission is complete.

The latest local filled logbook reference inspected was the 30-page copy marked
13 November, based on main 790c044. It predates dashboard charts, homepage/About
changes, catalogue CRUD, audit logs, provider selection, seeker deletion/referral
CRUD and account creation. Add the actual later activities and this dashboard/data
review to the appropriate days. Preserve the user's preference to draft by weekday
rather than inventing exact dates. The logbook template explicitly calls for
handwritten daily entries and weekly scans; a typed reference PDF does not prove
that the physical logbook or uploads are finished.

Record only activities actually performed. Do not invent questionnaire
participants, interviews, usability ratings, independent dataset authors,
supervisor signatures, lecturer feedback, final presentation or submission status.
The user previously confirmed the October progress presentation; final submission
and presentation evidence must be confirmed separately.

Before the final report is closed:

1. Confirm the documented MVP scope and employment extension decision.
2. Complete independently authored/labeled Kenyan English evaluation and record
   the model commit, cases, per-class results, uncertainty and limitations.
3. Capture current public, seeker, admin and provider screens with captions and
   non-sensitive test inputs after live acceptance.
4. Update architecture/DFD/ERD descriptions to the implemented private-record,
   metadata-only demonstration and notification flows.
5. Consolidate the six report chapters and add actual test evidence, dataset
   provenance, limitations and verified sources.
6. Update the handwritten daily logbook and weekly evidence, then confirm feedback,
   submissions and presentation status.
7. Keep hosting/deployment and hosted acceptance as the separate final task.

## Sources reviewed

- Supplied Project Proposal_word.docx, including the four objectives, methodology
  and proposed employment/consumer/small-claims scope.
- Supplied FINAL PROJECT DOCUMENATION TEMPLATE.pdf, two pages.
- Supplied SWE 3090 LogBook (1).pdf, including the daily handwriting instructions.
- Local JusticeNav-KE-SWE-3090-Logbook.pdf in the 2026-11-13 output directory.
- Repository code, dataset files, regression fixtures and local candidate comparisons.
