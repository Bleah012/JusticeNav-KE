"""Evaluate JusticeNav KE offline on independently written Kenyan English cases."""

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET = DATA_DIR / "raw" / "kenyan-english-evaluation.csv"
FIELDS = ("case_id", "description", "expected_category")
CATEGORIES = ("consumer", "money-debt", "other")
OUTCOMES = (*CATEGORIES, "unsure")


def normalize(text: str) -> str:
    return " ".join(text.casefold().split())


def read_cases(path: Path, training_texts: set[str]) -> list[tuple[str, str]]:
    cases = []
    case_ids = set()
    seen_texts = set()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, strict=True)
        if tuple(reader.fieldnames or ()) != FIELDS:
            raise ValueError(
                "Expected the header case_id,description,expected_category."
            )

        for row_number, row in enumerate(reader, start=2):
            if None in row or any(row[field] is None for field in FIELDS):
                raise ValueError(f"Record {row_number} must have exactly three fields.")
            case_id, description, expected = (row[field].strip() for field in FIELDS)
            if not description and not expected:
                continue
            if not case_id or not description or expected not in OUTCOMES:
                raise ValueError(
                    f"Record {row_number} needs an ID, description and valid category."
                )
            if len(description.encode("utf-16-le")) // 2 > 1500 or any(
                ord(char) < 32 and char not in "\n\r\t" for char in description
            ):
                raise ValueError(f"Record {row_number} exceeds the app's text limits.")
            normalized = normalize(description)
            if case_id.casefold() in case_ids or normalized in seen_texts:
                raise ValueError(
                    f"Record {row_number} has a duplicate ID or description."
                )
            if normalized in training_texts:
                raise ValueError(f"Record {row_number} matches a training description.")
            case_ids.add(case_id.casefold())
            seen_texts.add(normalized)
            cases.append((description, expected))

    if not cases:
        raise ValueError("Enter at least one complete case in the CSV.")
    return cases


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    args = parser.parse_args()

    sys.path.insert(0, str(DATA_DIR.parent / "backend"))
    from app.issue_classifier import TRAINING_PATH, suggest_issue

    training = json.loads(TRAINING_PATH.read_text(encoding="utf-8"))
    training_texts = {normalize(text) for group in training.values() for text in group}
    try:
        cases = read_cases(args.dataset, training_texts)
    except OSError, UnicodeError, csv.Error:
        parser.error("Cannot read the UTF-8 CSV. See data/README.md for setup.")
    except ValueError as error:
        parser.error(str(error))

    matrix = {label: Counter() for label in OUTCOMES}
    for description, expected in cases:
        matrix[expected][suggest_issue(description) or "unsure"] += 1

    print("Expected\tConsumer\tMoney / Debt\tSomething else\tUnsure")
    for label, counts in matrix.items():
        print(label, *(counts[outcome] for outcome in OUTCOMES), sep="\t")

    labeled = sum(sum(matrix[label].values()) for label in CATEGORIES)
    correct = sum(matrix[label][label] for label in CATEGORIES)
    unsure = sum(matrix[label]["unsure"] for label in CATEGORIES)
    answered = labeled - unsure
    ambiguous = sum(matrix["unsure"].values())
    print(
        f"Labeled cases: {labeled} | Correct {correct} | Wrong {answered - correct} | Unsure {unsure}"
    )
    print(
        f"Expected Unsure cases: {ambiguous} | Returned Unsure {matrix['unsure']['unsure']}"
    )


if __name__ == "__main__":
    main()
