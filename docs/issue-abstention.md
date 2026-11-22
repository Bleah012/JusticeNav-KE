# Category suggestion abstention

Reviewed on 22 November 2026 against merged main `f73aff8`.

The optional classifier now uses `synthetic-four-category-v3-abstention`.
Its 156 synthetic training descriptions, TF-IDF/logistic-regression fitting,
score threshold 0.48 and margin 0.18 are unchanged. No external narratives,
evaluation cases or saved seeker descriptions were added to training.

## Behavior

The classifier can return Unsure before offering a category when:

- Matched words provide only generic request language. Other also requires a
  recognizable housing, family, education, official-record or similar topic.
- Separate clauses name distinct topic/grievance pairs, such as unpaid wages
  and a refused shop refund. Commas, colons, sentence punctuation and common
  conjunctions separate clauses. Routine repayment alone is not a grievance.
- A description exceeds 64 nonempty fragments, bounding the heuristic's work.

These editorial word-pattern checks only suppress a suggestion. They do not
select another category, make a legal finding or change a saved answer.
Requesting a suggestion remains read-only. The seeker can choose any category
after Unsure and save through the existing clarification form.

## Recorded comparison

The 60-case assistant-generated CSV has the same bytes and expected labels as
the original evaluation. It is now included under data/samples as a frozen
development regression, with authorship and SHA-256 in
synthetic-evaluation-provenance.json. It informed the guard and is not an
independent test. The audit rejects a mismatched fingerprint.

| Set | Previous clear correct | Current clear correct | Previous vague/mixed Unsure | Current vague/mixed Unsure |
| --- | ---: | ---: | ---: | ---: |
| 60-case synthetic sample | 47/48 | 47/48 | 5/12 | 12/12 |
| Basic synthetic fixture | 19/19 | 19/19 | 6/6 | 6/6 |
| Coverage synthetic fixture | 20/30 | 20/30 | 6/6 | 6/6 |
| Kenyan English development CSV | 28/30 | 28/30 | 6/6 | 6/6 |
| Employment validation | 19/20 | 19/20 | 7/8 | 7/8 |
| Reviewed external development sample | 16/30 | 16/30 | Not supplied | Not supplied |

Each set's remaining clear cases returned Unsure; none received a wrong
category. A further 24-case assistant-authored probe produced 15/16 correct
clear suggestions, one clear Unsure and 8/8 unclear Unsure. Its early results
informed an additional generic-language check, so it too is development data.
Aggregated baseline/candidate results are recorded in
data/samples/abstention-results.json. The baseline implementation was loaded
from `f73aff8` and evaluated on the same files as the candidate.

Reproduce current results from the project root:

```powershell
& ".\backend\.venv\Scripts\python.exe" -B data/evaluate_classifier.py
& ".\backend\.venv\Scripts\python.exe" -B data/evaluate_kenyan_english.py --dataset data/samples/kenyan-english-synthetic-evaluation.csv
```

## Limits and browser check

This is a small English heuristic layer, not complete mixed-issue understanding.
It may miss unrecognized wording or overlapping topics and can mistake context,
negation or reported speech for another issue. One existing work/loan validation
case still receives Money/Debt where Unsure was expected. Unfamiliar Other
wording may now abstain. Independent Kenyan participant evaluation is pending.

After restarting the backend, save each description in a fresh assessment and
request a suggestion on Clarify:

1. `My employer has not paid my wages and the shop refuses to refund a broken phone.`
   Expect Unsure. Choose Employment manually, complete the other answers, save,
   refresh and verify Employment remains selected and opens its normal guide.
2. `Something happened a while ago and I need to know what I should do.`
   Expect Unsure with manual choices available.
3. `The shop sold me a faulty television and refuses a refund. I repay my loan every month.`
   Expect Consumer; routine loan context must not create a second complaint.
4. `My employer has not paid my salary for two months despite my scheduled work.`
   Expect Employment, with acceptance and saving unchanged.
