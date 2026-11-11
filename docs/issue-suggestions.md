# Assisted issue classification

On Clarify, **Suggest a category** requests an optional suggestion from the
description already saved to the signed-in seeker's assessment. **Use this
category** selects the answer in the form. The seeker can select any category
and saves it through the existing clarification flow. Pathways use that saved
answer.

## Data and model

The runtime corpus in `backend/app/issue_training.json` contains 84 original
synthetic English descriptions, 28 each for Consumer, Money / Debt and
Something else. The model uses those examples alone. The API reads a saved
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
