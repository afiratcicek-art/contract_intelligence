"""Migration runner — DB-free core (R-1) + status (R-2 / ADR-0002).

Discover, checksum, plan-pending, and drift detection over
``database/migrations/*.sql``. ``status`` bootstraps bookkeeping and reports
applied/pending/drift. ``up`` / ``adopt`` land in R-3/R-4.
"""
from __future__ import annotations

import argparse
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from scripts import _db

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


def _cmd_status() -> None:
    """Bootstrap bookkeeping, then print applied / pending / drift summary."""
    with _db.connect() as conn:
        _db.bootstrap(conn)
        applied = _db.fetch_applied(conn)

    discovered = discover_migrations(MIGRATIONS_DIR)
    pending = plan_pending(discovered, set(applied))
    drift = detect_drift(discovered, applied)

    applied_versions = sorted(applied.keys(), key=int)
    pending_versions = [m.version for m in pending]

    print(f"Applied: {len(applied)}" + (
        f" ({', '.join(applied_versions)})" if applied_versions else ""
    ))
    print(f"Pending: {len(pending)}" + (
        f" ({', '.join(pending_versions)})" if pending_versions else ""
    ))
    if drift:
        print(f"UYARI: checksum drift — {', '.join(drift)}")


def main(argv: list[str] | None = None) -> None:
    """Parse CLI; ``status`` is live (R-2); ``up``/``adopt`` wait for R-3/R-4."""
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
    if args.command == "status":
        _cmd_status()
    elif args.command in ("up", "adopt"):
        raise NotImplementedError(
            f"R-{'3' if args.command == 'up' else '4'} gerektirir: "
            f"'{args.command}' henüz yok (ADR-0002)"
        )
    else:
        parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
