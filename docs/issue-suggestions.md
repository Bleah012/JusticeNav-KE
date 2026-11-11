# Assisted issue classification

On Clarify, **Suggest a category** requests an optional suggestion from the
description already saved to the signed-in seeker's assessment. **Use this
category** selects the answer in the form. The seeker can select any category
and saves it through the existing clarification flow. Pathways use that saved
answer.

## Data and model

The runtime corpus in `backend/app/issue_training.json` contains 128 original
synthetic English descriptions. There are 40 for Consumer, 40 for Money / Debt
and 48 for Something else. The model uses those examples alone. The API reads a saved
description for inference only when requested and discards the prediction
after returning it.

The model uses word unigrams and bigrams, smoothed inverse document frequency,
sublinear term frequency, and L2 normalization. Multinomial logistic regression
uses an L2 penalty and a deterministic batch optimizer. The backend fits and
caches the model in process using Python's standard library. It abstains when
fewer than three vocabulary words match, the top probability is below 0.56,
or the margin over the next category is below 0.18. These are heuristic
thresholds. [TF-IDF reference](https://scikit-learn.org/stable/modules/feature_extraction.html#tfidf-term-weighting)

## Held-out evaluation

`backend/tests/fixtures/issue_evaluation.json` contains 24 separate synthetic
scenarios, including Kenyan settings, short inputs and out-of-vocabulary text.
These examples are excluded from model fitting.

| Expected behavior | Examples | Correct suggestions | Abstentions |
| --- | ---: | ---: | ---: |
| Consumer | 6 | 6 | 0 |
| Money / Debt | 6 | 6 | 0 |
| Something else | 6 | 6 | 0 |
| Unsure | 6 | 0 | 6 |

Run `python -m pytest tests/test_issue_classifier.py -q` from the backend
directory to repeat the regression check. These hand-authored examples measure
behavior on a small synthetic set. Real-user accuracy, multilingual coverage
and calibrated probability estimates remain unevaluated.

## Training coverage update

This update adds 44 synthetic descriptions and keeps the model and abstention
thresholds fixed. It gives more coverage to tenancy, employment, education and
other issues outside the Consumer and Money / Debt pathways.

The fresh synthetic comparison in `backend/tests/fixtures/issue_coverage_evaluation.json`
was written before fitting the candidate model and excludes training descriptions.
It contains 30 labeled examples and six additional ambiguous inputs.

| Expected category | Examples | Correct with 84 examples | Correct with 128 examples |
| --- | ---: | ---: | ---: |
| Consumer | 10 | 3 | 3 |
| Money / Debt | 10 | 8 | 8 |
| Something else | 10 | 3 | 9 |

Across the 30 labeled cases, the original model made one incorrect suggestion
and abstained 15 times. The updated model made no incorrect suggestions and
abstained ten times. Both versions abstained on all six ambiguous inputs and
passed the original 24-case fixture.

A separate 30-case Learned Hands pilot informed the training expansion.
Reusing those cases as a development comparison, correct suggestions rose
from 13 to 15. Consumer went from five to four, Money / Debt stayed at six,
and Something else went from two to five. Both versions made zero incorrect
suggestions in that pilot. The external narratives were used for evaluation
only. The pilot was small, deliberately balanced and labeled by one reviewer.
Accuracy on new Kenyan user submissions remains unevaluated.
[Learned Hands dataset](https://spot.suffolklitlab.org/data/)
