from typing import Optional
from uuid import UUID

from backend.models.resolution import (
    AmendmentRef,
    ChangeOrderResolution,
    ClauseResolution,
    ResolutionResponse,
)


# B3 — pure resolution logic (ADR-013 Stage 1 + 043 incorporation). NO DB
# access here: it takes repository result sets and folds them into the in-force
# graph, so it is fully deterministic and unit-testable. The system does NOT
# infer operativeness — only CM-confirmed facts drive the graph (the caller
# passes status='confirmed' overrides / incorporations only; changes.status is
# surfaced raw, never used as a filter).
# Stack: override (supersede) > incorporation (prefer-as-if-in-body) > contract.


def _amendment_ref(embed: dict) -> AmendmentRef:
    return AmendmentRef(
        id=embed["id"],
        amendment_number=embed["amendment_number"],
        amendment_date=embed.get("amendment_date"),
        arrival_path=embed["arrival_path"],
    )


def _winner_key(override: dict):
    # Deterministic tie-break, DESC on (amendment_date, created_at, id). This
    # covers the deliberately-missing unique constraint on
    # clause_overrides(project_id, subject_clause_id) (037 header intent, 043
    # carrier): if two confirmed overrides target the same clause node, the
    # newest amendment wins, then the newest override, then the highest id.
    # None/absent dates sort as "" (earliest, so they lose); ISO date/timestamp
    # strings compare correctly lexicographically, so no parsing is needed.
    amendment = override.get("amendments") or {}
    return (
        amendment.get("amendment_date") or "",
        override.get("created_at") or "",
        str(override.get("id") or ""),
    )


def _inc_winner_key(incorporation: dict):
    return (
        incorporation.get("created_at") or "",
        str(incorporation.get("id") or ""),
    )


def resolve_in_force(
    overrides: list[dict],
    changes: list[dict],
    incorporations: Optional[list[dict]] = None,
    subject_clause_id: Optional[UUID] = None,
) -> ResolutionResponse:
    if incorporations is None:
        incorporations = []

    clause_overrides = [
        o for o in overrides if o.get("scope") == "clause_of_contract"
    ]
    change_overrides = [
        o for o in overrides if o.get("scope") == "full_change_order"
    ]

    # (a) override winners by subject_clause_id — governing_instrument=amendment.
    by_subject: dict[str, list[dict]] = {}
    for o in clause_overrides:
        by_subject.setdefault(str(o["subject_clause_id"]), []).append(o)

    clauses: list[ClauseResolution] = []
    overridden_subjects: set[str] = set()
    for scid, group in by_subject.items():
        winner = max(group, key=_winner_key)
        overridden_subjects.add(scid)
        clauses.append(
            ClauseResolution(
                subject_clause_id=scid,
                governing_instrument="amendment",
                amendment=_amendment_ref(winner["amendments"]),
                override_id=winner["id"],
            )
        )

    # (b) confirmed incorporations whose source subject has NO override.
    # Override wins the stack: that subject keeps only the amendment row.
    by_source: dict[str, list[dict]] = {}
    for inc in incorporations:
        source = inc.get("source_clause") or {}
        sid = str(inc.get("source_clause_id") or source.get("id") or "")
        if not sid or sid in overridden_subjects:
            continue
        by_source.setdefault(sid, []).append(inc)

    for sid, group in by_source.items():
        winner = max(group, key=_inc_winner_key)
        target = winner.get("target_clause") or {}
        clauses.append(
            ClauseResolution(
                subject_clause_id=sid,
                governing_instrument="incorporation",
                incorporation_id=winner["id"],
                target_clause_ref=target.get("clause_ref"),
                target_document_id=target.get("contract_document_id"),
            )
        )

    # full_change_order map: overridden_change_id -> winning override (same
    # tie-break). Used to answer "is this VO superseded by a confirmed amendment?"
    supersede_map: dict[str, dict] = {}
    grouped_by_change: dict[str, list[dict]] = {}
    for o in change_overrides:
        grouped_by_change.setdefault(str(o["overridden_change_id"]), []).append(o)
    for change_id, group in grouped_by_change.items():
        supersede_map[change_id] = max(group, key=_winner_key)

    change_orders: list[ChangeOrderResolution] = []
    for c in changes:
        change_id = str(c["id"])
        winner = supersede_map.get(change_id)
        change_orders.append(
            ChangeOrderResolution(
                change_id=c["id"],
                change_number=c["change_number"],
                title=c["title"],
                status=c["status"],
                superseded_by_amendment=(
                    _amendment_ref(winner["amendments"]) if winner else None
                ),
                # amendment_pending: the VO is 'agreed' by us but no confirmed
                # amendment supersedes it yet (i.e. the paperwork is outstanding).
                amendment_pending=(
                    c["status"] == "agreed" and change_id not in supersede_map
                ),
            )
        )

    # Optional targeted lookup: narrow clauses[] to one subject_clause_id. If
    # that clause has neither override nor incorporation, it resolves to the
    # base contract (kept pure/here so it is exercised by unit tests).
    if subject_clause_id is not None:
        target = str(subject_clause_id)
        matched = [cl for cl in clauses if str(cl.subject_clause_id) == target]
        clauses = matched or [
            ClauseResolution(
                subject_clause_id=subject_clause_id,
                governing_instrument="contract",
            )
        ]

    return ResolutionResponse(clauses=clauses, change_orders=change_orders)
