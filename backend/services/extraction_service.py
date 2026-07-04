"""Haiku metadata extraction service.

Responsibility: extract keyword, location, doc_date,
doc_type from document text using Haiku.

Design decisions:
- Runs as FastAPI BackgroundTask after upload.
- 3x retry with exponential backoff.
- metadata_status lifecycle: pending → processing → done | failed.
- User-supplied values always take precedence over Haiku output.
- No Sonnet calls — Haiku only, focused extraction prompt.
- HITL: extracted values stored as draft, user approves via
  PATCH /documents/{doc_id}/metadata/approve endpoint.
- Isolated from pdf_pipeline_service — no LLM there.

Scalability note (TB-12):
  At higher volume, replace BackgroundTasks with Celery + Redis.
  Extraction logic is self-contained here — migration cost is low.
"""

import json
import logging
# import time  # TB-5: re-enable with _run_with_retry
from datetime import datetime, timezone
from typing import Optional

import anthropic

from backend.core.sanitizer import sanitize_contract_text, sanitize_medium, sanitize_short
from backend.database import get_admin_client
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

# Max chars of extracted text sent to Haiku
# First ~3000 chars typically contain metadata
_TEXT_LIMIT = 3000

# Retry config
_MAX_RETRIES = 3
# _RETRY_BASE_DELAY used in _run_with_retry — see TB-5
_RETRY_BASE_DELAY = 2  # seconds, exponential backoff

# Haiku model
_HAIKU_MODEL = "claude-haiku-4-5-20251001"

_EXTRACTION_SYSTEM_PROMPT = """You are a metadata extraction assistant for
construction project documents in GCC (Gulf Cooperation Council) projects.

Extract the following fields from the document text provided.
Return ONLY valid JSON — no preamble, no explanation, no markdown.

Fields to extract:
- keywords: list of up to 10 specific technical terms, document references,
  or project identifiers (e.g. zone names, RFI numbers, clause references).
  Maximum 10 items. Each item max 50 characters.
- location: specific site location or zone mentioned (e.g. "Grid Zone 4A",
  "Level 3 Podium", "Block C"). Single string or null if not found.
- doc_date: document date in ISO format YYYY-MM-DD, or null if not found.
- doc_type: one of: correspondence | rfi | notice | variation | instruction |
  claim | programme | minutes | daily_report | permit | other.

Rules:
- Extract only what is explicitly stated — do not infer or hallucinate.
- If a field cannot be determined, use null (not empty string).
- keywords must be specific identifiers, not generic words like "project".
- Return exactly this JSON structure:
{
  "keywords": ["...", "..."],
  "location": "..." or null,
  "doc_date": "YYYY-MM-DD" or null,
  "doc_type": "..." or null
}"""


