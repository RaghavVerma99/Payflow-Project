from __future__ import annotations

from enum import StrEnum


class ErrorCode(StrEnum):
    invalid_request = "invalid_request"
    invalid_amount = "invalid_amount"
    unsupported_currency = "unsupported_currency"
    unauthorized = "unauthorized"
    forbidden = "forbidden"
    not_found = "not_found"
    method_not_allowed = "method_not_allowed"
    idempotency_key_required = "idempotency_key_required"
    idempotency_conflict = "idempotency_conflict"
    idempotency_in_progress = "idempotency_in_progress"
    invalid_transition = "invalid_transition"
    payment_not_refundable = "payment_not_refundable"
    refund_exceeds_balance = "refund_exceeds_balance"
    simulator_controls_disabled = "simulator_controls_disabled"
    invalid_scenario = "invalid_scenario"
    payload_too_large = "payload_too_large"
    internal_error = "internal_error"


class DomainError(Exception):
    """Every expected failure becomes this, so the HTTP envelope stays uniform."""

    code: ErrorCode = ErrorCode.invalid_request
    status_code: int = 400

    def __init__(
        self,
        message: str,
        *,
        code: ErrorCode | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.headers = headers or {}


class BadRequest(DomainError):
    status_code = 400


class Unauthorized(DomainError):
    code = ErrorCode.unauthorized
    status_code = 401


class NotFound(DomainError):
    code = ErrorCode.not_found
    status_code = 404


class Conflict(DomainError):
    status_code = 409


class IdempotencyConflict(Conflict):
    code = ErrorCode.idempotency_conflict


class IdempotencyInProgress(Conflict):
    code = ErrorCode.idempotency_in_progress

    def __init__(
        self, message: str = "A request with this idempotency key is in progress."
    ) -> None:
        super().__init__(message, headers={"Retry-After": "1"})


class InvalidTransition(Conflict):
    code = ErrorCode.invalid_transition
