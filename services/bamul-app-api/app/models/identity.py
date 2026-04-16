"""SQLAlchemy ORM models for the 'identity' schema domain.

Domain: Farmer identity, KYC references, UIDAI VID tokens.
Tables defined in later stories: farmers, farmer_kyc (Story 1.7+)

Architecture refs:
- D8: identity.farmer_kyc — App API only; VID/token; no raw Aadhaar column;
  CHECK constraint enforced at DB level.
- DPDP Act 2023: Aadhaar VID constraint is schema-enforced, not just convention.

Mandatory column patterns for ALL models in this schema:

    import uuid
    from datetime import datetime
    from sqlalchemy import BigInteger, DateTime, String, text
    from sqlalchemy.dialects.postgresql import UUID
    from sqlalchemy.orm import Mapped, mapped_column
    from sqlalchemy.sql import func
    from app.core.database import Base

    class ExampleModel(Base):
        __tablename__ = "example_table"          # snake_case, plural
        __table_args__ = {"schema": "identity"}  # always specify schema

        # PK: UUID v7 (time-ordered) — MANDATORY; never uuid_generate_v4()
        id: Mapped[uuid.UUID] = mapped_column(
            UUID(as_uuid=True),
            primary_key=True,
            server_default=text("uuid_generate_v7()"),
        )

        # Timestamps: ALWAYS DateTime(timezone=True) — TIMESTAMPTZ in Postgres
        # NEVER DateTime() without timezone=True
        created_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True),
            server_default=func.now(),
            nullable=False,
        )
        updated_at: Mapped[datetime] = mapped_column(
            DateTime(timezone=True),
            server_default=func.now(),
            onupdate=func.now(),
            nullable=False,
        )

        # Monetary: ALWAYS BigInteger (paise) — NEVER Float, Numeric, or Integer
        # Example: sum_insured_paise: Mapped[int] = mapped_column(BigInteger)

        # Boolean: is_ or has_ prefix
        # Example: is_active: Mapped[bool] = mapped_column(Boolean, default=True)
"""

from app.core.database import Base  # noqa: F401 — imported so Alembic tracks this schema

__all__: list[str] = []
