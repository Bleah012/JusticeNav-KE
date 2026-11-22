"""Conservative abstention checks; these rules never choose a saved category."""

import re
from collections.abc import Iterable

REQUEST_WORDS = frozenset(
    "need should while help want know problem issue situation something someone "
    "anyone happened happen things question information advice understand "
    "understanding tell telling point begin start difficult matters matter "
    "agreement payments person can could would please explain".split()
)

# Broad editorial topic cues, not legal tests or a second predictive model.
# A clause must name exactly one topic AND describe a grievance before it can
# contribute to a conflict. Context such as borrowing for school is not enough.
TOPICS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\b(?:shop|shops|seller|retailer|supermarket|product|goods|bought|buy|"
        r"purchas\w*|refund\w*|warranty|advert\w*|repair\w*|deliver\w*|booking|"
        r"ticket|customer|subscription|courier|paid service|contractor|technician|"
        r"cleaner|garage|salon|tailor|laundrette|optician|bakery|installer|caterer)\b",
        r"\b(?:loan\w*|lend\w*|lent|debt\w*|borrow\w*|repay\w*|credit\w*|"
        r"collect\w*|guarant\w*|cosign\w*|co-sign\w*|promissory|instalment\w*|"
        r"installment\w*|arrears|interest|sacco|chama|owe\w*)\b",
        r"\b(?:employ\w*|salary|salaries|wage\w*|job\w*|workplace|coworker|"
        r"co-worker|supervisor|boss|payslip\w*|dismiss\w*|overtime|human resources|"
        r"maternity leave|annual leave|sick leave|redundan\w*|trade union|"
        r"working hours|certificate of service|fired|laid off)\b",
        r"\b(?:landlord|tenant\w*|tenancy|lease|rent\w*|evict\w*|custody|"
        r"visitation|child\w*|parent\w*|estate|inherit\w*|last will|succession|"
        r"boundar\w*|fence|plot|birth|certificate(?!\s+of\s+service)|identity|registr\w*|permit|county|"
        r"school\w*|universit\w*|college|guardian\w*|domestic|police|assault\w*|"
        r"neighbour.*(?:land|path)|survey\w*)\b",
    )
)
GRIEVANCE = re.compile(
    r"\b(?:refus\w*|reject\w*|faulty|broken|damaged|unpaid|not|cannot|disput\w*|"
    r"dismiss\w*|evict\w*|harass\w*|ignor\w*|threat\w*|wrong|"
    r"missing|withheld|stopped|deduct\w*|complain\w*|challeng\w*|argu\w*|"
    r"disagree\w*|fail\w*|chas\w*|pursu\w*|owe\w*\s+(?:me\s+)?(?:wages?|salary))\b",
    re.IGNORECASE,
)
CLAUSE_BOUNDARY = re.compile(
    r"[.!?;,:\n]+|\b(?:and|but|whereas|separately)\b", re.IGNORECASE
)
MAX_CLAUSES = 64
OTHER_CONTEXT = re.compile(
    TOPICS[-1].pattern
    + r"|\b(?:property|housing|house|flat|apartment|family|relative\w*|grandfather|grandmother)\b",
    re.IGNORECASE,
)


def has_specific_evidence(
    features: Iterable[str], issue: str, description: str
) -> bool:
    """Require a matched word beyond generic request language, not just a score."""
    if not any(" " not in term and term not in REQUEST_WORDS for term in features):
        return False
    # Other covers many domains; a high score on generic prose alone must not
    # be interpreted as evidence that a particular unsupported issue exists.
    return issue != "other" or OTHER_CONTEXT.search(description) is not None


def conflicting_claims(description: str) -> bool:
    """Abstain on distinct explicit topic/grievance clauses or excessive fragments.

    This cannot detect every mixed issue or reliably resolve negation, reported
    speech and dependent facts. The seeker retains manual choice in every case.
    """
    clauses = [
        clause
        for clause in CLAUSE_BOUNDARY.split(description, maxsplit=MAX_CLAUSES * 2)
        if clause.strip()
    ]
    if len(clauses) > MAX_CLAUSES:
        return True
    observed = set()
    for clause in clauses:
        topics = {
            index for index, pattern in enumerate(TOPICS) if pattern.search(clause)
        }
        if len(topics) == 1 and GRIEVANCE.search(clause):
            observed.update(topics)
            if len(observed) > 1:
                return True
    return False
