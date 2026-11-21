# JusticeNav KE datasets

| Data | Location | Purpose |
| --- | --- | --- |
| Synthetic training corpus | [`backend/app/issue_training.json`](../backend/app/issue_training.json) | Fits the app's classifier using 128 synthetic examples. |
| Synthetic evaluation fixtures | [`backend/tests/fixtures/`](../backend/tests/fixtures/) | Checks category suggestions and abstention in the automated backend tests. |
| Learned Hands reviewed sample | [`samples/learned-hands-reviewed-labels.csv`](samples/learned-hands-reviewed-labels.csv) | Provides the expected JusticeNav KE categories for 30 cases, ten per category. |
| Learned Hands source CSV | `data/raw/learned-hands-2022-05-21.csv` | Supplies the original descriptions for local offline evaluation. Git ignores this file. |

## Learned Hands evaluation

The source is the **2022-05-21 95% confidence binary release** from Learned Hands, a project of the Suffolk LIT Lab and Stanford Legal Design Lab. JusticeNav KE selected and relabeled a subset for its three categories. The sample file stores hashed source row keys, expected labels and short review reasons. The original descriptions stay in the downloaded CSV. Use the source data and the reviewed sample under CC BY-NC-SA 4.0. [Source and release notes](https://spot.suffolklitlab.org/data/) · [License](https://creativecommons.org/licenses/by-nc-sa/4.0/)

Run these commands from the repository root with the backend Python environment installed. If you already have the release CSV, copy it to the path shown in the table and run the last two lines.

```powershell
$dataset = "data/raw/learned-hands-2022-05-21.csv"
New-Item -ItemType Directory -Path "data/raw" -Force | Out-Null
if (-not (Test-Path -LiteralPath $dataset)) {
    Invoke-WebRequest -UseBasicParsing -Uri "https://spot.suffolklitlab.org/data/2022-05-21_95p-confidence_binary.csv" -OutFile $dataset -ErrorAction Stop
}
& ".\backend\.venv\Scripts\python.exe" -B data/evaluate_learned_hands.py
if ($LASTEXITCODE -ne 0) { throw "Learned Hands evaluation failed." }
```

The evaluator checks the source file's SHA-256, joins the 30 reviewed rows by key, and prints aggregate counts for the current classifier. For the 128-example model, the expected result is 15 correct suggestions, zero incorrect suggestions, and 15 Unsure responses.

The sample favors clear cases and has one reviewer. It informed the training expansion, so it serves as a repeatable development comparison. Independent accuracy on Kenyan user submissions remains unevaluated. [Classifier evaluation notes](../docs/issue-suggestions.md)

## Kenyan English evaluation

Ask a contributor who has not seen the training examples to write short,
fictional situations in their everyday Kenyan English. Ask them to describe
what happened as they would in the app, using one to three sentences. Use
fictional people and omit names, phone numbers, account details and real case
details. Record the expected categories before running the evaluator.

Aim for ten clear examples per category and six vague or mixed cases. A
reviewer can use these labels in the `expected_category` column.

| CSV label | Use for |
| --- | --- |
| `consumer` | A purchase or paid service dispute, such as delivery, a defective product or an unexpected charge. |
| `money-debt` | A borrowing, repayment, debt collection or loan balance dispute. |
| `other` | A clearly described situation outside those two categories, such as tenancy, employment or schooling. |
| `unsure` | A vague or mixed description where a single category cannot be chosen confidently from the facts given. |

Run these commands from the repository root to make a working copy of the
[blank template](samples/kenyan-english-evaluation-template.csv).

```powershell
$dataset = "data/raw/kenyan-english-evaluation.csv"
New-Item -ItemType Directory -Path "data/raw" -Force -ErrorAction Stop | Out-Null
if (-not (Test-Path -LiteralPath $dataset)) {
    Copy-Item -LiteralPath "data/samples/kenyan-english-evaluation-template.csv" -Destination $dataset -ErrorAction Stop
}
```

Fill the `description` and `expected_category` cells and save as CSV UTF-8.
Keep the completed CSV in `data/raw/`, which Git ignores. The evaluator accepts
a smaller set if collection is still in progress.

```powershell
& ".\backend\.venv\Scripts\python.exe" -B data/evaluate_kenyan_english.py
if ($LASTEXITCODE -ne 0) { throw "Kenyan English evaluation failed." }
```

The evaluator rejects repeated descriptions and exact matches with the
training corpus after normalizing case and whitespace. It prints aggregate
counts for each category and reports expected Unsure cases separately. Record
the model commit, number of completed cases and aggregate results. Describe
authorship accurately. Only call scenarios independent when their authors did
not see the training examples or help tune the model. Assistant-authored
practice cases are synthetic development checks.

## Current data completeness and model gate

Run data/evaluate_classifier.py using the backend Python environment. It checks
training/evaluation overlap and prints aggregate results, a training fingerprint,
raw-file availability and completed local evaluation cases. It never prints case
descriptions. Use --output followed by a path to save aggregate JSON locally.
The app does not require either raw CSV to navigate a seeker.

The local review found 2,811 rows in the Learned Hands release, with 30 reviewed
development comparisons. The independent Kenyan English working CSV was still
the blank template, with zero completed cases. The earlier assistant-authored
practice file must not be described as independent participant data.

samples/kenyan-english-development.csv contains 36 additional assistant-authored
fictional scenarios: ten per category and six vague inputs. It is a development
regression set, not training data or a Kenyan participant study. The unchanged
128-example model gives 27 correct suggestions, no wrong suggestions, three
Unsure outcomes on the 30 labeled cases, and Unsure for all six vague cases.
This does not establish real-user accuracy.

A 192-example synthetic candidate improved the coverage fixture from 20 to 25
correct suggestions and Learned Hands from 15 to 19, but abstained on only five
of six ambiguous coverage cases. A balanced 176-example candidate also lost one
ambiguous abstention. Neither was adopted. Runtime training stays at 128 examples
and the existing thresholds stay fixed. More data must improve coverage while
retaining appropriate abstention.

## Employment candidate review

The existing release includes LIST label WO-00-00-00-00, Work and Employment Law:
363 positive, 1,510 negative and 938 unknown entries. Blank labels are unknown,
not negative. Of the positive narratives, 265 fit the app's 1,500 UTF-16-unit
input limit and 18 also have Consumer or Money/Debt root labels. They require
review before mapping to mutually exclusive application categories.

Run data/prepare_employment_review.py to inspect counts. Add --output followed by
data/raw/employment-review.csv to create a new local review worksheet. Existing
files are not overwritten. Every row starts pending, with blank reviewed-category
and split fields. The tool performs no training. A review copy was prepared
locally during this batch; it stays under the existing Git ignore rule.
Source narratives and the worksheet retain the release's attribution and
noncommercial share-alike conditions.

See [employment scope and training plan](../docs/employment-scope.md). Current
runtime categories remain Consumer, Money / Debt and Something else. Employment
navigation and a fourth classifier label are a proposed next implementation step.
