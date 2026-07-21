from pydantic import BaseModel, model_validator
from typing import Optional, Literal
from uuid import UUID


# scope values mirror the DB CHECK in migration 037 (rewritten by 043 for
# subject_clause_id): clause_overrides.scope IN ('clause_of_contract',
# 'full_change_order').
OverrideScope = Literal["clause_of_contract", "full_change_order"]


class OverrideCreate(BaseModel):
    # Relationship fields ONLY. Provenance (status / proposed_by / confirmed_by /
    # confirmed_at) is NOT accepted from the client — the router sets it. A user
    # must not be able to forge proposed_by='haiku' or pre-confirm a row.
    overridden_contract: bool = False
    overridden_change_id: Optional[UUID] = None
    scope: OverrideScope
    # Migration 043: free-text clause label replaced by registry FK.
    subject_clause_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _check_target_scope(self):
        # EK-15: mirror clause_overrides_target_scope_ck (037, re-pointed 043)
        # at the edge so an invalid combination is a 422 here, not a DB CHECK
        # 500 later.
        #   * clause_of_contract: targets the contract, NAMES a clause node, no change order
        #   * full_change_order : targets one change order, NAMES no clause, not the contract
        if self.scope == "clause_of_contract":
            if not (self.overridden_contract is True
                    and self.overridden_change_id is None
                    and self.subject_clause_id is not None):
                raise ValueError(
                    "clause_of_contract requires overridden_contract=true, "
                    "overridden_change_id=null, and a non-null subject_clause_id."
                )
        elif self.scope == "full_change_order":
            if not (self.overridden_contract is False
                    and self.overridden_change_id is not None
                    and self.subject_clause_id is None):
                raise ValueError(
                    "full_change_order requires overridden_contract=false, "
                    "a non-null overridden_change_id, and subject_clause_id=null."
                )
        return self
