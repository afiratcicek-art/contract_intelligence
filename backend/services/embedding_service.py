"""Document embedding service.

STATUS: DISABLED — pending local embedding backend (ADR-0001, Slice Y).

The OpenAI embedding egress path has been REMOVED for data residency
(S-H4): contract text is crown-jewel data and must not leave the Kingdom.
Until the local fastembed / multilingual-e5-large backend lands (Slice Y),
embed_document is a documented no-op.

Semantic search is not yet live (greenfield), so producing no vectors has
no user-facing effect today. Slice Y re-fills embed_document with an
in-process, zero-egress path (document_embeddings, see migration 018).
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Embeds document text into pgvector.

    DISABLED until the local backend (ADR-0001, Slice Y). The public entry
    point is a no-op; its signature is preserved so the pdf_pipeline caller
    needs no change now or in Slice Y.
    """

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
        """No-op. Embedding disabled pending the local backend.

        No external call is made under ANY configuration: the OpenAI egress
        path was removed for residency (S-H4). Re-enabled locally in Slice Y.
        """
        logger.info(
            "Embedding skipped — disabled pending local backend "
            "(ADR-0001, Slice Y); OpenAI egress removed (S-H4). doc_id=%s",
            doc_id,
        )
        return


_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    """Lazy process-lifetime singleton (ADR-0001 invariant-2)."""
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service
