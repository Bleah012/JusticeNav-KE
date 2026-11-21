# Employment navigation and training plan

Reviewed against the school MVP on 21 November 2026. The seeker, administrator
and development-provider demonstration remains the referral workflow. Official
organisations are information sources, not participating demo providers.

## Sources for employment navigation

| Source | Appropriate use | Review boundary |
| --- | --- | --- |
| [Judiciary ELRC overview](https://judiciary.go.ke/employment-and-labour-relations-court/) | A published employment and labour court information route, linked from the directory and a future Employment result. | It describes employment/labour jurisdiction but contains older procedural references. Do not copy station totals, salary thresholds or procedural claims without checking current primary material. |
| [ELRC Procedure Rules 2024 on Kenya Law](https://new.kenyalaw.org/akn/ke/act/ln/2024/133/eng%402024-08-23/source.pdf) | Source material for reviewing court-process information and preparing a sourced guide. | Verify the current version before publishing filing steps or deadlines. This review adds no automatic legal eligibility or deadline decision. |
| [State Department for Labour dispute information](https://labour.go.ke/handling-labour-disputes) | Candidate labour-officer information route for an additional guide. | The primary page timed out during this review. Its procedure, contact details, fees and charter targets remain unverified; do not publish claims copied from secondary guides. |

A practical first release would have an Employment category with plain-language
information about workplace disputes, reviewed official links and a preparation
checklist. Example preparation prompts can ask the seeker to gather a factual
timeline and check which employment records the official source requests. Exact
requirements must come from the reviewed source. The app should not decide
whether dismissal was lawful, calculate compensation or promise a court outcome.
Current non-sensitive saved checklists and referral metadata can support the
same administrator/provider demo for an employment service once added.

## Available external data

[Learned Hands release notes](https://spot.suffolklitlab.org/data/) describe
historic public r/legaladvice questions labeled using LIST. The release is
licensed CC BY-NC-SA 4.0. The [published taxonomy](https://spot.suffolklitlab.org/v0/taxonomy/)
identifies WO-00-00-00-00 as Work and Employment Law.

The locally downloaded 2,811-row release contains:

| Employment root annotation | Rows |
| --- | ---: |
| Positive | 363 |
| Negative | 1,510 |
| Unknown or blank | 938 |
| Positive and within the app text limit | 265 |
| Positive and also positive Consumer or Money/Debt | 18 |

These are candidate counts, not a ready training set. Blank annotations are
unknown rather than negative. Public narratives can mix issues and refer to
foreign institutions or law. Use them, after review, for broad issue wording;
Kenyan procedural guidance must come from Kenyan official sources.

A local pending review worksheet is at data/raw/employment-review.csv. It is
ignored by Git, preserves original text and starts with empty reviewed labels
and split assignments. Recreate only to a new filename with
data/prepare_employment_review.py --output data/raw/a-new-employment-review.csv.
The inspector performs no training and prints no narrative text.

## Proposed four-category model revision

1. Freeze a reviewed label guide: Consumer, Money / Debt, Employment and Other.
   Define paid customer services separately from wages, dismissal and workplace
   treatment. Leave genuinely mixed or unclear examples for abstention.
2. Relabel existing employment examples currently in Other. Do not keep
   contradictory copies of the same concept in both categories.
3. Review external employment candidates, remove duplicates and separate mixed,
   unsuitable and over-length cases. Record label decisions and provenance.
4. Collect additional fictional Kenyan English scenarios from contributors who
   have not seen the training material. Independent authorship must be verified.
   An assistant-generated file cannot substitute for that evidence.
5. Freeze training, validation and final test splits before fitting. Keep the
   final test examples out of vocabulary fitting, feature learning and threshold
   selection. Do not automatically reuse the current development fixtures as an
   independent final test.
6. Compare a four-class candidate with the existing model for per-category
   precision, coverage, confusion and ambiguous-input abstention. Select using
   validation data; run the untouched final test after that selection.
7. Update the classifier contract, clarification options, saved-answer validators,
   category-based pathway mapping, evaluation tools and compatibility tests
   together. Existing saved Other answers must stay readable and must not be
   silently reclassified.

This is a proposed next implementation batch. No fourth runtime label or
employment pathway was added during the dashboard review.

## Current training decision

The active model still fits 128 original synthetic examples. Two trial corpus
expansions improved some clear-case results but lost one ambiguous abstention in
the existing coverage fixture. Both were rejected. This is evidence that more
examples alone are insufficient; reviewed employment labeling and independent
local evaluation should precede the four-class change.
