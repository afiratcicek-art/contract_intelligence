# ADR-013 — Contract & Amendments Surface: Data Model

**Status:** Proposed (data-model phase; UX follows)
**Date:** 2026-07-17
**Owner:** Ali (product) · Architecture: Claude · Implementation: CursorPro
**Phase:** 1 (core feature — the Dinamik Sözleşme Profili made user-facing)

---

## 1. What this surface is

A single tab that answers one question: **for a given clause, which
instrument is currently in force?**

Three kinds of instrument govern a project's contractual position:

1. the **contract** — globally the base instrument;
2. **change orders** — our own submissions (these live in the Changes module);
3. **amendments** — formal instruments **issued by the employer**. We do not
   author them; we **record** them, exactly as we record correspondence. An
   amendment reaches us as a letter, alongside a change order, or as a standalone
   amending instrument, and we register it into the system after the fact.

The distinction matters for the whole design: an amendment is **inbound
external content we log**, not an internal artifact we compose. It is closer to
a correspondence record than to a change order (which we do author). The form we
build is a *registration* form — the fields describe an instrument that already
exists in the world — not a drafting form.

An amendment does not replace the contract wholesale. It **overrides specific
clauses** and leaves the rest of the contract in force. The surface's job is to
walk that override structure and, for any clause, return the winning instrument
plus the hierarchy that produced it.

This is NOT a filtered view of the `changes` table. The Changes module is a
**working surface** — it holds drafts, unapproved submissions, disputed items.
This surface shows only what is **contractually operative**. The two share a
backend and sit in one tab, split into a *working* view and an *in-force* view,
because the override relation crosses both: an in-force amendment is often born
from a change order still visible on the working side, and the user must be
able to trace that link without leaving the tab.

---

## 2. Override semantics (the crux)

Override is **clause-by-clause**, not document-by-document. Three cases, each
stated by the product owner:

| # | Relationship | Scope |
|---|---|---|
| 1 | amendment → contract | overrides ONLY the clauses it amends; contract stays in force elsewhere |
| 2 | amendment → change order | if the amendment covers the change order, it overrides that submission IN FULL |
| 3 | one amendment → many change orders | one amendment form can cover several change orders at once |

The resolution query — *"for clause X, what is in force?"* — walks the override
graph with the contract at the base and amendments layered on top per clause,
and returns the winning instrument and its provenance.

### Clause identity: start free-text, evolve to semantic

A clause is identified by a **free-text `subject_key`** (e.g. `"Professional
Indemnity Insurance"`). This is deliberately the simplest representation —
identity (i) of three:

- **(i) free-text subject** — where we start. A clause is a string.
- **(ii) controlled vocabulary** — a curated list of clause subjects.
- **(iii) embedding-derived span** — the clause is a semantic region the model
  extracts. This is the destination.

The override **graph structure is identical across (i), (ii), and (iii)**. Only
the definition of a clause changes. So (i) ships now and (iii) is reached later
without restructuring the override tables — the migration path is additive.

> Measured constraint (2026-07-17): today `document_embeddings` chunks are
> fixed-size 600-character windows with no clause boundaries
> (`embedding_service.py:29-32`). They are the wrong unit for (iii). Reaching
> (iii) needs a clause-aware splitter — out of scope for Phase-1 Stage 1, noted
> so nobody assumes the current chunks are clause-addressable.

---

## 3. The HITL principle — machine proposes, human commits

An override is **never** auto-recorded. The naive clause scan (Haiku) may
*propose* an override; it becomes an operative fact only when a user confirms it
through an explicit approval button.

This exact pattern already exists and works, for document metadata
(`017_document_metadata.sql:14-19`): `metadata_source ∈ user|haiku|mixed`,
`metadata_status ∈ pending|processing|done|failed`, plus `metadata_approved_by`
/ `metadata_approved_at`. **The override model mirrors it rather than inventing
a new one** — a handover engineer who understands metadata approval understands
override approval for free.

