"""Deterministic processor simulator.

Never random in tests: a scenario name produces the same result every time, and
`lookup()` can resolve an outcome that a timed-out call never returned.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .errors import BadRequest, ErrorCode


class Outcome(StrEnum):
    succeeded = "succeeded"
    declined = "declined"
    timeout = "timeout"
    error = "error"


@dataclass(frozen=True)
class ProcessorResult:
    outcome: Outcome
    reference: str
    failure_code: str | None = None


SCENARIOS = frozenset({"approve", "decline", "timeout", "transient"})


def validate_scenario(scenario: str | None) -> str:
    value = (scenario or "approve").strip().lower()
    if value not in SCENARIOS:
        raise BadRequest(
            f"Unknown simulator scenario '{value}'. Expected one of: "
            + ", ".join(sorted(SCENARIOS)),
            code=ErrorCode.invalid_scenario,
        )
    return value


class Simulator:
    def process(
        self,
        *,
        reference: str,
        scenario: str,
        attempt_number: int,
        amount_minor: int,
    ) -> ProcessorResult:
        del amount_minor  # available for amount-based rules later

        if scenario == "decline":
            return ProcessorResult(Outcome.declined, reference, "card_declined")
        if scenario == "timeout":
            return ProcessorResult(Outcome.timeout, reference, "processor_timeout")
        if scenario == "transient" and attempt_number == 1:
            return ProcessorResult(Outcome.error, reference, "processor_unavailable")
        return ProcessorResult(Outcome.succeeded, reference, None)

    def lookup(self, *, reference: str, scenario: str) -> ProcessorResult:
        """Resolve a previously unknown attempt.

        The simulated processor either completed the operation or it did not.
        For the timeout scenario we model the common case: it completed.
        """
        if scenario == "timeout":
            return ProcessorResult(Outcome.succeeded, reference, None)
        return ProcessorResult(Outcome.succeeded, reference, None)
