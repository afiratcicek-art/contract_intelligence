"""Contractual Deliverables — C&C obligation register.

Direction derives from contract_parties vs project.contractor_name (F2).
time_status derives from due_date/expiry_date via DeadlineService (no LLM).
Legacy AI-detect / CM-approve / PM-proxy / pre-completion checklist removed
(wrong altitude vs locked model).
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from backend.services.deadline_service import DeadlineService


class DeliverableService:
    def __init__(self, db, audit_service=None):
        self.db = db
        self.audit = audit_service
        self._deadline = DeadlineService()

    # ── direction ──────────────────────────────────────────────────────────

    @staticmethod
    def derive_direction(
        project_contractor_name: Optional[str],
        parties: list[dict],
    ) -> str:
        """Default obligation direction from contract parties.

        If our project contractor appears as *employer* on this contract
        (typical subcontract), counterparty owes us → they_owe.
        Otherwise we owe (main contract / ~99.99% case) → we_owe.
        """
        our = (project_contractor_name or "").strip().lower()
        if not our:
            return "we_owe"
        for p in parties or []:
            name = (p.get("name") or "").strip().lower()
            if name == our and p.get("role") == "employer":
                return "they_owe"
        return "we_owe"

    def resolve_direction(
        self,
        *,
        project_contractor_name: Optional[str],
        parties: list[dict],
        requested: Optional[str],
        override: bool,
    ) -> tuple[str, bool]:
        derived = self.derive_direction(project_contractor_name, parties)
        if override and requested in ("we_owe", "they_owe"):
            return requested, True
        return derived, False

    # ── time status (computed, not stored) ─────────────────────────────────

    def compute_time_status(
        self,
        due_date: Optional[date | str],
        expiry_date: Optional[date | str],
        status: str,
        today: Optional[date] = None,
    ) -> tuple[Optional[str], Optional[int]]:
        """Map nearest relevant date → time_status via DeadlineService urgency.

        Completed / N/A → no time pressure.
        overdue ← KRITIK with days_remaining < 0
        expiring_soon ← UYARI | ACIL
        ok ← NORMAL
        """
        if status in ("completed", "not_applicable"):
            return None, None

        today = today or date.today()
        candidates: list[date] = []
        for raw in (due_date, expiry_date):
            if raw is None:
                continue
            if isinstance(raw, date):
                candidates.append(raw)
            else:
                candidates.append(date.fromisoformat(str(raw)[:10]))
        if not candidates:
            return None, None

        target = min(candidates)
        days_remaining, urgency = self._deadline.check_urgency(target, today=today)
        if days_remaining < 0:
            return "overdue", days_remaining
        if urgency in ("UYARI", "ACIL", "KRITIK"):
            return "expiring_soon", days_remaining
        return "ok", days_remaining

    def enrich(self, row: dict) -> dict:
        """Attach computed time_status/days_remaining; flatten contract title."""
        ts, days = self.compute_time_status(
            row.get("due_date"),
            row.get("expiry_date"),
            row.get("status") or "open",
        )
        row["time_status"] = ts
        row["days_remaining"] = days
        contract = row.pop("contracts", None)
        if isinstance(contract, dict):
            row["contract_title"] = contract.get("title")
        return row

    def get_project_contractor_name(self, project_id: str) -> Optional[str]:
        result = (
            self.db.table("projects")
            .select("contractor_name")
            .eq("id", project_id)
            .maybe_single()
            .execute()
        )
        if not result.data:
            return None
        return result.data.get("contractor_name")

    def resolve_country_code(self, project_id: str) -> str:
        """Prefer calendar_config country; default SA (GCC pilot)."""
        result = (
            self.db.table("calendar_config")
            .select("country_code")
            .eq("project_id", project_id)
            .order("year", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if rows and rows[0].get("country_code"):
            return str(rows[0]["country_code"]).upper()
        return "SA"

    def build_suggestions(
        self,
        project_id: str,
        existing_titles: list[str],
    ) -> dict:
        """Library + blind-spot nudges. LLM contract scan is NOT wired yet."""
        from backend.data.deliverable_library import library_for_country

        country = self.resolve_country_code(project_id)
        existing_norm = {t.strip().lower() for t in existing_titles if t}
        suggestions = []
        nudges = []
        for item in library_for_country(country):
            present = item["title"].strip().lower() in existing_norm
            row = {
                "key": item["key"],
                "title": item["title"],
                "category": item["category"],
                "kind": item["kind"],
                "cadence": item["cadence"],
                "source": item["source"],
                "source_ref_hint": item.get("source_ref_hint"),
                "already_present": present,
                "conditional": bool(item.get("conditional")),
                "origin": "library",
            }
            suggestions.append(row)
            if item.get("blind_spot") and item.get("nudge") and not present:
                nudges.append(
                    {
                        "key": item["key"],
                        "nudge": item["nudge"],
                        "category": item["category"],
                    }
                )
        return {
            "country_code": country,
            "suggestions": suggestions,
            "blind_spot_nudges": nudges,
            # Honest capability flag — UI must not imply LLM scan is live.
            "contract_scan_available": False,
            "source": "library",
        }

    def instantiate_from_library(
        self,
        *,
        project_id: str,
        contract_id: str,
        keys: list[str],
        user_id: str,
        parties: list[dict],
        contractor_name: Optional[str],
    ) -> list[dict]:
        from backend.data.deliverable_library import library_for_country

        country = self.resolve_country_code(project_id)
        by_key = {i["key"]: i for i in library_for_country(country)}
        direction, _ = self.resolve_direction(
            project_contractor_name=contractor_name,
            parties=parties,
            requested=None,
            override=False,
        )
        rows: list[dict] = []
        for key in keys:
            item = by_key.get(key)
            if not item:
                continue
            rows.append(
                {
                    "project_id": project_id,
                    "contract_id": contract_id,
                    "title": item["title"],
                    "category": item["category"],
                    "kind": item["kind"],
                    "cadence": item["cadence"],
                    "source": item["source"],
                    "source_ref": item.get("source_ref_hint"),
                    "direction": direction,
                    "direction_override": False,
                    "status": "open",
                    "pending_detail": True,  # library accept = draft until user Saves
                    "entry_source": "library",
                    "created_by": user_id,
                }
            )
        if not rows:
            return []
        # Single multi-row insert (no unique on library keys) — was N round-trips.
        result = self.db.table("deliverables").insert(rows).execute()
        return [self.enrich(r) for r in (result.data or [])]
