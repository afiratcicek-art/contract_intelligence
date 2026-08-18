"""Project Intelligence ask endpoint — grounded Q&A with citations."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.core.dependencies import verify_project_access
from backend.core.limiter import limiter
from backend.models.intelligence import (
    IntelligenceAskRequest,
    IntelligenceAskResponse,
    IntelligenceCitation,
)
from backend.services.claude_service import GateBlockedResult, get_ai_service
from backend.services.intelligence_service import retrieve_keyword_sources

router = APIRouter(prefix="/projects", tags=["intelligence"])


@router.post("/{project_id}/intelligence/ask", response_model=IntelligenceAskResponse)
@limiter.limit("10/minute")
def ask_project_intelligence(
    request: Request,
    project_id: UUID,
    body: IntelligenceAskRequest,
    access: dict = Depends(verify_project_access),
):
    """Keyword-grounded project Q&A. Citations open identity cards in a new tab.

    Retrieval: existing chain search RPCs / title ilike (embeddings remain dormant —
    ADR-0001). Mask → gate → analysis → demask. Citation indices validated
    against the retrieved set only.
    """
    db = access["db"]
    user_id = access["user"]["id"]
    question = (body.question or "").strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question is required.")

    sources = retrieve_keyword_sources(db, str(project_id), question)

    project = (
        db.table("projects")
        .select("name, contract_type")
        .eq("id", str(project_id))
        .single()
        .execute()
    )
    row = project.data or {}
    project_context = {
        "name": row.get("name"),
        "contract_type": row.get("contract_type"),
    }

    history = [
        {"role": m.role, "content": m.content}
        for m in (body.messages or [])
    ]

    ai = get_ai_service(db)
    result = ai.generate_intelligence_answer(
        question=question,
        sources=sources,
        history=history,
        project_context=project_context,
        language=body.language,
        project_id=str(project_id),
        user_id=user_id,
    )

    if isinstance(result, GateBlockedResult):
        raise HTTPException(
            status_code=422,
            detail=result.warning_message,
        )

    citations: list[IntelligenceCitation] = []
    for idx in result.cited_indices:
        src = sources[idx - 1]
        citations.append(
            IntelligenceCitation(
                index=idx,
                entity_type=src["entity_type"],
                entity_id=src["entity_id"],
                ref=src["ref"],
                subject=src["subject"],
                date=src.get("date"),
                status=src.get("status"),
            )
        )

    return IntelligenceAskResponse(
        answer_text=result.answer_text,
        citations=citations,
        confidence_score=result.confidence_score,
        warnings=result.warnings,
        review_required=result.review_required,
        objectivity_flag=result.objectivity_flag,
        retrieval_mode="keyword",
        source_count=len(sources),
    )
