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
