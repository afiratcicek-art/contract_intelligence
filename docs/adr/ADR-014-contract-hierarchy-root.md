# ADR-014 — The Base Contract as Hierarchy Root (Document-Centric In-Force)

**Status:** Accepted (decisions locked by product owner 2026-07-20; implemented same day)
**Date:** 2026-07-20
**Owner:** Ali (product) · Architecture: Claude · Implementation: CursorPro
**Phase:** 1 (extends ADR-013's surface; foundation for the future RAG layer)

---

## 1. Problem

ADR-013 delivered the in-force resolution engine (clauses + change orders),
but the **base contract itself had no structured record**. It existed only as
filed PDFs (`pdf_document.entity_type = 'contract_document'`, migration 007):
no parties, no commencement, no duration, no DLP, no precedence among its
constituent documents. Consequences:

1. The In-Force view could not show the contract as the **root** of the
   hierarchy — the thing every amendment and change order derives from.
2. There was no project-wide anchor for the future RAG layer to ground on.
   The product owner's ruling: *"Sözleşmenin proje geneli konumu çok önemli —
   RAG ileride çıkarılacak ve LLM hep buna dayanacak."*

A second, independent correction (2026-07-20): the dashboard must be
**document-centric, not clause-centric** — *"madde madde değil, belge belge."*
Rendering the clause list as the In-Force view's primary content is unreadable
at contract scale. The hierarchy the user sees is a hierarchy of
**documents**: contract (root) → amendments → change orders.

The clause engine (ADR-013's `clauses[]`) is **not discarded**: it remains the
underlying resolution layer, used for targeted lookups and, later, drill-down
and RAG grounding. It is simply no longer the dashboard's primary rendering.

---

## 2. Domain decisions (binding, product owner 2026-07-20)

### 2.1 Cardinality — "model for N, default to 1"

Sales is project-based and the pilot is strictly **1 contract : 1 project**.
But a rigid 1:1 rule breaks when an employer splits works into
phases/packages: related contracts would fall into disconnected projects.

Decision: `contracts` carries `project_id` with **no UNIQUE(project_id)** —
the schema supports 1:N today. The pilot's single-contract rule is enforced
**only at the API layer** (POST returns 409 on a second create). When the
multi-contract case arrives: no migration, only UX. Whether that becomes
"many contracts in one project" or a programme/portfolio layer above projects
is deliberately deferred — the table model leaves both open. → **TB-27**.

### 2.2 Parties — structured

Party = **name + role** (`employer` / `contractor` / `engineer` / `other`),
in `contract_parties`. Not free text. This is the foundation for future
intelligence questions ("who is the Employer; who must this notice be served
on").

### 2.3 Term — three fields, DLP dynamic

`commencement_date` + `duration_days` + `dlp_days`. **DLP is stored as a
LENGTH only, never as dates**: its window derives from ACTUAL completion
(commencement + duration + delays → completion → DLP starts). Late completion
means the DLP starts late; a stored end date would silently go wrong on every
delayed project. Derived-field computation needs actual-completion tracking —
out of scope here, the model just refuses to store what must be derived.

### 2.4 Bespoke precedence

A contract is **composed of documents** (Agreement, LOA, Particular
Conditions, General Conditions, …) with a bespoke order of precedence.
`contract_documents` links the contract to its `pdf_document` rows with
`precedence_rank` (1 = highest, NULL = unranked). This is also what makes the
root card click through to the actual contract PDF.

### 2.5 Access model

Registering the base contract is a **legal-effect decision** — Contract
Manager authority, the same ruling that produced migration 038 for
amendments/overrides. Reads = any active member; writes = CM only, at both
the API (`require_cm_role`) and RLS (`contracts_cm_write`) layers.

---

## 3. Data model (migration 039)

Three tables, 001-family idiom (`uuid_generate_v4()`, `created_by →
profiles(id)`), soft-delete on the aggregate root, RLS on all three
(child tables gate through the parent contract, mirroring
`chronology_events`):

- **`contracts`** — id, project_id (FK, **no unique**), contract_number,
  title, description, commencement_date, duration_days, dlp_days, version,
  is_deleted, created_by, timestamps (+ updated_at trigger).
- **`contract_parties`** — contract_id (CASCADE), role (CHECK), name.
- **`contract_documents`** — contract_id (CASCADE), pdf_document_id
  (CASCADE), label, precedence_rank, UNIQUE(contract_id, pdf_document_id).

No DELETE policies anywhere (forensic-archive principle). Phase-1 therefore
treats parties/documents as **registration-time facts**: `ContractUpdate`
carries scalar fields only.

---

## 4. API

All under the existing `contract` router (`/projects/{project_id}/contract`):

| Method | Path | Gate | Purpose |
|---|---|---|---|
| GET | `/resolution` | member | Extended: now returns `contract` (root) + `amendments[]` + `clauses[]` + `change_orders[]` |
| GET | `` | member | The registered contract (or null) — the project-wide anchor |
| POST | `` | CM | HITL registration; 409 if one exists (TB-27); auto-links the project's filed `contract_document` PDFs as constituent documents (precedence unranked) |
| PUT | `/{contract_id}` | CM | Scalar-field update |

`ResolutionResponse.contract = null` means "not yet registered" — the UI
renders the HITL registration prompt; the system never invents a synthetic
root.

---

## 5. UI (In-Force tab)

Document hierarchy, top to bottom:

1. **Root card — SÖZLEŞME** (heavy accent border): title/number, structured
   parties, term (DLP shown as length + "fiili tamamlanmadan türetilir"),
   constituent documents in precedence order, each clicking through to its
   PDF (`DocumentLink`).
2. **Amendments** — document cards (number, title, date, arrival path, PDF
   link when provenance exists). A registered amendment IS a CM-confirmed
   fact, so all non-deleted amendments appear.
3. **Change orders** — in-force only (agreed/closed), with
   superseded-by-amendment and amendment-pending markers (unchanged from B3).

When no contract is registered, the root slot is occupied by
`ContractSetupForm` — the HITL project-setup step, whose copy tells the user
why this record matters (hierarchy + future RAG anchor).

The flat "Yürürlükteki Maddeler" clause list is removed from the dashboard;
`clauses[]` stays in the payload (engine layer).

---

## 6. Out of scope / deferred

- Multi-contract UX and phased-works grouping → **TB-27**.
- Derived completion / DLP-window computation (needs actual-completion
  tracking).
- Party editing after registration (needs a DELETE/replace story compatible
  with the no-DELETE-policy principle).
- Precedence-rank management UI (ranks are storable today; assignment UX
  later).
- Status-vocabulary unification (still ADR-013 §6).
- Clause drill-down from document cards onto the `clauses[]` engine, and the
  RAG layer itself.
