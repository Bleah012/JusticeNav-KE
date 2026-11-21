"""Inspect Learned Hands employment candidates; export only to ignored local raw data."""

import argparse
import csv
import hashlib
import json
from pathlib import Path

from evaluate_learned_hands import DEFAULT_DATASET, SOURCE_SHA256, case_key, read_csv

WORK = "WO-00-00-00-00"
RAW = Path(__file__).resolve().parent / "raw"


def inspect(rows):
    positive = [row for row in rows if row[WORK] in {"1", "1.0"}]
    negative = sum(row[WORK] in {"0", "0.0"} for row in rows)
    eligible = sum(
        len(row["full_text"].encode("utf-16-le")) // 2 <= 1500 for row in positive
    )
    mixed = sum(
        any(
            row.get(key) in {"1", "1.0"} for key in ("CO-00-00-00-00", "MO-00-00-00-00")
        )
        for row in positive
    )
    return {
        "sourceRows": len(rows),
        "employmentPositive": len(positive),
        "employmentNegative": negative,
        "employmentUnknown": len(rows) - len(positive) - negative,
        "positiveWithinAppTextLimit": eligible,
        "positiveAlsoConsumerOrMoney": mixed,
        "readyForTraining": 0,
        "status": "Candidates require human review, local label mapping, deduplication and frozen train/test splits.",
    }, positive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional new review CSV inside data/raw; existing files are not overwritten.",
    )
    args = parser.parse_args()
    try:
        if hashlib.sha256(args.dataset.read_bytes()).hexdigest() != SOURCE_SHA256:
            parser.error("Use the original Learned Hands release dated 2022-05-21.")
        report, candidates = inspect(read_csv(args.dataset))
        if args.output:
            target = args.output.resolve()
            if not target.is_relative_to(RAW.resolve()) or target.exists():
                parser.error(
                    "Choose a new file inside data/raw. Existing datasets are not overwritten."
                )
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("x", encoding="utf-8", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(
                    [
                        "case_key",
                        "description",
                        "source_label",
                        "within_app_limit",
                        "reviewed_category",
                        "split",
                        "review_status",
                    ]
                )
                for row in candidates:
                    writer.writerow(
                        [
                            case_key(row["_id"]),
                            row["full_text"].strip(),
                            WORK,
                            len(row["full_text"].encode("utf-16-le")) // 2 <= 1500,
                            "",
                            "",
                            "pending",
                        ]
                    )
            report["reviewCsv"] = str(target.relative_to(RAW.parent))
        print(json.dumps(report, indent=2))
    except (OSError, UnicodeError, csv.Error, KeyError):
        parser.error(
            "Could not inspect the source CSV. Check its path, UTF-8 encoding and required columns."
        )


if __name__ == "__main__":
    main()
