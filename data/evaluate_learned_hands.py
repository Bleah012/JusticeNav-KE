"""Evaluate the current JusticeNav KE classifier on the reviewed Learned Hands sample."""

import argparse
import csv
import hashlib
import sys
from collections import Counter
from pathlib import Path

SOURCE_SHA256 = "0696db2a9965dc898d63366c56f60a13df9594c4ab700137c4330fdb70a45b3f"
LABELS = ("consumer", "money-debt", "other")
OUTCOMES = (*LABELS, "abstain")
DATA_DIR = Path(__file__).resolve().parent
REVIEW_PATH = DATA_DIR / "samples" / "learned-hands-reviewed-labels.csv"
DEFAULT_DATASET = DATA_DIR / "raw" / "learned-hands-2022-05-21.csv"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def case_key(source_id: str) -> str:
    return hashlib.sha256(f"JusticeNav-review-v1|{source_id}".encode()).hexdigest()[:16]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    args = parser.parse_args()

    try:
        source_hash = hashlib.sha256(args.dataset.read_bytes()).hexdigest()
    except OSError:
        parser.error("Cannot read the source CSV. See data/README.md for setup.")
    if source_hash != SOURCE_SHA256:
        parser.error("Use the original Learned Hands CSV dated 2022-05-21.")

    backend = DATA_DIR.parent / "backend"
    sys.path.insert(0, str(backend))
    from app.issue_classifier import suggest_issue

    rows = read_csv(args.dataset)
    texts = {case_key(row["_id"]): row["full_text"].strip() for row in rows}
    reviewed = read_csv(REVIEW_PATH)
    if len(texts) != len(rows):
        parser.error("Dataset keys must be unique.")
    reviewed_keys = {row["case_key"] for row in reviewed}
    if len(reviewed_keys) != len(reviewed):
        parser.error("The review contains duplicate case keys.")
    if reviewed_keys - texts.keys():
        parser.error("The source CSV is missing one or more reviewed cases.")
    if Counter(row["expected"] for row in reviewed) != dict.fromkeys(LABELS, 10):
        parser.error("The review must have ten cases for each expected category.")

    matrix = {label: Counter() for label in LABELS}
    for row in reviewed:
        text = texts[row["case_key"]]
        prediction = suggest_issue(text) or "abstain"
        matrix[row["expected"]][prediction] += 1

    print("Expected\tConsumer\tMoney / Debt\tSomething else\tUnsure")
    for label, counts in matrix.items():
        print(label, *(counts[outcome] for outcome in OUTCOMES), sep="\t")

    total = len(reviewed)
    correct = sum(counts[label] for label, counts in matrix.items())
    abstained = sum(counts["abstain"] for counts in matrix.values())
    answered = total - abstained
    print(
        f"Correct {correct}/{total} | Wrong {answered - correct}/{total} | Unsure {abstained}/{total}"
    )
    if answered:
        print(
            f"Correct among suggestions {correct}/{answered} ({correct / answered:.1%})"
        )


if __name__ == "__main__":
    main()
