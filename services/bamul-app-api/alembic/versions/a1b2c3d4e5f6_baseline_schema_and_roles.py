"""baseline_schema_and_roles

Creates the five application PostgreSQL schemas, the uuid_generate_v7() function
(implemented in pure PL/pgSQL via pgcrypto — no pg_uuidv7 extension required,
works on both local Postgres and AWS RDS PostgreSQL 15), and the two application
DB roles with schema-level grants.

Architecture refs:
- D1: SQLAlchemy + Alembic (schema version control)
- D8: Biometric Data — Three-Layer Schema ACL
- Naming Patterns: snake_case schemas, UUID v7 PKs, BIGINT monetary columns

DB role strategy:
- bamul_app     : App API user — identity, insurance, compliance, premium schemas
- biometric_rw  : AI service user — biometric schema ONLY; denied all other schemas
- bamul_admin   : RDS master / migration runner (created by CDK, not here)

Password note:
  Dev passwords ('bamul_app_dev', 'biometric_rw_dev') are LOCAL DEVELOPMENT ONLY.
  In staging/production, passwords are rotated immediately after user creation
  via AWS Secrets Manager (bamul/biometric-rw-credentials secret — Story 1.6).

Revision ID: a1b2c3d4e5f6
Revises:
Create Date: 2026-04-16

"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_APP_SCHEMAS = ("identity", "insurance", "compliance", "premium")
_BIOMETRIC_SCHEMA = "biometric"
_ALL_SCHEMAS = (*_APP_SCHEMAS, _BIOMETRIC_SCHEMA)


def upgrade() -> None:
    # ── pgcrypto — required for gen_random_bytes() used in uuid_generate_v7 ───
    # pgcrypto is an AWS RDS trusted extension available on PostgreSQL 15.
    op.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))

    # ── uuid_generate_v7() — time-ordered UUID v7 in pure PL/pgSQL ───────────
    # Implements RFC 9562 UUID version 7: 48-bit millisecond timestamp prefix
    # followed by 74 random bits with version (0111) and variant (10xx) fields.
    # Time-ordered PKs preserve B-tree index locality at 4 lakh+ rows (vs v4).
    # All SQLAlchemy models use: server_default=text("uuid_generate_v7()")
    op.execute(
        text("""
        CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
        RETURNS uuid AS $$
        DECLARE
            unix_ts_ms BIGINT;
            uuid_bytes BYTEA;
            hex_val    TEXT;
        BEGIN
            unix_ts_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
            uuid_bytes := gen_random_bytes(16);

            -- Embed 48-bit millisecond timestamp in first 6 bytes
            uuid_bytes := set_byte(uuid_bytes, 0, ((unix_ts_ms >> 40) & 255)::INT);
            uuid_bytes := set_byte(uuid_bytes, 1, ((unix_ts_ms >> 32) & 255)::INT);
            uuid_bytes := set_byte(uuid_bytes, 2, ((unix_ts_ms >> 24) & 255)::INT);
            uuid_bytes := set_byte(uuid_bytes, 3, ((unix_ts_ms >> 16) & 255)::INT);
            uuid_bytes := set_byte(uuid_bytes, 4, ((unix_ts_ms >>  8) & 255)::INT);
            uuid_bytes := set_byte(uuid_bytes, 5, ( unix_ts_ms        & 255)::INT);

            -- Set version = 7 in bits 76..79 (high nibble of byte 6)
            uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);

            -- Set variant = 10xx in bits 64..65 (byte 8)
            uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);

            hex_val := encode(uuid_bytes, 'hex');
            RETURN (
                substring(hex_val,  1, 8) || '-' ||
                substring(hex_val,  9, 4) || '-' ||
                substring(hex_val, 13, 4) || '-' ||
                substring(hex_val, 17, 4) || '-' ||
                substring(hex_val, 21, 12)
            )::uuid;
        END;
        $$ LANGUAGE plpgsql;
    """)
    )

    # ── Application schemas ────────────────────────────────────────────────────
    for schema in _ALL_SCHEMAS:
        op.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))  # noqa: S608

    # ── DB role: bamul_app ────────────────────────────────────────────────────
    # App API database user — can read/write identity, insurance, compliance, premium.
    # Cannot access biometric schema (neither USAGE nor table grants).
    # PRODUCTION: password is rotated immediately via Secrets Manager after first deploy.
    op.execute(
        text("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bamul_app') THEN
                CREATE ROLE bamul_app WITH LOGIN PASSWORD 'bamul_app_dev';
            END IF;
        END $$
    """)
    )
    op.execute(
        text(
            "GRANT USAGE ON SCHEMA identity, insurance, compliance, premium TO bamul_app"
        )
    )
    for schema in _APP_SCHEMAS:
        op.execute(
            text(f"""
            ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bamul_app
        """)  # noqa: S608
        )
        op.execute(
            text(f"""
            ALTER DEFAULT PRIVILEGES IN SCHEMA {schema}
            GRANT USAGE, SELECT ON SEQUENCES TO bamul_app
        """)  # noqa: S608
        )

    # ── DB role: biometric_rw ─────────────────────────────────────────────────
    # AI service database user — restricted to biometric schema ONLY.
    # Three-layer ACL (architecture D8):
    #   Layer 1 — Network: AI service reaches RDS only via private subnet
    #   Layer 2 — DB user: biometric_rw has no USAGE on any other schema
    #   Layer 3 — App: AI service never receives farmer PII from App API
    # PRODUCTION: password is rotated via Secrets Manager (bamul/biometric-rw-credentials).
    op.execute(
        text("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'biometric_rw') THEN
                CREATE ROLE biometric_rw WITH LOGIN PASSWORD 'biometric_rw_dev';
            END IF;
        END $$
    """)
    )
    op.execute(text(f"GRANT USAGE ON SCHEMA {_BIOMETRIC_SCHEMA} TO biometric_rw"))  # noqa: S608
    op.execute(
        text(f"""
        ALTER DEFAULT PRIVILEGES IN SCHEMA {_BIOMETRIC_SCHEMA}
        GRANT SELECT, INSERT, UPDATE ON TABLES TO biometric_rw
    """)  # noqa: S608
    )
    op.execute(
        text(f"""
        ALTER DEFAULT PRIVILEGES IN SCHEMA {_BIOMETRIC_SCHEMA}
        GRANT USAGE, SELECT ON SEQUENCES TO biometric_rw
    """)  # noqa: S608
    )
    # Explicitly deny biometric_rw any access to app schemas (defence in depth)
    op.execute(
        text(
            "REVOKE ALL ON SCHEMA identity, insurance, compliance, premium FROM biometric_rw"
        )
    )


def downgrade() -> None:
    # Revoke grants before dropping roles
    op.execute(
        text(f"REVOKE ALL ON SCHEMA {_BIOMETRIC_SCHEMA} FROM biometric_rw")  # noqa: S608
    )
    op.execute(
        text(
            "REVOKE ALL ON SCHEMA identity, insurance, compliance, premium FROM bamul_app"
        )
    )

    # Drop roles (safe — no tables exist in baseline; only default privilege records)
    op.execute(
        text("""
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'biometric_rw') THEN
                DROP ROLE biometric_rw;
            END IF;
        END $$
    """)
    )
    op.execute(
        text("""
        DO $$ BEGIN
            IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bamul_app') THEN
                DROP ROLE bamul_app;
            END IF;
        END $$
    """)
    )

    # Drop schemas (CASCADE drops any future objects too — safe in downgrade)
    for schema in reversed(_ALL_SCHEMAS):
        op.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))  # noqa: S608

    # Drop uuid_generate_v7 function
    op.execute(text("DROP FUNCTION IF EXISTS public.uuid_generate_v7()"))

    # Drop pgcrypto extension
    op.execute(text("DROP EXTENSION IF EXISTS pgcrypto"))
