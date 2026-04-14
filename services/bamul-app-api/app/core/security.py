"""JWT verification and RBAC permission enforcement.

Architecture ref: D5 — RBAC: Application-Level with Three-Part Permission Taxonomy
Permission format: resource:action:scope  e.g. enrollment:create:own_taluk

JWT tokens: 8-hour access token, 30-day refresh token.
Permissions cached in Redis at login — zero-latency permission checks.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

log = structlog.get_logger()
settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    """Create a JWT access token. expires_delta defaults to 8 hours."""
    to_encode = data.copy()
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=settings.jwt_access_token_expire_minutes))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_access_token(token: str) -> dict[str, Any]:
    """Verify a JWT access token and return the payload. Raises JWTError on failure."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            raise JWTError("Not an access token")
        return payload
    except JWTError as e:
        log.warning("jwt.verification_failed", error=str(e))
        raise


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)
