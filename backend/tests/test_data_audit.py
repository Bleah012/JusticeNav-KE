"""Synthetic regression data and data-completeness checks use no private CSVs."""

import importlib.util
import shutil
import sys
from pathlib import Path

import pytest


@pytest.fixture
def audit(tmp_path, monkeypatch):
    data = Path(__file__).resolve().parents[2] / "data"
    monkeypatch.syspath_prepend(str(data))
    spec = importlib.util.spec_from_file_location(
        "classifier_audit_test", data / "evaluate_classifier.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    (tmp_path / "samples").mkdir()
    (tmp_path / "raw").mkdir()
    shutil.copyfile(
        data / "samples/kenyan-english-development.csv",
        tmp_path / "samples/kenyan-english-development.csv",
    )
    shutil.copyfile(
        data / "samples/kenyan-english-synthetic-evaluation.csv",
        tmp_path / "samples/kenyan-english-synthetic-evaluation.csv",
    )
    shutil.copyfile(
        data / "samples/synthetic-evaluation-provenance.json",
        tmp_path / "samples/synthetic-evaluation-provenance.json",
    )
    monkeypatch.setattr(module, "DATA", tmp_path)
    return module, tmp_path


def test_audit_distinguishes_missing_and_blank_independent_data(audit):
    module, path = audit
    result = module.report()
    assert result["training"]["counts"] == {
        "consumer": 40,
        "money-debt": 40,
        "employment": 38,
        "other": 38,
    }
    assert result["independentCsv"]["status"] == "missing"
    assert result["learnedHands"]["status"] == "missing"
    (path / "raw/kenyan-english-evaluation.csv").write_text(
        "case_id,description,expected_category\nKE001,,\n", encoding="utf-8"
    )
    assert module.report()["independentCsv"]["status"] == "blank-template"


def test_synthetic_development_cases_do_not_train_model_and_keep_fallback(audit):
    module, _ = audit
    result = module.report()["evaluations"]["synthetic_kenyan_english_development"]
    assert result["labeled"] == 30 and result["correct"] >= 27
    assert (
        result["wrong"] == 0
        and result["ambiguous"] == result["ambiguousAbstained"] == 6
    )


def test_data_report_never_labels_populated_csv_as_independent_by_itself(audit):
    module, path = audit
    (path / "raw/kenyan-english-evaluation.csv").write_text(
        "case_id,description,expected_category\nKE001,I need help please,unsure\n",
        encoding="utf-8",
    )
    data = module.report()["independentCsv"]
    assert data["status"] == "populated-unverified" and data["completeCases"] == 1
    assert "I need help" not in str(data)


def test_employment_validation_retains_clear_case_coverage_and_reports_mixed_limit(
    audit,
):
    module, _ = audit
    result = module.report()["evaluations"]["employment_validation"]
    assert result["labeled"] == 20 and result["correct"] >= 19
    assert result["wrong"] == 0
    assert result["ambiguous"] == 8 and result["ambiguousAbstained"] >= 7


def test_employment_candidates_preserve_unknown_labels_and_mixed_issues(audit):
    from prepare_employment_review import inspect

    rows = [
        {
            "WO-00-00-00-00": "1.0",
            "full_text": "Synthetic workplace dispute",
            "MO-00-00-00-00": "1.0",
        },
        {"WO-00-00-00-00": "1.0", "full_text": "x" * 1501},
        {"WO-00-00-00-00": "0.0", "full_text": "Not labeled employment"},
        {"WO-00-00-00-00": "", "full_text": "Unknown label"},
    ]
    report, candidates = inspect(rows)
    assert report["employmentPositive"] == 2 and report["employmentNegative"] == 1
    assert report["employmentUnknown"] == report["positiveWithinAppTextLimit"] == 1
    assert (
        report["positiveAlsoConsumerOrMoney"] == 1 and report["readyForTraining"] == 0
    )
    assert len(candidates) == 2 and "Synthetic workplace" not in str(report)


def test_frozen_synthetic_sample_retains_clear_coverage_and_abstains_on_ambiguity(
    audit,
):
    module, _ = audit
    result = module.report()["evaluations"]["synthetic_english_abstention_regression"]
    assert result["labeled"] == 48 and result["correct"] >= 47
    assert result["wrong"] == 0 and result["unsure"] <= 1
    assert result["ambiguous"] == result["ambiguousAbstained"] == 12


def test_audit_rejects_changed_frozen_labels_instead_of_reporting_improved_scores(
    audit,
):
    module, path = audit
    sample = path / "samples/kenyan-english-synthetic-evaluation.csv"
    sample.write_text(
        sample.read_text(encoding="utf-8").replace('"unsure"', '"other"', 1),
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Frozen synthetic regression sample"):
        module.report()
