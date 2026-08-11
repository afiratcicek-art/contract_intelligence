"""Migration runner — DB-free core (R-1 / ADR-0002).

Discover, checksum, plan-pending, and drift detection over
``database/migrations/*.sql``. CLI subcommands that need a live DB raise
``NotImplementedError`` until R-2+.
"""
from __future__ import annotations

import argparse
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "database" / "migrations"

SCHEMA_MIGRATIONS_DDL: str = """\
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text PRIMARY KEY,
    filename    text NOT NULL,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
"""

_FILENAME_RE = re.compile(r"^(\d{3})_.*\.sql$")


@dataclass(frozen=True)
class Migration:
    """One discovered migration file with content checksum."""

    version: str
    filename: str
    checksum: str


def discover_migrations(migrations_dir: Path) -> list[Migration]:
    """Scan ``*.sql`` under ``migrations_dir``; return int-sorted by version.

    Contiguity is not required (e.g. 040–042 gaps are normal). Files whose
    names do not match ``NNN_*.sql`` raise ``ValueError``.
    """
    migrations: list[Migration] = []
    for path in migrations_dir.glob("*.sql"):
        match = _FILENAME_RE.match(path.name)
        if not match:
            raise ValueError(
                f"Migration filename does not match NNN_*.sql pattern: {path.name}"
            )
        version = match.group(1)
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        migrations.append(
            Migration(version=version, filename=path.name, checksum=checksum)
        )
    migrations.sort(key=lambda m: int(m.version))
    return migrations


def plan_pending(
    discovered: list[Migration], applied_versions: set[str]
) -> list[Migration]:
    """Return discovered migrations whose version is not yet applied (order preserved)."""
    return [m for m in discovered if m.version not in applied_versions]


def detect_drift(
    discovered: list[Migration], applied: dict[str, str]
) -> list[str]:
    """Return versions present in both sides whose checksums disagree."""
    by_version = {m.version: m.checksum for m in discovered}
    drifted: list[str] = []
    for version, applied_checksum in applied.items():
        if version in by_version and by_version[version] != applied_checksum:
            drifted.append(version)
    return drifted


def _require_db() -> None:
    raise NotImplementedError(
        "R-2+ gerektirir: DB bağlantısı henüz yok (ADR-0002)"
    )


def main(argv: list[str] | None = None) -> None:
    """Parse CLI; status/up/adopt are stubs until R-2+."""
    parser = argparse.ArgumentParser(
        prog="migrate",
        description="ClauseIQ migration runner (ADR-0002). DB wiring lands in R-2+.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="Show applied vs pending migrations (R-2+).")
    sub.add_parser("up", help="Apply pending migrations (R-2+).")
    sub.add_parser(
        "adopt",
        help="Mark existing migrations applied without running SQL (R-2+).",
    )
    args = parser.parse_args(argv)
    if args.command in ("status", "up", "adopt"):
        _require_db()
    else:
        parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
