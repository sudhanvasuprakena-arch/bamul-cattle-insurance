"""FastAPI dependencies used by ALL routes.

Architecture ref: FastAPI Auth Dependency pattern
get_current_user — verifies JWT, loads permissions from Redis.
get_db — yields async SQLAlchemy session (see core/database.py).
"""

from typing import Annotated

import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import verify_access_token

log = structlog.get_logger()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class AuthenticatedUser:
    """Represents the authenticated caller on a request."""

    def __init__(self, user_id: str, role: str, permissions: set[str]) -> None:
        self.user_id = user_id
        self.role = role
        self.permissions = permissions

    def has_permission(self, permission: str) -> bool:
        """Check resource:action:scope permission string."""
        return permission in self.permissions


async def get_redis() -> Redis:  # type: ignore[return]
    """Placeholder — Redis connection injected after Story 1.3 (auth infrastructure)."""
    raise NotImplementedError("Redis dependency not yet wired — complete Story 1.3")


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> AuthenticatedUser:
    """Verify JWT and return authenticated user with Redis-cached permissions.

    Raises HTTP 401 if token is invalid or expired.
    Full implementation in Story 1.3 (OTP auth + JWT issuance).
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = verify_access_token(token)
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError as e:
        raise credentials_exception from e

    # Permissions loaded from Redis in Story 1.3
    return AuthenticatedUser(user_id=user_id, role=payload.get("role", ""), permissions=set())


# Type aliases for route function signatures
DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[AuthenticatedUser, Depends(get_current_user)]
