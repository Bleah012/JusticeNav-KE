"""Suggest a broad issue from a small, synthetic English training corpus."""

import json
import math
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Literal, get_args

Issue = Literal["consumer", "money-debt", "other"]
TRAINING_PATH = Path(__file__).with_name("issue_training.json")
MIN_SCORE = 0.56
MIN_MARGIN = 0.18
STOP_WORDS = frozenset(
    "about after all am an and are as at be been before but by can could did do does "
    "for from had has have how in into is it its me more my of on or our she so than "
    "that the their them then there they this to up us was we were what when which "
    "who will with would you your".split()
)
type Vector = dict[str, float]


class SuggestionUnavailable(Exception):
    """The local model could not be loaded or evaluated."""


def _terms(description: str) -> Counter[str]:
    words = [
        word
        for word in re.findall(r"[a-z]{2,}", description.casefold())
        if word not in STOP_WORDS
    ]
    return Counter([*words, *(f"{a} {b}" for a, b in zip(words, words[1:]))])


def _tfidf(terms: Counter[str], idf: Vector) -> Vector:
    weights = {
        term: (1 + math.log(count)) * idf[term]
        for term, count in terms.items()
        if term in idf
    }
    norm = math.sqrt(sum(weight * weight for weight in weights.values()))
    return {term: weight / norm for term, weight in weights.items()}


def _probabilities(vector: Vector, weights: list[Vector], biases: list[float]):
    scores = [
        bias + sum(row[term] * value for term, value in vector.items())
        for row, bias in zip(weights, biases)
    ]
    highest = max(scores)
    scaled = [math.exp(score - highest) for score in scores]
    total = sum(scaled)
    return [score / total for score in scaled]


@lru_cache(maxsize=1)
def _model():
    """Fit multinomial logistic regression with deterministic batch gradient descent."""
    groups = json.loads(TRAINING_PATH.read_text(encoding="utf-8"))
    labels = get_args(Issue)
    if not isinstance(groups, dict) or set(groups) != set(labels):
        raise ValueError("Invalid issue training labels")
    if any(
        not isinstance(examples, list)
        or not examples
        or any(not isinstance(text, str) or not text.strip() for text in examples)
        for examples in groups.values()
    ):
        raise ValueError("Invalid issue training examples")
    examples = [
        (index, _terms(description))
        for index, label in enumerate(labels)
        for description in groups[label]
    ]
    count = len(examples)
    frequencies = Counter(term for _, terms in examples for term in terms)
    idf = {
        term: 1 + math.log((1 + count) / (1 + frequency))
        for term, frequency in frequencies.items()
    }
    samples = [(label, _tfidf(terms, idf)) for label, terms in examples]
    weights = [dict.fromkeys(idf, 0.0) for _ in labels]
    biases = [0.0] * len(labels)

    # Gradients of the summed cross-entropy plus an L2 penalty on weights.
    for _ in range(400):
        gradients = [
            {term: weight / 16 for term, weight in row.items()} for row in weights
        ]
        bias_gradients = [0.0] * len(labels)
        for label, vector in samples:
            for index, probability in enumerate(
                _probabilities(vector, weights, biases)
            ):
                error = probability - (index == label)
                bias_gradients[index] += error
                for term, value in vector.items():
                    gradients[index][term] += error * value
        for index, row in enumerate(weights):
            for term, gradient in gradients[index].items():
                row[term] -= 3 * gradient / count
            biases[index] -= 3 * bias_gradients[index] / count
    return labels, idf, weights, biases


def suggest_issue(description: str) -> Issue | None:
    """Run inference in memory and abstain on sparse or ambiguous evidence."""
    try:
        labels, idf, weights, biases = _model()
        features = _tfidf(_terms(description), idf)
        if sum(" " not in term for term in features) < 3:
            return None
        probabilities = _probabilities(features, weights, biases)
        best, runner_up, _ = sorted(
            range(len(labels)), key=probabilities.__getitem__, reverse=True
        )
        if (
            probabilities[best] < MIN_SCORE
            or probabilities[best] - probabilities[runner_up] < MIN_MARGIN
        ):
            return None
        return labels[best]
    except (OSError, ValueError) as error:
        raise SuggestionUnavailable from error
