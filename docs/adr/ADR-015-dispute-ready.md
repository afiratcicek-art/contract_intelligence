# ADR-015 — Dispute Ready dossier (deterministic EDOS pack)

**Status:** Accepted (product request; implemented 2026-08-27)
**Date:** 2026-08-27
**Owner:** Ali (product) · Implementation: Cursor
**Phase:** 1 (no LLM)

---

## 1. Problem

A change / hak talebi / kesinti can fall into dispute after evaluation,
submission, rejection, and meeting. Higher management and arbitration need
an EDOS-ready pack: identity, impacts, chronology, and the claim vs employer
positions on each disputed issue — with the related files stored **with**
the report, not as a scavenger hunt across modules.

## 2. Decision

A first-class `disputes` aggregate (legal-effect, same class as amendments):

- **Reads:** any active project member (`verify_project_access`).
- **Writes:** Contract Manager only (`require_cm_role` + RLS `get_project_role = 'cm'`).
- **No** new `project_role_permissions` matrix.
- **No LLM / embeddings / OpenAI** in this slice. `llm_calls.dispute_summary` stays unused.
- Server issues `DSP-NNN` per project. Client does not invent numbers.
- On create: auto-create a chronology `entity_type=dispute`, `entity_id=dispute.id`.
- No hard-delete of the dispute row (forensic). Close via `status=closed`.
- Pack v1 = DOCX built from `Document()` (never ingest user docx), stored on
  Storage, path on `pack_storage_path` / `pack_generated_at`, plus an **exhibit
  index** of related files. Zip-of-PDFs is deferred (TB-59).

## 3. Invariants

1. Cross-project IDs → 404 (`_assert_dispute_in_project`).
2. Nested fetch is one PostgREST select:
   `dispute_impacts(*), dispute_issues(*, dispute_positions(*, dispute_position_refs(*)))`.
3. `chronologies.entity_type` and `pdf_document.entity_type` include `dispute`.
4. `chronology_events.document_ref_type` is **not** extended to `change`
   (032: a Change is a file, not a document). Dispute chronology uses
   correspondence / rfi / manual events + existing `dispute_step`.
5. Position refs are system XOR manual.

## 4. Revisit when

- Zip-of-PDFs / DCC exhibit bundle is required (TB-59).
- LLM dispute summary is explicitly turned on (existing `dispute_summary` call type).
- K9 permission-matrix revisit covers this surface with the rest of the roles.
