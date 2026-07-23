# Migration ledger — authoritative table map

**Rule:** every new migration that creates or alters a table MUST update this index
in the same change. Answer “what is the current shape of table X, and where?”
from this file alone.

Format: `table | authoritative migration(s) | one-line history`

---

## Core / tenancy

| table | authoritative migration(s) | history |
|---|---|---|
| profiles | 001 | created 001 |
| projects | 001 | created 001 (`contract_type` TEXT lives here; dual-source with `contracts.contract_type` → TB-28) |
| project_members | 001 | created 001; RLS 002 |
| project_parties | 001 | created 001; RLS 002 |
| project_role_permissions | 001 → 004 | created 001; entity_type check extended 004 |
| project_config | 001 | created 001; RLS 002 |
| calendar_config | 001 | created 001; RLS 002 |

## Domain entities

| table | authoritative migration(s) | history |
|---|---|---|
| rfis | 001 → 008 → 010 → 020 → 024 → 025 → 028 → 029 → 030 | created 001; version/RLS 008; chain 010; search_vector 020/025; keywords 024; draft status 028; entry_mode 029; approve permission seed 030 |
| changes | 001 | created 001; indexes 003; RLS 002 |
| change_references | 001 | created 001; RLS 002 |
| change_event_documents | 009 | created 009 |
| correspondences | 001 → 020 → 024 → 025 → **044** | created 001; search_vector 020/025; keywords 024; **entry_mode (nullable) 044** |
| correspondence_references | 001 → 032 → 033 → 034 → 035 | created 001; type alignment 032; document link 033; doc type 034; ref_role 035 |
| correspondence_drafts | 001 → 005 | created 001; gate fields 005 |
| correspondence_documents | 001 | created 001; RLS 002 |
| correspondence_change_links | 001 | created 001; RLS 002 |
| rfi_references | 027 → 032 → 033 → 034 → 035 | created 027; type alignment 032; document link 033; doc type 034; ref_role 035 |
| chronologies | 001 | created 001; RLS 002 |
| chronology_events | 001 → 015 → 016 → 032 | created 001; event types 015; subject 016; type alignment 032 |
| deliverables | 001 → 008 | created 001; version/RLS tweaks 008 |
| deliverable_documents | 001 | created 001; RLS 002 |

## Contract & amendments (hierarchy root)

| table | authoritative migration(s) | history |
|---|---|---|
| amendments | 037 → 038 | created 037; write gate tightened to CM-only 038 |
| clause_overrides | 037 → 038 → **043** | created 037; CM-only write 038; **043 re-points `subject_key` TEXT → `subject_clause_id` UUID FK `contract_clauses` (empty-table only)** |
| **contract_clauses** | **043** | **created 043 — canonical clause/section nodes (contract_documents XOR amendments); HITL find-or-create** |
| **clause_incorporations** | **043** | **created 043 — incorporation-by-reference edges (prefer target as if in body); HITL; ≠ override** |
| **contracts** | **039** | **created 039 (authoritative; consolidates former 040/041/042 — contract_type, nullable doc FK, CM delete on links — into one file)** |
| **contract_parties** | **039** | **created 039** |
| **contract_documents** | **039** | **created 039 (nullable `pdf_document_id` + ON DELETE SET NULL; CM DELETE of link only)** |

## Documents / PDF pipeline

| table | authoritative migration(s) | history |
|---|---|---|
| pdf_document | 006 → 007 → 013 → 017 → 019 → 020 → 036 | created 006; `contract_document` entity_type 007; `internal_alert` entity_type 013; metadata cols 017; doc_type 019; search_vector 020; **RLS source of truth 036** (supersedes 006/008 policies) |
| document_embeddings | 018 | created 018 |
| document_relations | 018 | created 018 |

## Document authoring (writing module)

| table | authoritative migration(s) | history |
|---|---|---|
| **document_templates** | **044** | **created 044 — project-scoped letterhead/field config; one active per (project, doc_type)** |
| **document_drafts** | **044** | **created 044 — authored drafts + optimistic `version`; materializes to rfi/correspondence** |
| **document_draft_versions** | **044** | **created 044 — meaningful-moment snapshots (manual/pre/post_generation/approval)** |
| **document_provenance** | **044** | **created 044 — event+attribution only (never content); server-written** |

## Alerts

| table | authoritative migration(s) | history |
|---|---|---|
| project_notice_config | 011 | created 011 |
| internal_alerts | 011 → 012 → 013 | created 011; columns 012; action linkage 013 |
| alert_actions | 013 | created 013 |
| alert_documents | 013 | created 013 |
| alert_reads | 014 | created 014 |

## Stats / cache / audit / LLM

| table | authoritative migration(s) | history |
|---|---|---|
| project_document_stats | 026 | created 026 |
| project_keyword_stats | 026 | created 026 |
| project_location_stats | 026 | created 026 |
| simple_lookup_cache | 005 | created 005 |
| audit_log | 001 → 005 → 006 → 008 → 011 → 013 → 014 → 017 → 018 → 031 | created 001; action-check expansions across listed migrations |
| llm_calls | 001 → 005 → 006 → 017 | created 001; call-type expansions 005/006/017 |

## Cross-cutting (not tables)

| artifact | authoritative migration(s) | history |
|---|---|---|
| RLS helpers (`is_project_member`, `get_project_role`) | 002 | defined 002; used by later table policies |
| indexes (001-family) | 003 | bulk indexes after 001/002 |
| default role permissions seed | 004 | seeds `project_role_permissions` |
| search / chain RPCs | 020 → 021 → 022 → 023 | FTS helpers 020; chain search 021/022; similar-docs 023 |
| pdf_document RLS rewrite | 036 | current policy names/source of truth for `pdf_document` |

---

*Last updated with 044 (document authoring: templates/drafts/versions/provenance; correspondences.entry_mode).*
