"""RFC 7807 Problem Details error format for all BAMUL API endpoints.

All API routes raise BAMULError subclasses — never return raw dicts or custom
error envelopes. The exception handler converts to RFC 7807 JSON automatically.

Architecture ref: D10 — Error Response Format
"""

from fastapi import Request
from fastapi.responses import JSONResponse


class BAMULError(Exception):
    """Base error class for all BAMUL API errors.

    Automatically serialised to RFC 7807 Problem Details format by
    bamul_error_handler registered in main.py.
    """

    def __init__(
        self,
        type_: str,
        title: str,
        status: int,
        detail: str,
        instance: str = "",
    ) -> None:
        self.type_ = type_
        self.title = title
        self.status = status
        self.detail = detail
        self.instance = instance
        super().__init__(detail)


class NotFoundError(BAMULError):
    def __init__(self, resource: str, identifier: str, instance: str = "") -> None:
        super().__init__(
            type_=f"{resource}/not-found",
            title=f"{resource.replace('-', ' ').title()} not found",
            status=404,
            detail=f"{resource.replace('-', ' ').title()} '{identifier}' does not exist.",
            instance=instance,
        )


class ConflictError(BAMULError):
    def __init__(self, type_: str, title: str, detail: str, instance: str = "") -> None:
        super().__init__(type_=type_, title=title, status=409, detail=detail, instance=instance)


class UnauthorizedError(BAMULError):
    def __init__(self, detail: str = "Authentication required.", instance: str = "") -> None:
        super().__init__(
            type_="auth/unauthorized",
            title="Unauthorized",
            status=401,
            detail=detail,
            instance=instance,
        )


class ForbiddenError(BAMULError):
    def __init__(self, detail: str = "Insufficient permissions.", instance: str = "") -> None:
        super().__init__(
            type_="auth/forbidden",
            title="Forbidden",
            status=403,
            detail=detail,
            instance=instance,
        )


class ValidationError(BAMULError):
    def __init__(self, detail: str, instance: str = "") -> None:
        super().__init__(
            type_="validation/invalid-input",
            title="Validation Error",
            status=422,
            detail=detail,
            instance=instance,
        )


async def bamul_error_handler(request: Request, exc: BAMULError) -> JSONResponse:
    """Convert BAMULError to RFC 7807 Problem Details JSON response."""
    return JSONResponse(
        status_code=exc.status,
        content={
            "type": exc.type_,
            "title": exc.title,
            "status": exc.status,
            "detail": exc.detail,
            "instance": exc.instance or str(request.url.path),
        },
    )
