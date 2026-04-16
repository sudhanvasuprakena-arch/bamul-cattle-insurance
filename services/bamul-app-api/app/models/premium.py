"""SQLAlchemy ORM models for the 'premium' schema domain.

Domain: Premium payment records, payment schedules, premium history.
Tables defined in later stories: premium_payments, payment_schedules (Story 2+)

Architecture refs:
- D12: Pagination — offset-based for premium history (predictable, small result sets)

Key premium-domain rules:
- All monetary values in BIGINT (paise): premium_amount_paise, paid_amount_paise
- Farmer-facing report queries use offset pagination (not cursor-based)
- bamul_app has full SELECT/INSERT/UPDATE/DELETE on premium schema
"""

from app.core.database import Base  # noqa: F401 — imported so Alembic tracks this schema

__all__: list[str] = []