class ExtractionService:
    """Haiku metadata extraction for uploaded documents.

    Usage (in router as BackgroundTask):
        service = ExtractionService()
        background_tasks.add_task(
            service.extract,
            doc_id=doc_id,
            project_id=project_id,
            user_id=user_id,
            text=extracted_text,
            user_keywords=user_keywords,
            user_location=user_location,
        )
    """

    def __init__(self):
        self._db = get_admin_client()
        self._audit = AuditService()
        self._client = anthropic.Anthropic()

    def extract(
        self,
        doc_id: str,
        project_id: str,
        user_id: str,
        text: str,
        user_keywords: Optional[list[str]] = None,
        user_location: Optional[str] = None,
        user_doc_date: Optional[str] = None,
    ) -> None:
        """Run Haiku extraction as a background task.

        User-supplied values take precedence over Haiku output.
        Stores draft result — user approves via PATCH endpoint.
        Updates metadata_status throughout lifecycle.
        """
        self._set_status(doc_id, "processing")
        self._audit.log(
            action="metadata_extraction_start",
            entity_type="pdf_document",
            entity_id=doc_id,
            user_id=user_id,
            project_id=project_id,
        )

        result = self._run_with_retry(text)

        # User-supplied metadata must persist regardless of Haiku
        # outcome. Haiku failure should not discard what the user
        # already typed in the upload form.
        has_user_input = bool(user_keywords or user_location or user_doc_date)

        if result is None and not has_user_input:
            # Nothing to write — neither Haiku nor user gave data
            self._set_status(doc_id, "failed")
            self._audit.log(
                action="metadata_extraction_failed",
                entity_type="pdf_document",
                entity_id=doc_id,
                user_id=user_id,
                project_id=project_id,
                note="All retries exhausted, no user input to fall back on",
            )
            return

        # Merge: user input takes precedence over Haiku
        # If Haiku failed (result is None), fall back to user
        # input only — empty dict has no keys, so .get() is safe.
        haiku_data = result or {}
        final_keywords = user_keywords if user_keywords else haiku_data.get("keywords") or []
        final_location = user_location if user_location else haiku_data.get("location")
        final_doc_date = user_doc_date if user_doc_date else haiku_data.get("doc_date")

        # Sanitize Haiku output (user input already sanitized at model level)
        final_keywords = [
            sanitize_short(str(k)) for k in final_keywords if k
        ][:20]
        if final_location:
            final_location = sanitize_medium(str(final_location))

        # Determine metadata source
        if user_keywords or user_location or user_doc_date:
            source = "mixed" if result else "user"
        else:
            source = "haiku"

        update_data = {
            "keywords": final_keywords,
            "location": final_location,
            "doc_date": final_doc_date,
            "metadata_status": "done",
            "metadata_source": source,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            self._db.table("pdf_document") \
                .update(update_data) \
                .eq("id", doc_id) \
                .execute()
        except Exception as exc:
            logger.error(
                "Extraction DB write failed: %s | doc_id=%s", exc, doc_id
            )
            self._set_status(doc_id, "failed")
            return

        self._audit.log(
            action="metadata_extraction_complete",
            entity_type="pdf_document",
            entity_id=doc_id,
            user_id=user_id,
            project_id=project_id,
            new_value={
                "keywords": final_keywords,
                "location": final_location,
                "doc_date": final_doc_date,
                "source": source,
            },
        )

    def _run_with_retry(self, text: str) -> Optional[dict]:
        """Call Haiku with 3x retry + exponential backoff.
        Returns parsed JSON dict or None on total failure.

        NOTE: Disabled until ANTHROPIC_API_KEY is configured.
        TB-5: Re-enable when API key is available.
        Uncomment the implementation block below to activate.
        """
        # TODO (TB-5): Uncomment when ANTHROPIC_API_KEY configured
        # safe_text = sanitize_contract_text(text)  # TD-003: strip injection patterns
        # truncated = safe_text[:_TEXT_LIMIT]
        # for attempt in range(1, _MAX_RETRIES + 1):
        #     try:
        #         response = self._client.messages.create(
        #             model=_HAIKU_MODEL,
        #             max_tokens=400,
        #             system=_EXTRACTION_SYSTEM_PROMPT,
        #             messages=[{
        #                 "role": "user",
        #                 "content": f"Extract metadata from this document:\n\n{truncated}",
        #             }],
        #         )
        #         raw = response.content[0].text.strip()
        #         return self._parse_response(raw)
        #     except Exception as exc:
        #         logger.warning(
        #             "Haiku extraction attempt %d/%d failed: %s | ",
        #             attempt, _MAX_RETRIES, exc,
        #         )
        #         if attempt < _MAX_RETRIES:
        #             time.sleep(_RETRY_BASE_DELAY ** attempt)
        # return None
        logger.info(
            "Extraction skipped — ANTHROPIC_API_KEY not configured. "
            "TB-5: activate when API key available.",
        )
        return None

    def _parse_response(self, raw: str) -> Optional[dict]:
        """Parse and validate Haiku JSON response."""
        try:
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            data = json.loads(raw.strip())
            # Validate structure
            if not isinstance(data, dict):
                return None
            return {
                "keywords": data.get("keywords") or [],
                "location": data.get("location"),
                "doc_date": data.get("doc_date"),
                "doc_type": data.get("doc_type"),
            }
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            logger.warning("Haiku response parse failed: %s", exc)
            return None

    def _set_status(self, doc_id: str, status: str) -> None:
        """Update metadata_status — fire and forget."""
        try:
            self._db.table("pdf_document") \
                .update({
                    "metadata_status": status,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }) \
                .eq("id", doc_id) \
                .execute()
        except Exception as exc:
            logger.error(
                "metadata_status update failed: %s | doc_id=%s status=%s",
                exc, doc_id, status,
            )


def get_extraction_service() -> ExtractionService:
    """Factory function — consistent with get_ai_service pattern."""
    return ExtractionService()
