"""Migration-runner DB/secret isolation (ADR-0002 / R-2).

Connection URL is read only from gitignored ``.env.migrations``.
``psycopg`` is imported lazily inside ``connect()`` so pure helpers
(``redact``, ``load_migration_url``) remain testable without the driver.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

from dotenv import dotenv_values

ENV_MIGRATIONS_PATH = Path(__file__).resolve().parent.parent / ".env.migrations"


def redact(url: str) -> str:
    """Return ``url`` with the password component replaced by ``***``.

    Unparseable strings that look credential-bearing collapse to ``***``;
    strings with no password pass through unchanged. Never leaves a raw
    password in the returned value.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return "***"

    if not parsed.scheme or not parsed.netloc:
        if "://" in url and "@" in url:
            return "***"
        return url

    if parsed.password is None:
        return url

    user = parsed.username or ""
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port is not None else ""
    netloc = f"{user}:***@{host}{port}"
    return urlunparse(
        (parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment)
    )


def _scrub_exception_text(text: str, url: str) -> str:
    """Remove raw URL/password from exception text (INV-5)."""
    scrubbed = text.replace(url, redact(url))
    try:
        password = urlparse(url).password
    except Exception:
        password = None
    if password:
        scrubbed = scrubbed.replace(password, "***")
    return scrubbed


def load_migration_url() -> str:
    """Load ``MIGRATION_DATABASE_URL`` from ``.env.migrations`` (never log it)."""
    values = dotenv_values(ENV_MIGRATIONS_PATH)
    raw = values.get("MIGRATION_DATABASE_URL")
    url = (raw or "").strip()
    if not url:
        raise RuntimeError(
            "MIGRATION_DATABASE_URL tanımsız — .env.migrations (gitignored) "
            "doldurulmalı; .env.migrations.example'a bak"
        )
    return url


def connect() -> Any:
    """Open a psycopg connection (context-manager). Lazy-imports the driver."""
    import psycopg

    url = load_migration_url()
    try:
        return psycopg.connect(url)
    except Exception as exc:
        safe = _scrub_exception_text(str(exc), url)
        raise RuntimeError(f"DB connection failed ({redact(url)}): {safe}") from None


def fetch_applied(conn: Any) -> dict[str, str]:
    """Return ``{version: checksum}`` from ``schema_migrations`` (read-only)."""
    rows = conn.execute(
        "SELECT version, checksum FROM schema_migrations"
    ).fetchall()
    return {str(version): str(checksum) for version, checksum in rows}


def bootstrap(conn: Any) -> None:
    """Ensure ``schema_migrations`` exists (idempotent DDL)."""
    from scripts.migrate import SCHEMA_MIGRATIONS_DDL

    conn.execute(SCHEMA_MIGRATIONS_DDL)
    conn.commit()


def insert_applied(conn: Any, migrations: list[tuple[str, str, str]]) -> None:
    """Insert ``(version, filename, checksum)`` rows into ``schema_migrations``.

    Single transaction. Does **not** run migration SQL — bookkeeping only (INV-4).
    Caller must send only missing versions; primary-key collisions still surface
    as IntegrityError. Rolls back on error.
    """
    if not migrations:
        return
    try:
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO schema_migrations (version, filename, checksum) "
                "VALUES (%s, %s, %s)",
                migrations,
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def apply_migration(
    conn: Any, version: str, filename: str, checksum: str, sql_text: str
) -> None:
    """Run one migration's SQL and record it — single outer transaction (R-4).

    tx-model (ADR-0002 / YOL 2):
      * The migration file runs AS-IS via one ``cur.execute(sql_text)``; the
        bookkeeping INSERT is a SEPARATE parametreli ``execute`` in the SAME
        outer transaction, then ``conn.commit()``.
      * Neden tek execute'a gömülmedi: psycopg3 parametreli sorguda
        çoklu-statement'ı reddeder ("cannot insert multiple commands into a
        prepared statement"), o yüzden bookkeeping ayrı parametreli execute.
      * Atomiklik: tx-İFADESİZ (BEGIN;/COMMIT; taşımayan) dosyalarda dış-tx
        SQL+bookkeeping'i atomik sarar (ÖLÇÜLDÜ, pencere yok). Kendi
        BEGIN;/COMMIT;'ini taşıyan (eski) dosyalarda, dosya-içi COMMIT dış-tx'i
        erken kapatır → bookkeeping ikinci bir tx'e düşer → süreç tam o aralıkta
        ölürse SQL uygulanmış ama kaydedilmemiş kalabilir. Bu pencere BİLİNÇLİ,
        bug değil: eski migration'lar checksum-kilitli, değiştirilemez. Kurtarma
        deterministik — bkz. scripts/README.md ve _cmd_up.
      * execute/INSERT CURSOR'dan gider (psycopg3'te Connection.executemany yok).
    Hata olursa rollback (aborted-tx güvenli).
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql_text)
            cur.execute(
                "INSERT INTO schema_migrations (version, filename, checksum) "
                "VALUES (%s, %s, %s)",
                (version, filename, checksum),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
