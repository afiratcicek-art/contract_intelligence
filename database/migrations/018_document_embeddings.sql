-- ============================================================
-- Migration 018: Document embeddings + relations
-- Supports semantic search and document relationship detection.
-- pgvector extension required (enabled by default in Supabase).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Enable pgvector extension
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------
-- 2. document_embeddings table
-- Each row = one chunk of a pdf_document.
-- Chunks are ~500-800 tokens with ~10% overlap.
-- doc_date enables supersession detection (newer = higher priority).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_embeddings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_id          UUID NOT NULL REFERENCES pdf_document(id) ON DELETE CASCADE,
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    chunk_index     INTEGER NOT NULL CHECK (chunk_index >= 0),
    chunk_text      TEXT NOT NULL,
    embedding       vector(1536),
    doc_date        DATE,
    doc_type        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE document_embeddings IS
    'Chunked embeddings of uploaded documents for semantic search. '
    'One row per chunk. embedding dimension = 1536 (text-embedding-3-small).';

COMMENT ON COLUMN document_embeddings.chunk_index IS
    'Zero-based chunk position within the source document.';

COMMENT ON COLUMN document_embeddings.doc_date IS
    'Document date — used for supersession detection. '
    'Newer documents take precedence in RAG retrieval.';

-- ------------------------------------------------------------
-- 3. Indexes for document_embeddings
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_doc_embeddings_project
    ON document_embeddings (project_id);

CREATE INDEX IF NOT EXISTS idx_doc_embeddings_doc
    ON document_embeddings (doc_id);

CREATE INDEX IF NOT EXISTS idx_doc_embeddings_entity
    ON document_embeddings (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_doc_embeddings_date
    ON document_embeddings (project_id, doc_date DESC NULLS LAST);

-- Vector similarity index (IVFFlat — fast approximate search)
-- lists=100 is appropriate for up to ~1M vectors.
-- Rebuild with higher lists value at scale.
CREATE INDEX IF NOT EXISTS idx_doc_embeddings_vector
    ON document_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ------------------------------------------------------------
-- 4. RLS for document_embeddings
-- ------------------------------------------------------------
ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY doc_embeddings_tenant_isolation
    ON document_embeddings
    FOR ALL
    USING (
        project_id IN (
            SELECT project_id FROM project_members
            WHERE user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 5. document_relations table
-- Stores detected relationships between documents.
-- score: 0.0-1.0 composite from keyword + semantic similarity.
-- relation_type: detected | user_confirmed | user_rejected
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_relations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_doc_id   UUID NOT NULL REFERENCES pdf_document(id) ON DELETE CASCADE,
    target_doc_id   UUID NOT NULL REFERENCES pdf_document(id) ON DELETE CASCADE,
    score           NUMERIC(4,3) NOT NULL
                    CHECK (score >= 0 AND score <= 1),
    score_breakdown JSONB,
    relation_type   TEXT NOT NULL DEFAULT 'detected'
                    CHECK (relation_type IN (
                        'detected',
                        'user_confirmed',
                        'user_rejected'
                    )),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_doc_id, target_doc_id)
);

COMMENT ON TABLE document_relations IS
    'Detected or user-confirmed relationships between documents. '
    'score = composite of keyword + semantic similarity. '
    'score_breakdown: {"keyword": 0.8, "semantic": 0.6, "date": 0.3}';

COMMENT ON COLUMN document_relations.score IS
    'Composite relevance score 0.0-1.0. '
    'High (>=0.7): keyword + location match. '
    'Medium (0.4-0.7): semantic similarity. '
    'Low (<0.4): weak signal only.';

-- ------------------------------------------------------------
-- 6. Indexes for document_relations
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_doc_relations_project
    ON document_relations (project_id);

CREATE INDEX IF NOT EXISTS idx_doc_relations_source
    ON document_relations (source_doc_id);

CREATE INDEX IF NOT EXISTS idx_doc_relations_score
    ON document_relations (project_id, score DESC);

-- ------------------------------------------------------------
-- 7. RLS for document_relations
-- ------------------------------------------------------------
ALTER TABLE document_relations ENABLE ROW LEVEL SECURITY;

CREATE POLICY doc_relations_tenant_isolation
    ON document_relations
    FOR ALL
    USING (
        project_id IN (
            SELECT project_id FROM project_members
            WHERE user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 8. Extend audit_log.action
-- ------------------------------------------------------------
ALTER TABLE audit_log
    DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log
    ADD CONSTRAINT audit_log_action_check CHECK (action IN (
        'create', 'update', 'delete', 'view',
        'approve', 'reject', 'submit', 'assign',
        'publish', 'export', 'import',
        'login', 'logout', 'permission_change',
        'llm_call',
        'pdf_upload', 'pdf_parse_start',
        'pdf_parse_complete', 'pdf_parse_failed', 'pdf_delete',
        'alert_created', 'alert_action_created',
        'metadata_extraction_start',
        'metadata_extraction_complete',
        'metadata_extraction_failed',
        'metadata_approved',
        'modify', 'inactivate',
        'embedding_created',
        'relation_detected',
        'relation_confirmed',
        'relation_rejected'
    ));