A `proposed` override renders in the UI as a **warning** ("an amendment may
override the contract here"), never as an in-force fact. Only `confirmed`
overrides count in the resolution walk.

---

## 4. Data model

### 4.1 `amendments` (new table)

The amendment is the one instrument type with no home in the schema today
(`other_amendments_count` is a hard-coded `0`, `documents.py:879`,
`# TB-25: no entity yet`). It is an **employer-issued instrument we register**,
not one we author — the same relationship the system has to correspondence.
Because registering it means capturing structured fields about an external
document (its number, date, how it arrived, and the PDF we file it under), an
amendment is a first-class table, not a `pdf_document.entity_type` value.

This mirrors how `correspondences` works: the correspondence row is our
*record* of an external letter, and the letter's PDF attaches to it. An
amendment row is our record of an external amending instrument, and its PDF
attaches the same way.

```
amendments
  id                 UUID PK
  project_id         UUID NOT NULL → projects(id) ON DELETE CASCADE
  amendment_number   TEXT NOT NULL
  title              TEXT NOT NULL
  amendment_date     DATE
  arrival_path       TEXT NOT NULL CHECK (arrival_path IN
                       ('letter', 'change_order', 'standalone'))
                       -- how the employer's instrument reached us
  source_pdf_id      UUID → pdf_document(id)      -- the employer's document, filed
  source_change_id   UUID → changes(id)           -- if it accompanied a change order
  description        TEXT
  version            INTEGER NOT NULL DEFAULT 1
  is_deleted         BOOLEAN NOT NULL DEFAULT false
  created_by         UUID → profiles(id)          -- the user who REGISTERED it, not an author
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE(project_id, amendment_number)
```

`arrival_path` records the three ways the employer's instrument reaches us: as
a `letter`, alongside a `change_order`, or as a `standalone` amending
instrument. `source_pdf_id` and `source_change_id` are its provenance — which
filed document and (if any) which change order it came with.

### 4.2 `clause_overrides` (new table — the heart)

One row = one assertion that instrument A overrides instrument B, optionally
scoped to a clause. Its status column is the HITL gate.

```
clause_overrides
  id                     UUID PK
  project_id             UUID NOT NULL → projects(id) ON DELETE CASCADE

  overriding_amendment_id UUID NOT NULL → amendments(id) ON DELETE CASCADE

  -- exactly one of the two targets is set (enforced by CHECK):
  overridden_contract    BOOLEAN NOT NULL DEFAULT false   -- true = overrides the project contract
  overridden_change_id   UUID → changes(id)               -- set = overrides this change order

  scope                  TEXT NOT NULL CHECK (scope IN
                           ('clause_of_contract', 'full_change_order'))
  subject_key            TEXT        -- the (i) free-text clause; NULL for full_change_order

  -- HITL provenance, mirrors 017_document_metadata.sql:
  status                 TEXT NOT NULL DEFAULT 'proposed'
                           CHECK (status IN ('proposed', 'confirmed', 'rejected'))
  proposed_by            TEXT NOT NULL CHECK (proposed_by IN ('haiku', 'user'))
  confirmed_by           UUID → profiles(id)
  confirmed_at           TIMESTAMPTZ

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()

  CHECK (
    (overridden_contract = true  AND overridden_change_id IS NULL
                                 AND scope = 'clause_of_contract'
                                 AND subject_key IS NOT NULL)
    OR
    (overridden_contract = false AND overridden_change_id IS NOT NULL
                                 AND scope = 'full_change_order'
                                 AND subject_key IS NULL)
  )
```

The `CHECK` encodes the semantics so the DB refuses a malformed override rather
than trusting the application:

- a **clause-of-contract** override targets the contract, names a clause, and
  never names a change order;
- a **full-change-order** override targets one change order, names no clause,
  and never touches the contract.

### 4.3 How the three cases map

| Product-owner case | Rows |
|---|---|
| amendment overrides contract clause "PII" | 1 row: `overridden_contract=true`, `scope=clause_of_contract`, `subject_key='Professional Indemnity Insurance'` |
| amendment overrides change order in full | 1 row: `overridden_change_id=<id>`, `scope=full_change_order`, `subject_key=NULL` |
| one amendment covers three change orders | 3 rows, one per change order, each `full_change_order` |

### 4.4 The resolution query

*"For clause X, what is in force?"*

```
1. Start with the contract as the base holder of clause X.
2. Find clause_overrides where subject_key = X
     AND overridden_contract = true
     AND status = 'confirmed'          -- proposed/rejected excluded
   ordered by the overriding amendment's amendment_date.
3. The latest confirmed amendment wins for clause X; return it plus the chain
   (contract → amendment) as provenance.
4. Separately, any change order covered by a confirmed full_change_order
   override is shown as superseded by its amendment.
```

`proposed` overrides are fetched separately and shown as warnings, never folded
into the in-force answer.

---

## 5. Staging — Stage 1 ships without Haiku

The Haiku layer is currently **inert**: `extraction_service.py:198-233` is
commented out behind `ANTHROPIC_API_KEY` (`TB-5`). The full scaffolding —
model, prompt, parse, retry, audit, HITL approve flow — exists but returns
`None`. So Haiku cannot propose anything today.

The surface is therefore phased so Stage 1 depends on nothing that is disabled:

### Stage 1 — manual, ships now

- **Register** an employer amendment: fill the registration form (number, date,
  arrival path, the filed PDF) — the same act as logging a correspondence.
- Manually record overrides: user picks the registered amendment, the target
  (contract clause or change order), and for a contract clause types the
  `subject_key`.
- Every manually created override is written directly as `status='confirmed'`,
  `proposed_by='user'` — a user action IS the confirmation.
- The resolution query and the in-force view work fully on `confirmed` rows.

Nothing in Stage 1 calls Haiku. It is a complete, useful surface on its own.

### Stage 2 — Haiku auto-proposal, drops in when TB-5 lands

- Haiku scans a new amendment's text (whole-document, not the 600-char chunks)
  and writes candidate overrides as `status='proposed'`, `proposed_by='haiku'`.
- These appear as warnings; the user's approval button flips a row to
  `confirmed`, a rejection to `rejected`.
- **No Stage-1 table, column, or query changes.** Haiku only inserts `proposed`
  rows into a table Stage 1 already reads. The resolution walk already ignores
  non-`confirmed` rows, so it needs no change either.

### Making Stage 2 "zero-friction to switch on"

So that enabling the API key is the only work Stage 2 requires:

1. **The proposal writer is built in Stage 1, behind the same flag.** A function
   `propose_overrides_for_amendment(amendment_id)` is written and wired to the
   amendment-created event now, but its body early-returns while
   `ANTHROPIC_API_KEY` is unset — identical to how `extraction_service.py`
   already guards itself. When the key lands, the guard passes and proposals
   begin. No new wiring.
2. **The UI renders `proposed` rows in Stage 1 already.** The warning banner and
   the approve/reject buttons are built and shown; with no key there simply are
   no `proposed` rows to show, so the UI is empty of them but ready. When Haiku
   starts writing, they appear with no frontend change.
3. **Reuse `extraction_service`'s exact guard and audit pattern** rather than a
   parallel one, so the single act of configuring the key activates metadata
   extraction (TB-5) and override proposal together, consistently.

The net effect: Stage 2 is "set `ANTHROPIC_API_KEY`, and it works." No schema
migration, no query rewrite, no UI rebuild — only the flag.

---

## 6. Debt this work must clear

**Status-vocabulary reconciliation (blocking the "in force" definition).**
Three vocabularies describe one field today:

- DB `changes.status`: `identified, notified, impact_submitted,
  under_negotiation, agreed, disputed, closed` (`001:187-191`)
- StatsPanel labels: `Approved, Under Review, Disputed`
  (`DocumentStatsPanel.tsx:266-268`) — `approved`/`under_review` are NOT in the
  DB enum; closest are `agreed`/`under_negotiation`
- Workspace chips: `draft, open, under_review, approved, rejected, closed`

"In force" cannot be defined until one correct vocabulary exists. The DB enum is
the source of truth; the two UIs must be reconciled to it (a "change order is
operative when `status = 'agreed'`" rule, most likely). This reconciliation is
part of this surface's work, not a separate task.

---

## 7. Explicitly out of scope for this ADR

- UX layout of the tab (the working/in-force split, the warning banner design).
  Follows once this model is accepted.
- Clause identity (ii) and (iii) — controlled vocabulary and embedding-derived
  spans. The model supports evolving to them; building them is later.
- A clause-aware chunker for `document_embeddings` — prerequisite for (iii) only.
- Re-enabling `ANTHROPIC_API_KEY` itself (TB-5) — a prerequisite for Stage 2,
  tracked separately.

---

## 8. Measurements this ADR rests on (2026-07-17, all verified in code)

- No `contract`/`amendment` table exists; a contract is
  `pdf_document.entity_type='contract_document'` (`006/007/013` CHECK evolution).
- No override semantics exist. `document_relations` (`018:87-104`) is a scored
  doc→doc relevance graph, not override and not clause-scoped.
- The amendment path is a decorative `0` (`documents.py:879`, TB-25).
- Haiku extraction is fully built but disabled behind `ANTHROPIC_API_KEY`
  (`extraction_service.py:198-233`, TB-5) — the HITL approve flow it uses is the
  model this ADR mirrors.
- `document_embeddings` is chunk-granular, fixed 600-char windows
  (`018:18-30`, `embedding_service.py:29-32`) — not clause-aware.
- `changes` has no direct FK to its documents; links are via text refs
  (`change_references`, `001:230-241`) or chronology events
  (`change_event_documents`, `009:7-21`).
