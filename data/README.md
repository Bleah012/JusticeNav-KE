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
this evaluation as independently authored fictional scenarios in the report.
