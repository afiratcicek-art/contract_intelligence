"""Deterministic, LLM-free identity masking for outbound AI prompts.

Request-scoped only: MaskSession holds the real↔token map in memory.
Never write the map to storage (SELECT-only provider; no writes).

STOPGAP (TB-41): masking here is DETERMINISTIC exact-match only. It cannot catch typos,
abbreviations, OCR-variants, or unregistered party names — those reach the provider
UNMASKED and has_leak() will not flag them (has_leak only knows registry names). Known
recall limitation, not a bug. TARGET is a hybrid: a LOCAL NER/LLM detector fronts this
module to find identity spans regardless of spelling, feeding this same deterministic token
backbone (assignment + bijection + de-mask unchanged). The mask model MUST be local — a
cloud model would send raw text out to mask it, defeating the purpose (S-H4). No local model
exists yet (Faz-3); deterministic is the accepted stopgap.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

_ROLE_TOKENS = {
    "employer": "⟦EMPLOYER⟧",
    "contractor": "⟦CONTRACTOR⟧",
    "engineer": "⟦ENGINEER⟧",
}
_PROJECT_TOKEN = "⟦PROJECT⟧"
_MIN_IDENTITY_LEN = 2


def _normalize(name: str) -> str:
    return name.strip().casefold()


def _usable(name: Any) -> bool:
    if name is None:
        return False
    if not isinstance(name, str):
        return False
    stripped = name.strip()
    return len(stripped) >= _MIN_IDENTITY_LEN


@dataclass(frozen=True)
class MaskSession:
    """real identity string → ⟦TOKEN⟧ and reverse; identities sorted long→short."""

    _mask_pairs: tuple[tuple[str, str], ...]  # (identity, token), long→short
    _demask_pairs: tuple[tuple[str, str], ...]  # (token, identity), long→short

    @classmethod
    def from_identity_map(cls, identity_to_token: dict[str, str]) -> MaskSession:
        mask_pairs = tuple(
            sorted(
                identity_to_token.items(),
                key=lambda kv: len(kv[0]),
                reverse=True,
            )
        )
        demask_pairs = tuple(
            sorted(
                ((token, identity) for identity, token in identity_to_token.items()),
                key=lambda kv: len(kv[0]),
                reverse=True,
            )
        )
        return cls(_mask_pairs=mask_pairs, _demask_pairs=demask_pairs)

    def mask(self, text: str) -> str:
        """Replace known identities with tokens (case-insensitive, whole-word, long first)."""
        if not text or not self._mask_pairs:
            return text
        out = text
        for identity, token in self._mask_pairs:
            pattern = re.compile(
                rf"\b{re.escape(identity)}\b",
                re.IGNORECASE,
            )
            out = pattern.sub(token, out)
        return out

    def mask_context(self, ctx: dict) -> dict:
        """Recursively mask all str values in a dict (and list/tuple children)."""
        return self._mask_value(ctx)  # type: ignore[return-value]

    def _mask_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.mask(value)
        if isinstance(value, dict):
            return {k: self._mask_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._mask_value(v) for v in value]
        if isinstance(value, tuple):
            return tuple(self._mask_value(v) for v in value)
        return value

    def demask(self, text: str) -> str:
        """⟦TOKEN⟧ → real identity (exact, case-sensitive)."""
        if not text or not self._demask_pairs:
            return text
        out = text
        for token, identity in self._demask_pairs:
            out = out.replace(token, identity)
        return out

    def has_leak(self, text: str) -> bool:
        """True if any known raw identity still appears (whole-word, case-insensitive)."""
        # NOTE (TB-41): detects ONLY registry identities. A typo/variant/unregistered name
        # is invisible here — that recall gap is closed by the future local-NER front-end.
        if not text or not self._mask_pairs:
            return False
        for identity, _token in self._mask_pairs:
            if re.search(rf"\b{re.escape(identity)}\b", text, re.IGNORECASE):
                return True
        return False


class MaskingProvider:
    """Builds a request-scoped MaskSession from project identity sources (SELECT only)."""

    def __init__(self, db):
        self.db = db

    def build(self, project_id: str) -> MaskSession | None:
        """Collect identities from projects, contract_parties, project_parties.

        Returns None when the primary source (projects row) is missing or the
        resulting registry is empty — caller must fail-closed.
        """
        # identity_key (normalized) → (display_name, token)
        by_norm: dict[str, tuple[str, str]] = {}
        # role → token already claimed by a display name
        role_claimed: dict[str, str] = {}
        party_names: list[str] = []

        project = self._load_project(project_id)
        if project is None:
            return None

        self._register_role(
            by_norm, role_claimed, project.get("employer_name"), "employer"
        )
        self._register_role(
            by_norm, role_claimed, project.get("contractor_name"), "contractor"
        )
        self._register_role(
            by_norm, role_claimed, project.get("engineer_name"), "engineer"
        )
        if _usable(project.get("name")):
            display = project["name"].strip()
            norm = _normalize(display)
            if norm not in by_norm:
                by_norm[norm] = (display, _PROJECT_TOKEN)

        for role, name in self._load_contract_parties(project_id):
            if not _usable(name):
                continue
            display = name.strip()
            norm = _normalize(display)
            if norm in by_norm:
                continue  # dedup (role, normalized-name) / any prior identity
            if role in _ROLE_TOKENS:
                token = _ROLE_TOKENS[role]
                if role in role_claimed and role_claimed[role] != norm:
                    # Same role, different name → keep bijection via PARTY_n
                    party_names.append(display)
                else:
                    by_norm[norm] = (display, token)
                    role_claimed[role] = norm
            else:
                # role == 'other' (or unknown)
                party_names.append(display)

        for name in self._load_project_parties(project_id):
            if not _usable(name):
                continue
            display = name.strip()
            norm = _normalize(display)
            if norm in by_norm:
                continue
            party_names.append(display)

        # ⟦PARTY_n⟧ index deterministic: sort by normalized name
        unique_parties: list[str] = []
        seen_party: set[str] = set()
        for display in sorted(party_names, key=_normalize):
            norm = _normalize(display)
            if norm in by_norm or norm in seen_party:
                continue
            seen_party.add(norm)
            unique_parties.append(display)

        for i, display in enumerate(unique_parties, start=1):
            by_norm[_normalize(display)] = (display, f"⟦PARTY_{i}⟧")

        identity_to_token = {display: token for display, token in by_norm.values()}
        if not identity_to_token:
            return None
        return MaskSession.from_identity_map(identity_to_token)

    def _register_role(
        self,
        by_norm: dict[str, tuple[str, str]],
        role_claimed: dict[str, str],
        name: Any,
        role: str,
    ) -> None:
        if not _usable(name):
            return
        display = name.strip()
        norm = _normalize(display)
        if norm in by_norm:
            return
        token = _ROLE_TOKENS[role]
        by_norm[norm] = (display, token)
        role_claimed[role] = norm

    def _load_project(self, project_id: str) -> dict | None:
        try:
            result = (
                self.db.table("projects")
                .select("name, employer_name, contractor_name, engineer_name")
                .eq("id", project_id)
                .limit(1)
                .execute()
            )
            rows = result.data or []
            return rows[0] if rows else None
        except Exception as exc:  # noqa: BLE001
            logger.warning("masking: projects read failed: %s", exc)
            return None

    def _load_contract_parties(self, project_id: str) -> list[tuple[str, str]]:
        """Return list of (role, name) for all contracts on the project."""
        try:
            contracts = (
                self.db.table("contracts")
                .select("id")
                .eq("project_id", project_id)
                .eq("is_deleted", False)
                .execute()
            )
            ids = [row["id"] for row in (contracts.data or []) if row.get("id")]
            if not ids:
                return []
            parties = (
                self.db.table("contract_parties")
                .select("role, name")
                .in_("contract_id", ids)
                .execute()
            )
            out: list[tuple[str, str]] = []
            for row in parties.data or []:
                role = (row.get("role") or "").strip()
                name = row.get("name")
                if role and name:
                    out.append((role, name))
            return out
        except Exception as exc:  # noqa: BLE001
            logger.warning("masking: contract_parties read failed: %s", exc)
            return []

    def _load_project_parties(self, project_id: str) -> list[str]:
        try:
            result = (
                self.db.table("project_parties")
                .select("party_name")
                .eq("project_id", project_id)
                .eq("is_active", True)
                .execute()
            )
            return [
                row["party_name"]
                for row in (result.data or [])
                if row.get("party_name")
            ]
        except Exception as exc:  # noqa: BLE001
            logger.warning("masking: project_parties read failed: %s", exc)
            return []
