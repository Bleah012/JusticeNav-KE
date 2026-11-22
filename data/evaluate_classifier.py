"""Audit local data completeness and repeat aggregate classifier development checks."""

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent
ROOT = DATA.parent
sys.path.insert(0, str(ROOT / "backend"))
from app.issue_classifier import MODEL_VERSION, TRAINING_PATH, suggest_issue
from evaluate_kenyan_english import normalize, read_cases
from evaluate_learned_hands import (
    EXPECTED_COUNTS,
    LABEL_VERSION,
    SOURCE_SHA256,
    case_key,
    read_csv,
)


def evaluate(cases):
    totals = Counter(
        labeled=0, correct=0, wrong=0, unsure=0, ambiguous=0, ambiguousAbstained=0
    )
    matrix = {
        label: Counter()
        for label in ("consumer", "money-debt", "employment", "other", "unsure")
    }
    for description, expected in cases:
        expected = "unsure" if expected == "uncertain" else expected
        predicted = suggest_issue(description) or "unsure"
        matrix[expected][predicted] += 1
        if expected == "unsure":
            totals["ambiguous"] += 1
            totals["ambiguousAbstained"] += predicted == "unsure"
        else:
            totals["labeled"] += 1
            totals["correct"] += predicted == expected
            totals["unsure"] += predicted == "unsure"
            totals["wrong"] += predicted not in {expected, "unsure"}
    return {**totals, "matrix": {label: dict(row) for label, row in matrix.items()}}


def report():
    training = json.loads(TRAINING_PATH.read_text(encoding="utf-8"))
    trained = {normalize(text) for rows in training.values() for text in rows}
    if len(trained) != sum(map(len, training.values())):
        raise ValueError("Training descriptions must be unique after normalization.")
    result = {
        "training": {
            "modelVersion": MODEL_VERSION,
            "counts": {label: len(rows) for label, rows in training.items()},
            "sha256": hashlib.sha256(TRAINING_PATH.read_bytes()).hexdigest(),
            "provenance": "Synthetic English examples; user submissions are not used for training.",
        },
        "evaluations": {},
    }
    for name in (
        "issue_evaluation",
        "issue_coverage_evaluation",
        "employment_validation",
        "abstention_probe",
    ):
        groups = json.loads(
            (ROOT / "backend/tests/fixtures" / (name + ".json")).read_text(
                encoding="utf-8"
            )
        )
        cases = [(text, label) for label, rows in groups.items() for text in rows]
        if not trained.isdisjoint(normalize(text) for text, _ in cases):
            raise ValueError("A development fixture overlaps training.")
        result["evaluations"][name] = evaluate(cases)
    development = read_cases(DATA / "samples/kenyan-english-development.csv", trained)
    result["evaluations"]["synthetic_kenyan_english_development"] = evaluate(
        development
    )
    sample = DATA / "samples/kenyan-english-synthetic-evaluation.csv"
    provenance = json.loads(
        (DATA / "samples/synthetic-evaluation-provenance.json").read_text(
            encoding="utf-8"
        )
    )
    if hashlib.sha256(sample.read_bytes()).hexdigest() != provenance["sha256"]:
        raise ValueError(
            "Frozen synthetic regression sample differs from its provenance."
        )
    abstention = read_cases(sample, trained)
    result["evaluations"]["synthetic_english_abstention_regression"] = evaluate(
        abstention
    )
    result["syntheticRegression"] = {
        "sha256": provenance["sha256"],
        "independentEvaluation": False,
        "use": "Frozen assistant-generated development regression; informed the abstention rules.",
    }
    local = DATA / "raw/kenyan-english-evaluation.csv"
    result["independentCsv"] = {
        "status": "missing",
        "completeCases": 0,
        "provenance": "Authorship and independence must be verified separately; a CSV alone does not establish them.",
    }
    if local.exists():
        with local.open(encoding="utf-8-sig", newline="") as stream:
            rows = list(csv.DictReader(stream))
        populated = [
            row
            for row in rows
            if row.get("description", "").strip()
            or row.get("expected_category", "").strip()
        ]
        if populated:
            cases = read_cases(local, trained)
            result["independentCsv"] = {
                **result["independentCsv"],
                "status": "populated-unverified",
                "completeCases": len(cases),
                "results": evaluate(cases),
            }
        else:
            result["independentCsv"]["status"] = "blank-template"
    learned = DATA / "raw/learned-hands-2022-05-21.csv"
    if learned.exists():
        if hashlib.sha256(learned.read_bytes()).hexdigest() != SOURCE_SHA256:
            raise ValueError(
                "Learned Hands source checksum differs from the reviewed release."
            )
        rows = read_csv(learned)
        texts = {case_key(row["_id"]): row["full_text"].strip() for row in rows}
        reviewed = read_csv(DATA / "samples/learned-hands-reviewed-labels-v2.csv")
        if (
            len(texts) != len(rows)
            or len({row["case_key"] for row in reviewed}) != len(reviewed)
            or Counter(row["expected"] for row in reviewed) != EXPECTED_COUNTS
        ):
            raise ValueError("Invalid reviewed Learned Hands sample.")
        cases = [(texts[row["case_key"]], row["expected"]) for row in reviewed]
        if not trained.isdisjoint(normalize(text) for text, _ in cases):
            raise ValueError("External evaluation text overlaps training.")
        result["evaluations"]["learned_hands_reviewed_development_sample"] = evaluate(
            cases
        )
        result["learnedHands"] = {
            "status": "present",
            "sourceRows": len(rows),
            "reviewedRows": len(reviewed),
            "labelVersion": LABEL_VERSION,
            "use": "Evaluation only; this reviewed sample already informed development.",
        }
    else:
        result["learnedHands"] = {
            "status": "missing",
            "use": "Optional local evaluation source, never required for app navigation.",
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, help="Optional aggregate-only JSON report path."
    )
    args = parser.parse_args()
    try:
        value = report()
    except (OSError, UnicodeError, ValueError, KeyError, csv.Error):
        parser.error(
            "Data audit could not complete. Check the UTF-8 files, labels, source checksum and training overlap; see data/README.md."
        )
    text = json.dumps(value, indent=2)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
