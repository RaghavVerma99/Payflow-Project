from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .api import accounts, health, payments, refunds
from .config import Settings
from .errors import DomainError, ErrorCode
from .request_context import RequestContextMiddleware, current_request_id
from .worker import WorkerThread

logger = logging.getLogger("payflow")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    db.configure(settings.database_url)
    db.init_db()

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # noqa: ANN202
        worker: WorkerThread | None = None
        if settings.worker_enabled:
            worker = WorkerThread(settings)
            worker.start()
            logger.info("background worker started")
        try:
            yield
        finally:
            if worker is not None:
                worker.stop()
                worker.join(timeout=5)
                logger.info("background worker stopped")

    app = FastAPI(
        title="PayFlow",
        version="0.1.0",
        description=(
            "A simulation-only payment processing API. No real cards, no real money. "
            "Amounts are integer minor units (paise)."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings

    app.add_middleware(RequestContextMiddleware)

    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):  # noqa: ANN001
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                too_large = int(content_length) > settings.max_request_bytes
            except ValueError:
                too_large = False
            if too_large:
                return _error_response(
                    413,
                    ErrorCode.payload_too_large,
                    "Request body is too large.",
                )
        return await call_next(request)

    @app.exception_handler(DomainError)
    async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:  # noqa: ARG001
        return _error_response(exc.status_code, exc.code, exc.message, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:  # noqa: ARG001
        first = exc.errors()[0] if exc.errors() else {"loc": (), "msg": "Invalid request."}
        location = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        message = f"{location}: {first['msg']}" if location else first["msg"]
        return _error_response(422, ErrorCode.invalid_request, message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:  # noqa: ARG001
        code = {
            404: ErrorCode.not_found,
            405: ErrorCode.method_not_allowed,
        }.get(exc.status_code, ErrorCode.invalid_request)
        message = "Not found." if exc.status_code == 404 else str(exc.detail)
        return _error_response(exc.status_code, code, message)

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:  # noqa: ARG001
        logger.exception("unhandled error")
        return _error_response(
            500, ErrorCode.internal_error, "An internal error occurred."
        )

    app.include_router(health.router)
    app.include_router(payments.router)
    app.include_router(refunds.router)
    app.include_router(accounts.router)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {"name": "PayFlow", "docs": "/docs", "mode": "simulation"}

    return app


def _error_response(
    status_code: int,
    code: ErrorCode,
    message: str,
    *,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": str(code),
                "message": message,
                "request_id": current_request_id(),
            }
        },
        headers=headers,
    )
