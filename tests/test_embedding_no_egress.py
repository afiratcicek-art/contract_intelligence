"""Regression net: the embedding channel must not egress to OpenAI.

Guards the S-H4 second arm. Slice X removed the OpenAI embedding path;
these tests FAIL if it is reintroduced. embed_document is a no-op until
the local backend (ADR-0001, Slice Y).
"""

import sys
from pathlib import Path

import backend.services.embedding_service as embedding_module
from backend.services.embedding_service import get_embedding_service

_SERVICE_SRC = Path(embedding_module.__file__).read_text(encoding="utf-8")


def test_no_openai_import_in_source():
    assert "import openai" not in _SERVICE_SRC
    assert "from openai" not in _SERVICE_SRC


def test_no_embeddings_create_call_in_source():
    assert "embeddings.create" not in _SERVICE_SRC


def test_embed_document_is_noop_without_openai(monkeypatch):
    # Any attempt to import openai in the embed path makes this fail loudly.
    monkeypatch.setitem(sys.modules, "openai", None)
    result = get_embedding_service().embed_document(
        doc_id="doc-1",
        project_id="proj-1",
        entity_type="pdf_document",
        entity_id="ent-1",
        user_id="user-1",
        text="x" * 200,
    )
    assert result is None
