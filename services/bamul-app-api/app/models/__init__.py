"""SQLAlchemy ORM models package.

Importing this package registers all model tables with Base.metadata,
which Alembic uses for autogenerate support.

Architecture ref: D1 — SQLAlchemy 2.x (async) + Alembic; Repository pattern
"""

from app.core.database import Base
from app.models import biometric, compliance, identity, insurance, premium

__all__ = ["Base", "biometric", "compliance", "identity", "insurance", "premium"]
