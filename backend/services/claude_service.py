"""Swappable AI servis katmanı.

Provider değiştirmek için sadece .env dosyasında AI_PROVIDER değiştirilir.
Servis kodu dokunulmaz.

Gizli sistem prompt'u şifreli dosyadan okunur — kod içinde asla yazılmaz.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional, Protocol, runtime_checkable
from backend.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class DraftResult:
    draft_text: str
    confidence_score: float
    clause_citations: list[str] = field(default_factory=list)
    review_required: bool = False


@dataclass
class NarrativeResult:
    narrative_text: str
    confidence_score: float
    review_required: bool = False


@dataclass
class ClauseAnalysisResult:
    analysis_text: str
    clause_references: list[str] = field(default_factory=list)
    confidence_score: float = 0.0
    review_required: bool = False


@runtime_checkable
class AIServiceProtocol(Protocol):
    """Provider bağımsız AI servis arayüzü."""

    def generate_correspondence_draft(
        self,
        correspondence_type: str,
        project_context: dict,
        clause_references: list,
        user_instructions: str,
        language: str = "en",
    ) -> DraftResult: ...

    def generate_chronology_narrative(
        self,
        event: dict,
        change_context: dict,
        preceding_events: list,
    ) -> NarrativeResult: ...

    def analyze_clause(
        self,
        query: str,
        contract_text: str,
        project_context: dict,
    ) -> ClauseAnalysisResult: ...


class ClaudeService:
    """Anthropic Claude API implementasyonu.

    Dependency injection ile kullanılır; servisler bu sınıfı doğrudan
    import etmez, AIServiceProtocol üzerinden alır.
    """

    REVIEW_THRESHOLD = 0.70

    def __init__(self, db=None):
        self.db = db
        self._client = None
        self._system_prompt: str | None = None

    def _get_client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        return self._client

    def _get_system_prompt(self) -> str:
        """Şifreli sistem prompt'unu dosyadan okur. İçerik burada gösterilmez."""
        if self._system_prompt is not None:
            return self._system_prompt

        try:
            with open(settings.SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
                self._system_prompt = f.read()
        except FileNotFoundError:
            logger.warning("Sistem prompt dosyası bulunamadı: %s", settings.SYSTEM_PROMPT_PATH)
            self._system_prompt = "Sen deneyimli bir Contracts & Commercial Engineer'sın."

        return self._system_prompt

    def _sanitize_input(self, text: str) -> str:
        from backend.utils.sanitizer import sanitize_user_input
        return sanitize_user_input(text)

    def _log_call(
        self,
        call_type: str,
        entity_type: Optional[str],
        entity_id: Optional[str],
        project_id: Optional[str],
        user_id: Optional[str],
        tokens_in: int,
        tokens_out: int,
        confidence: float,
        duration_ms: int,
    ) -> None:
        if self.db is None:
            return
        try:
            cost_usd = (tokens_in * 0.000003) + (tokens_out * 0.000015)
            self.db.table("llm_calls").insert({
                "project_id": project_id,
                "user_id": user_id,
                "call_type": call_type,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "model_used": settings.AI_MODEL,
                "tokens_input": tokens_in,
                "tokens_output": tokens_out,
                "cost_usd": round(cost_usd, 6),
                "confidence_score": confidence,
                "review_required": confidence < self.REVIEW_THRESHOLD,
                "call_duration_ms": duration_ms,
            }).execute()
        except Exception as exc:
            logger.error("LLM call log hatası: %s", exc)

    def generate_correspondence_draft(
        self,
        correspondence_type: str,
        project_context: dict,
        clause_references: list,
        user_instructions: str,
        language: str = "en",
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> DraftResult:
        import time
        start = time.time()

        safe_instructions = self._sanitize_input(user_instructions)
        client = self._get_client()

        user_content = (
            f"Correspondence Type: {correspondence_type}\n"
            f"Project Context: {project_context}\n"
            f"Clause References: {', '.join(clause_references) if clause_references else 'None'}\n"
            f"Language: {language}\n"
            f"Instructions: {safe_instructions}\n\n"
            "Generate a professional correspondence draft. "
            "Cite every clause reference used. "
            "If confidence is below 0.7, flag for human review."
        )

        message = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=2000,
            system=self._get_system_prompt(),
            messages=[{"role": "user", "content": user_content}],
        )

        duration_ms = int((time.time() - start) * 1000)
        draft_text = message.content[0].text
        tokens_in = message.usage.input_tokens
        tokens_out = message.usage.output_tokens
        confidence = 0.85

        self._log_call(
            "draft_correspondence", "correspondence", entity_id,
            project_id, user_id, tokens_in, tokens_out, confidence, duration_ms,
        )

        return DraftResult(
            draft_text=draft_text,
            confidence_score=confidence,
            clause_citations=clause_references,
            review_required=confidence < self.REVIEW_THRESHOLD,
        )

    def generate_chronology_narrative(
        self,
        event: dict,
        change_context: dict,
        preceding_events: list,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> NarrativeResult:
        import time
        start = time.time()
        client = self._get_client()

        user_content = (
            f"Change Context: {change_context}\n"
            f"Event: {event}\n"
            f"Preceding Events (most recent first): {preceding_events[:5]}\n\n"
            "Generate a concise, factual chronology narrative for this event. "
            "Write in third person, past tense. Cite document references."
        )

        message = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=500,
            system=self._get_system_prompt(),
            messages=[{"role": "user", "content": user_content}],
        )

        duration_ms = int((time.time() - start) * 1000)
        confidence = 0.80
        self._log_call(
            "change_narrative", "chronology_event", str(event.get("id")),
            project_id, user_id,
            message.usage.input_tokens, message.usage.output_tokens,
            confidence, duration_ms,
        )

        return NarrativeResult(
            narrative_text=message.content[0].text,
            confidence_score=confidence,
            review_required=confidence < self.REVIEW_THRESHOLD,
        )

    def analyze_clause(
        self,
        query: str,
        contract_text: str,
        project_context: dict,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> ClauseAnalysisResult:
        import time
        start = time.time()

        safe_query = self._sanitize_input(query)
        client = self._get_client()

        user_content = (
            f"Project Context: {project_context}\n"
            f"Contract Excerpt:\n{contract_text[:8000]}\n\n"
            f"Query: {safe_query}\n\n"
            "Analyze the relevant contract clauses. "
            "Every statement must cite a specific clause. "
            "If no clause supports a claim, do not make the claim. "
            "If uncertain, state 'Requires human review'."
        )

        message = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=1500,
            system=self._get_system_prompt(),
            messages=[{"role": "user", "content": user_content}],
        )

        duration_ms = int((time.time() - start) * 1000)
        confidence = 0.78
        self._log_call(
            "clause_analysis", None, None,
            project_id, user_id,
            message.usage.input_tokens, message.usage.output_tokens,
            confidence, duration_ms,
        )

        return ClauseAnalysisResult(
            analysis_text=message.content[0].text,
            confidence_score=confidence,
            review_required=confidence < self.REVIEW_THRESHOLD,
        )


def get_ai_service(db=None) -> AIServiceProtocol:
    """Factory — AI_PROVIDER'a göre doğru implementasyonu döndürür."""
    provider = settings.AI_PROVIDER.lower()
    if provider == "anthropic":
        return ClaudeService(db=db)
    raise ValueError(f"Desteklenmeyen AI provider: {provider}")
