from typing import Optional

from backend.models.resolution import (
    AmendmentRef,
    ChangeOrderResolution,
    ClauseResolution,
    ResolutionResponse,
)


# B3 — pure resolution logic (ADR-013 Stage 1). NO DB access here: it takes the
# two repository result sets and folds them into the in-force graph, so it is
# fully deterministic and unit-testable. The system does NOT infer operativeness
# — only CM-confirmed facts drive the graph (the caller passes status='confirmed'
# overrides only; changes.status is surfaced raw, never used as a filter).


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
    # clause_overrides(project_id, subject_key) (migration 037 header): if two
    # confirmed overrides target the same clause, the newest amendment wins,
    # then the newest override, then the highest id. None/absent dates sort as ""
    # (earliest, so they lose); ISO date/timestamp strings compare correctly
    # lexicographically, so no parsing is needed.
    amendment = override.get("amendments") or {}
    return (
        amendment.get("amendment_date") or "",
        override.get("created_at") or "",
        str(override.get("id") or ""),
    )


def resolve_in_force(
    overrides: list[dict],
    changes: list[dict],
    subject_key: Optional[str] = None,
) -> ResolutionResponse:
    clause_overrides = [
        o for o in overrides if o.get("scope") == "clause_of_contract"
    ]
    change_overrides = [
        o for o in overrides if o.get("scope") == "full_change_order"
    ]

    # clauses[]: group clause-of-contract overrides by subject_key, one winner
    # each. Only clauses that HAVE an override are enumerated — the contract has
    # no per-clause rows, so a clause with no override is simply absent here.
    by_subject: dict[str, list[dict]] = {}
    for o in clause_overrides:
        by_subject.setdefault(o["subject_key"], []).append(o)

    clauses: list[ClauseResolution] = []
    for sk, group in by_subject.items():
        winner = max(group, key=_winner_key)
        clauses.append(
            ClauseResolution(
                subject_key=sk,
                governing_instrument="amendment",
                amendment=_amendment_ref(winner["amendments"]),
                override_id=winner["id"],
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

    # Optional targeted lookup: narrow clauses[] to one subject_key. If that
    # clause has no override, it resolves to the base contract (kept pure/here so
    # it is exercised by the resolver's own unit tests).
    if subject_key is not None:
        matched = [cl for cl in clauses if cl.subject_key == subject_key]
        clauses = matched or [
            ClauseResolution(
                subject_key=subject_key,
                governing_instrument="contract",
                amendment=None,
                override_id=None,
            )
        ]

    return ResolutionResponse(clauses=clauses, change_orders=change_orders)
