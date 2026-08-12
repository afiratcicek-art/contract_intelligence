"""Migration runner — R-1 core + R-2 status + R-3 adopt + R-4 up (ADR-0002).

Discover, checksum, plan-pending, and drift detection over
``database/migrations/*.sql``. ``status`` reports applied/pending/drift.
``adopt`` marks existing schemas applied without running SQL.
``up`` applies pending migrations in version order.
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


def plan_adopt(
    discovered: list[Migration], applied: dict[str, str]
) -> tuple[list[Migration], list[str]]:
    """Adopt planı (saf, DB-siz).

    Dönüş: (to_insert, drift_versions)
    - to_insert: applied'da OLMAYAN, INSERT edilecek migration'lar (sıralı).
    - drift_versions: applied'da OLAN ama checksum'u diskle TUTMAYAN version'lar.
    Çağıran: drift_versions boş DEĞİLSE hiçbir şey yazmadan fail-loud.
    """
    drift_versions = detect_drift(discovered, applied)
    to_insert = [m for m in discovered if m.version not in applied]
    return to_insert, drift_versions


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


def _cmd_adopt(assume_yes: bool) -> None:
    """Mark missing versions applied without running migration SQL (R-3)."""
    with _db.connect() as conn:
        _db.bootstrap(conn)
        applied = _db.fetch_applied(conn)
        discovered = discover_migrations(MIGRATIONS_DIR)
        to_insert, drift = plan_adopt(discovered, applied)

        if drift:
            print(
                "HATA: checksum drift — şu version'lar DB'de applied ama dosya "
                f"değişmiş: {', '.join(drift)}. Adopt DURDU, hiçbir şey yazılmadı. "
                "İnsan incelemesi gerekir."
            )
            raise SystemExit(1)

        already_ok = len(discovered) - len(to_insert)
        if not to_insert:
            print(
                "Adopt: eklenecek yeni migration yok "
                "(tümü zaten applied, checksum tutuyor)."
            )
            return

        versions = [m.version for m in to_insert]
        print(
            f"Adopt: şu {len(to_insert)} version ÇALIŞTIRILMADAN applied "
            f"işaretlenecek: {', '.join(versions)}."
        )
        print(
            "Bu, migration SQL'lerini KOŞMAZ; DB'nin bu şemaları GERÇEKTEN "
            "içerdiğini beyan etmiş olursun."
        )
        if not assume_yes:
            answer = input("Devam? [y/N]: ")
            if answer.strip().lower() != "y":
                print("İptal edildi, hiçbir şey yazılmadı.")
                return

        _db.insert_applied(
            conn,
            [(m.version, m.filename, m.checksum) for m in to_insert],
        )
        print(
            f"Adopt tamam: {len(to_insert)} version applied işaretlendi. "
            f"Zaten-vardı: {already_ok} (checksum tuttu)."
        )


def _cmd_up(assume_yes: bool) -> None:
    """Apply pending migrations in version order (R-4).

    Akış: bootstrap → applied oku → discover → apply-öncesi drift-kontrolü
    (fail-loud, hiçbir şey uygulamadan) → plan_pending → onay → her pending için
    disk-oku + apply-anı checksum re-doğrulama (TOCTOU) + _db.apply_migration.
    İlk hatada DURUR ve uygulandı/patladı/koşulmadı özet-raporu basar; kalan
    bekleyenleri KOŞMAZ.

    Atomiklik penceresi (bilinçli): kendi BEGIN;/COMMIT;'ini taşıyan dosya,
    SQL'i bookkeeping'den önce commit eder; o aralıkta süreç ölürse SQL
    uygulanmış ama kaydedilmemiş kalır. KURTARMA: sonraki ``up`` "already exists"
    ile durur → o tek version için ``adopt`` çalıştır → tekrar ``up``. tx-İFADESİZ
    dosyalarda bu pencere YOKTUR (SQL+bookkeeping tek atomik tx). Yeni
    migration'lar BEGIN;/COMMIT; OLMADAN yazılmalı (tx'i runner yönetir) —
    bkz. scripts/README.md.
    """
    with _db.connect() as conn:
        _db.bootstrap(conn)
        applied = _db.fetch_applied(conn)
        discovered = discover_migrations(MIGRATIONS_DIR)

        drift = detect_drift(discovered, applied)
        if drift:
            print(
                "HATA: checksum drift — şu applied version'ların dosyaları "
                f"değişmiş: {', '.join(drift)}. up DURDU, hiçbir şey uygulanmadı. "
                "İnsan incelemesi gerekir."
            )
            raise SystemExit(1)

        pending = plan_pending(discovered, set(applied))
        if not pending:
            print("up: uygulanacak bekleyen migration yok (tümü applied).")
            return

        versions = [m.version for m in pending]
        print(f"up: şu {len(pending)} migration ÇALIŞTIRILACAK: {', '.join(versions)}.")
        print("Bu, migration SQL'lerini GERÇEKTEN koşar ve şemayı değiştirir.")
        if not assume_yes:
            answer = input("Devam? [y/N]: ")
            if answer.strip().lower() != "y":
                print("İptal edildi, hiçbir şey uygulanmadı.")
                return

        done: list[str] = []
        for m in pending:
            remaining = [x.version for x in pending
                         if x.version not in done and x.version != m.version]
            sql_bytes = (MIGRATIONS_DIR / m.filename).read_bytes()
            if hashlib.sha256(sql_bytes).hexdigest() != m.checksum:
                print(
                    f"HATA: {m.filename} discover'dan sonra değişti (checksum "
                    f"uyuşmuyor). up DURDU. Uygulandı: {len(done)} "
                    f"({', '.join(done) or '-'}) | Koşulmadı: {len(remaining) + 1}."
                )
                raise SystemExit(1)
            try:
                _db.apply_migration(
                    conn, m.version, m.filename, m.checksum,
                    sql_bytes.decode("utf-8"),
                )
            except Exception as exc:
                print(
                    f"HATA: {m.filename} uygulanırken patladı: {exc}. up DURDU. "
                    f"Uygulandı: {len(done)} ({', '.join(done) or '-'}) | "
                    f"PATLADI: {m.version} | Koşulmadı: {len(remaining)}. "
                    "NOT: dosya kendi BEGIN;/COMMIT;'ini taşıyorsa SQL commit "
                    "olmuş ama bookkeeping yazılmamış olabilir — DB'yi elle "
                    "incele; SQL gerçekten uygulandıysa `adopt` ile işaretle, "
                    "sonra `up`."
                )
                raise SystemExit(1)
            done.append(m.version)

        print(f"up tamam: {len(done)} migration uygulandı ({', '.join(done)}).")


def main(argv: list[str] | None = None) -> None:
    """Parse CLI; ``status`` (R-2), ``adopt`` (R-3), ``up`` (R-4)."""
    parser = argparse.ArgumentParser(
        prog="migrate",
        description="ClauseIQ migration runner (ADR-0002). DB wiring lands in R-2+.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status", help="Show applied vs pending migrations (R-2+).")
    up_p = sub.add_parser("up", help="Apply pending migrations (R-4).")
    up_p.add_argument("--yes", action="store_true", help="onay sorma; otomasyon için")
    adopt_p = sub.add_parser(
        "adopt",
        help="Mark existing migrations applied without running SQL (R-3).",
    )
    adopt_p.add_argument(
        "--yes",
        action="store_true",
        help="onay sorma; otomasyon için",
    )
    args = parser.parse_args(argv)
    if args.command == "status":
        _cmd_status()
    elif args.command == "adopt":
        _cmd_adopt(assume_yes=args.yes)
    elif args.command == "up":
        _cmd_up(assume_yes=args.yes)
    else:
        parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
