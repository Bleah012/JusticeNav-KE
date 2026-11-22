"""Offline evaluation on synthetic descriptions excluded from the fitted model."""

import hashlib
import json
from pathlib import Path

import pytest

from app.issue_classifier import TRAINING_PATH, suggest_issue
from app.issue_evidence import conflicting_claims


@pytest.mark.parametrize(
    "fixture_name", ["issue_evaluation.json", "issue_coverage_evaluation.json"]
)
def test_development_scenarios_cover_four_categories_and_abstention(fixture_name):
    training = json.loads(TRAINING_PATH.read_text(encoding="utf-8"))
    evaluation = json.loads(
        (Path(__file__).with_name("fixtures") / fixture_name).read_text(
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


@pytest.mark.parametrize(
    "description",
    [
        "My employer has not paid my wages and the shop refuses to refund a broken phone.",
        "A lender is pursuing a disputed debt. Separately, my landlord is threatening eviction.",
        "My employer dismissed me but my former partner also refuses the child custody agreement.",
        "Something happened a while ago and I need to know what I should do.",
    ],
)
def test_unclear_or_distinct_claims_abstain_instead_of_selecting_one(description):
    assert suggest_issue(description) is None


@pytest.mark.parametrize(
    "description,expected",
    [
        (
            "I lent a friend money for school fees and they refuse to repay the loan.",
            "money-debt",
        ),
        (
            "My SACCO says I still owe loan arrears after I paid the last instalment. It will not correct the balance.",
            "money-debt",
        ),
        (
            "My employer refused to pay my wages and has dismissed me from my job.",
            "employment",
        ),
        (
            "The shop delivered a faulty phone and refused my request for a refund.",
            "consumer",
        ),
    ],
)
def test_same_issue_conjunctions_and_background_context_do_not_block_suggestions(
    description, expected
):
    assert suggest_issue(description) == expected


def test_fresh_synthetic_probe_is_disjoint_and_reports_no_false_category():
    groups = json.loads(
        (Path(__file__).with_name("fixtures") / "abstention_probe.json").read_text(
            encoding="utf-8"
        )
    )
    training = json.loads(TRAINING_PATH.read_text(encoding="utf-8"))

    def normalized(text):
        return " ".join(text.casefold().split())

    existing = {normalized(text) for texts in training.values() for text in texts}
    for name in (
        "issue_evaluation.json",
        "issue_coverage_evaluation.json",
        "employment_validation.json",
    ):
        prior = json.loads(
            (Path(__file__).with_name("fixtures") / name).read_text(encoding="utf-8")
        )
        existing.update(normalized(text) for texts in prior.values() for text in texts)
    for label, texts in groups.items():
        assert existing.isdisjoint(map(normalized, texts))
        predicted = [suggest_issue(text) for text in texts]
        if label == "uncertain":
            assert predicted == [None] * len(texts)
        else:
            assert set(predicted) <= {label, None}
            assert predicted.count(label) >= 2


def test_evaluation_does_not_change_training_and_clause_work_is_bounded():
    before = hashlib.sha256(TRAINING_PATH.read_bytes()).hexdigest()
    assert conflicting_claims("My employer owes salary; " * 100)
    assert suggest_issue("My employer owes salary;" * 65) is None
    assert hashlib.sha256(TRAINING_PATH.read_bytes()).hexdigest() == before


@pytest.mark.parametrize("separator", [". ", ", ", ": "])
def test_independent_complaints_are_detected_across_punctuation(separator):
    text = separator.join(
        [
            "My employer has withheld my salary for three months",
            "A shop sold me a faulty product",
        ]
    )
    assert suggest_issue(text) is None


def test_specific_employment_phrase_and_routine_debt_context_are_distinguished():
    assert (
        suggest_issue(
            "My employer refuses to give my certificate of service. A lender refuses to correct the loan balance."
        )
        is None
    )
    assert (
        suggest_issue(
            "The shop sold me a faulty television and refuses a refund. I repay my loan every month."
        )
        == "consumer"
    )


def test_clause_limit_counts_nonempty_clauses_not_terminal_punctuation():
    assert not conflicting_claims("My employer owes salary." * 64)
    assert conflicting_claims("My employer owes salary." * 65)
