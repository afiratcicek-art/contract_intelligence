"""Document embedding service.

Responsibility:
  1. Chunk extracted text into ~600-char segments (~10% overlap)
  2. Generate embeddings via OpenAI text-embedding-3-small
  3. Bulk insert into document_embeddings table
  4. Trigger relation detection after embedding

Design decisions:
  - Character-based chunking (no tiktoken dependency)
  - Bulk insert — single DB call per document
  - Isolated from extraction_service and pdf_pipeline_service
  - Disabled when OPENAI_API_KEY not configured (like extraction)

Scalability note (TB-12):
  At higher volume, replace BackgroundTasks with Celery + Redis.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from backend.core.config import settings
from backend.database import get_admin_client
from backend.services.audit_service import AuditService

logger = logging.getLogger(__name__)

# Chunk config
_CHUNK_SIZE = 600        # characters per chunk
_CHUNK_OVERLAP = 60      # ~10% overlap
_MIN_CHUNK_SIZE = 50     # skip tiny chunks


class EmbeddingService:
    """Chunks + embeds document text into pgvector.

    Usage (in router as BackgroundTask):
        service = EmbeddingService()
        background_tasks.add_task(
            service.embed_document,
            doc_id=doc_id,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
            user_id=user_id,
            text=extracted_text,
            doc_date=doc_date,
            doc_type=doc_type,
        )
    """

    def __init__(self):
        self._db = get_admin_client()
        self._audit = AuditService()

    def embed_document(
        self,
        doc_id: str,
        project_id: str,
        entity_type: str,
        entity_id: str,
        user_id: str,
        text: str,
        doc_date: Optional[str] = None,
        doc_type: Optional[str] = None,
    ) -> None:
        """Chunk + embed + store. Fire-and-forget background task.

        NOTE: Disabled when OPENAI_API_KEY not configured.
        TB-5: Re-enable when API key is available.
        """
        if not settings.OPENAI_API_KEY:
            logger.info(
                "Embedding skipped — OPENAI_API_KEY not configured. "
                "TB-5: activate when API key available. doc_id=%s", doc_id,
            )
            return

        if not text or len(text.strip()) < _MIN_CHUNK_SIZE:
            logger.info(
                "Embedding skipped — text too short. doc_id=%s", doc_id,
            )
            return

        chunks = self._chunk_text(text)
        if not chunks:
            return

        embeddings = self._embed_chunks(chunks)
        if embeddings is None:
            return

        self._bulk_insert(
            doc_id=doc_id,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
            chunks=chunks,
            embeddings=embeddings,
            doc_date=doc_date,
            doc_type=doc_type,
        )

        self._audit.log(
            action="embedding_created",
            entity_type="pdf_document",
            entity_id=doc_id,
            user_id=user_id,
            project_id=project_id,
            new_value={
                "chunk_count": len(chunks),
                "doc_type": doc_type,
                "doc_date": doc_date,
            },
        )

        logger.info(
            "Embeddings created: %d chunks | doc_id=%s",
            len(chunks), doc_id,
        )

    def _chunk_text(self, text: str) -> list[str]:
        """Character-based chunking with overlap.
        No external dependency — tiktoken not required.
        """
        text = text.strip()
        if not text:
            return []

        chunks = []
        start = 0
        while start < len(text):
            end = start + _CHUNK_SIZE
            chunk = text[start:end].strip()
            if len(chunk) >= _MIN_CHUNK_SIZE:
                chunks.append(chunk)
            start += _CHUNK_SIZE - _CHUNK_OVERLAP

        return chunks

    def _embed_chunks(self, chunks: list[str]) -> Optional[list[list[float]]]:
        """Call OpenAI embeddings API for all chunks at once.
        Single API call — OpenAI supports batch input.
        Returns list of embedding vectors or None on failure.
        """
        try:
            from openai import OpenAI
            client = OpenAI(api_key=settings.OPENAI_API_KEY)
            response = client.embeddings.create(
                model=settings.EMBEDDING_MODEL,
                input=chunks,
            )
            return [item.embedding for item in response.data]
        except Exception as exc:
            logger.error(
                "OpenAI embedding failed: %s | chunks=%d",
                exc, len(chunks),
            )
            return None

    def _bulk_insert(
        self,
        doc_id: str,
        project_id: str,
        entity_type: str,
        entity_id: str,
        chunks: list[str],
        embeddings: list[list[float]],
        doc_date: Optional[str],
        doc_type: Optional[str],
    ) -> None:
        """Single bulk insert for all chunks.
        No N+1 — one DB call per document.
        """
        now = datetime.now(timezone.utc).isoformat()
        records = [
            {
                "project_id": project_id,
                "doc_id": doc_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "chunk_index": idx,
                "chunk_text": chunk,
                "embedding": embedding,
                "doc_date": doc_date,
                "doc_type": doc_type,
                "created_at": now,
            }
            for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]
        try:
            self._db.table("document_embeddings").insert(records).execute()
        except Exception as exc:
            logger.error(
                "Embedding bulk insert failed: %s | doc_id=%s chunks=%d",
                exc, doc_id, len(records),
            )


def get_embedding_service() -> EmbeddingService:
    """Factory function — consistent with get_ai_service pattern."""
    return EmbeddingService()
