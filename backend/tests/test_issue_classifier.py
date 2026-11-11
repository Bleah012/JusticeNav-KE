"""Offline evaluation on synthetic descriptions excluded from the fitted model."""

import json
from pathlib import Path

from app.issue_classifier import TRAINING_PATH, suggest_issue


def test_held_out_scenarios_cover_all_three_categories_and_abstention():
    training = json.loads(TRAINING_PATH.read_text(encoding="utf-8"))
    evaluation = json.loads(
        (Path(__file__).with_name("fixtures") / "issue_evaluation.json").read_text(
            encoding="utf-8"
        )
    )
    training_texts = {
        text.casefold() for examples in training.values() for text in examples
    }
    for label, examples in evaluation.items():
        assert training_texts.isdisjoint(text.casefold() for text in examples)
        predicted = [suggest_issue(text) for text in examples]
        if label == "uncertain":
            assert predicted == [None] * len(examples)
        else:
            assert predicted.count(label) >= 2
            assert set(predicted) <= {label, None}
