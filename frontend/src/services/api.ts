import type { AlertItem, AlertAction, AlertDocument } from "../types/alerts";
import type { Chronology, ChronologyEvent } from "../types/chronology";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

// ── In-memory GET cache ──────────────────────────────────────────────────
interface CacheEntry<T> { data: T; expiresAt: number; }
const _cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const entry = _cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet<T>(key: string, data: T, ttl: number): void {
  _cache.set(key, { data, expiresAt: Date.now() + ttl * 1000 });
}

export function invalidateCache(prefix: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) _cache.delete(key);
  }
}

// TTL config (seconds)
const TTL: Record<string, number> = {
  "/projects": 60,
};
function getTTL(path: string): number {
  if (TTL[path]) return TTL[path];
  if (path.includes("/health")) return 30;
  if (path.match(/^\/projects\/[^/]+$/)) return 30;
  return 0; // no cache
}

/** Sunucu hatasi. status, HTTP statu kodudur.
 *  NOT: Backend yetki hatasini 404 olarak maskeler (bilgi sizdirmama).
 *  Bu yuzden 403 HICBIR ZAMAN gelmez; 404 "yok" ve "yetkin yok"
 *  anlamlarini birlikte tasir. Ayirt etmeye calisma. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ── HTTP client ──────────────────────────────────────────────────────────
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (method === "GET") {
    const ttl = getTTL(path);
    if (ttl > 0) {
      const cached = cacheGet<T>(path);
      if (cached !== null) return cached;
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
    });
    if (!res.ok) {
      if (res.status === 401) {
        const { clearAuth, loginRedirectUrl } = await import("../store/auth");
        clearAuth();
        window.location.href = loginRedirectUrl();
        throw new ApiError(401, "Oturum süresi doldu");
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail ?? "Sunucu hatası");
    }
    const data = await res.json() as T;
    if (ttl > 0) cacheSet(path, data, ttl);
    const { markSessionActive } = await import("../store/auth");
    markSessionActive();
    return data;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401) {
      const { clearAuth, loginRedirectUrl } = await import("../store/auth");
      clearAuth();
      window.location.href = loginRedirectUrl();
      throw new ApiError(401, "Oturum süresi doldu");
    }
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, err.detail ?? "Sunucu hatası");
  }
  const { markSessionActive } = await import("../store/auth");
  markSessionActive();
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
  postForm: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
      // Content-Type intentionally omitted — browser sets multipart boundary
    });
    if (!res.ok) {
      if (res.status === 401) {
        const { clearAuth, loginRedirectUrl } = await import("../store/auth");
        clearAuth();
        window.location.href = loginRedirectUrl();
        throw new ApiError(401, "Oturum süresi doldu");
      }
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new ApiError(res.status, err.detail ?? "Sunucu hatası");
    }
    const { markSessionActive } = await import("../store/auth");
    markSessionActive();
    return res.json();
  },
};

export interface LoginResponse {
  user_id: string;
  full_name: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/auth/login", { email, password });
}

export async function fetchAlerts(
  projectId: string,
  status = "pending",
  limit = 50
): Promise<AlertItem[]> {
  return api.get(
    `/projects/${projectId}/alerts?status=${status}&limit=${limit}`
  );
}

export async function fetchAlertActions(
  projectId: string,
  alertId: string
): Promise<AlertAction[]> {
  return api.get(
    `/projects/${projectId}/alerts/${alertId}/actions`
  );
}

export async function createAlertAction(
  projectId: string,
  alertId: string,
  body: {
    action_type: string;
    note?: string;
    assigned_to_role?: string;
    due_date?: string;
  }
): Promise<AlertAction> {
  return api.post(
    `/projects/${projectId}/alerts/${alertId}/actions`,
    body
  );
}

export async function markAlertAsRead(
  projectId: string,
  alertId: string
): Promise<void> {
  await api.post(
    `/projects/${projectId}/alerts/${alertId}/read`,
    {}
  );
}

export async function fetchReadAlertIds(
  projectId: string
): Promise<string[]> {
  const res = await api.get<{ read_ids: string[] }>(
    `/projects/${projectId}/alerts/read_ids`
  );
  return res.read_ids;
}

export interface LinkableDoc {
  id: string;
  type: "rfi" | "correspondence" | "contract_document" | "amendment";
  ref_number: string;
  subject: string;
  date: string;
  status: string;
  parent_id: string | null;
  /** From pdf_document when known (>0); null if unparsed / non-PDF instrument. */
  page_count?: number | null;
}

export async function fetchChronologies(
  projectId: string
): Promise<Chronology[]> {
  return api.get(
    `/projects/${projectId}/chronologies`
  );
}

export async function fetchLinkableDocuments(
  projectId: string
): Promise<LinkableDoc[]> {
  return api.get(
    `/projects/${projectId}/chronologies/linkable-documents`
  );
}

/** Project-wide chronology events by event_type.
 *  manualOnly=true mirrors by_chronology_type (document_ref_id IS NULL). */
export async function listEventsByType(
  projectId: string,
  eventType: string,
  manualOnly = true,
): Promise<ChronologyEventByType[]> {
  const qs = new URLSearchParams({
    event_type: eventType,
    manual_only: String(manualOnly),
  });
  return api.get(
    `/projects/${projectId}/chronologies/events?${qs.toString()}`
  );
}

export interface ChronologyEventByType {
  id: string;
  chronology_id: string;
  event_date: string;
  event_type: string;
  subject: string | null;
  document_ref_id: string | null;
  chronologies: {
    id: string;
    title: string;
    entity_type: string;
  };
}

/** 627: authored RFI 'draft' dogar; onay onu 'open'a cikarir.
 *  Onay = belgenin muhataba cikisi. submitted_date ve response_due_date
 *  onay aninda sunucuda atanir. version optimistic locking icindir.
 *  Yazma asistani geldiginde bu endpoint LLM ciktisinin HITL kapisi olacak. */
export async function approveRFI(
  projectId: string,
  rfiId: string,
  version: number,
): Promise<unknown> {
  return api.post(`/projects/${projectId}/rfis/${rfiId}/approve`, { version });
}

export interface DocumentStats {
  total_count:       number;
  corr_count:        number;
  rfi_count:         number;
  pdf_count:         number;
  manual_count:      number;
  by_corr_type:      Record<string, number>;
  by_rfi_discipline: Record<string, number>;
  by_doc_type:              Record<string, number>;
  by_chronology_type?:      Record<string, number>;
  contract_doc_count?:      number;
  changes_approved?:        number;
  changes_under_review?:    number;
  changes_disputed?:        number;
  other_amendments_count?:  number;
  top_keywords:      string[];
  top_locations:     string[];
}

export async function fetchDocumentStats(
  projectId: string
): Promise<DocumentStats> {
  return api.get(`/projects/${projectId}/documents/stats`);
}

// ── Contract & Amendments — In-Force resolution (B3) ───────────────────────
// Mirrors the backend response models (backend/models/resolution.py). Read-only:
// the CM-confirmed in-force graph. `status` is RAW (never relabeled here — §6 is
// a later step). amendment_date is a date string ("YYYY-MM-DD") or null.
export interface AmendmentRef {
  id:               string;
  amendment_number: string;
  amendment_date:   string | null;
  arrival_path:     string;
}

export interface ClauseResolution {
  subject_clause_id:    string;
  governing_instrument: "contract" | "amendment";
  amendment:            AmendmentRef | null;
  override_id:          string | null;
}

/** List-row shapes for DocumentsModule govern-record search (changes / amendments). */
export interface ChangeRow {
  id:            string;
  change_number: string;
  title:         string;
  status:        string;
  created_at:    string;
}

export interface AmendmentRow {
  id:               string;
  amendment_number: string;
  title:            string;
  arrival_path:     string;
  amendment_date:   string | null;
}

export interface ChangeOrderResolution {
  change_id:                string;
  change_number:            string;
  title:                    string;
  status:                   string;
  superseded_by_amendment:  AmendmentRef | null;
  amendment_pending:        boolean;
}

// ── Contract root (ADR-014) — the base contract as hierarchy root ─────────
// Document-centric In-Force view: contract (root) → amendments → change
// orders. clauses[] stays in the payload as the underlying engine (drill-down
// / future RAG) but is no longer the dashboard's primary rendering.
export interface ContractParty {
  role: "employer" | "contractor" | "engineer" | "other";
  name: string;
}

export interface ContractDocumentRef {
  id:                string;
  // null = annex registered, file pending (migration 040)
  pdf_document_id:   string | null;
  label:             string | null;
  precedence_rank:   number | null;  // bespoke precedence: 1 = highest, null = unranked
  original_filename: string | null;
}

export interface ContractRoot {
  id:                string;
  title:             string;
  contract_number:   string | null;
  description:       string | null;
  // Same vocabulary as projects.contract_type / ContractType (TB-28).
  contract_type:     string | null;
  // dlp_days = the DLP's LENGTH only; its window derives from actual
  // completion (dynamic, ADR-014) — never a stored date.
  commencement_date: string | null;
  duration_days:     number | null;
  dlp_days:          number | null;
  parties:           ContractParty[];
  documents:         ContractDocumentRef[];
}

export interface InForceAmendment {
  id:               string;
  amendment_number: string;
  title:            string;
  amendment_date:   string | null;
  arrival_path:     string;
  source_pdf_id:    string | null;
}

export interface ResolutionResponse {
  contract:      ContractRoot | null;  // null = not yet registered (HITL prompt)
  amendments:    InForceAmendment[];
  clauses:       ClauseResolution[];
  change_orders: ChangeOrderResolution[];
}

export async function fetchContractResolution(
  projectId: string
): Promise<ResolutionResponse> {
  return api.get(`/projects/${projectId}/contract/resolution`);
}

export interface ContractCreatePayload {
  title:              string;
  contract_number?:   string;
  description?:       string;
  contract_type?:     string;
  commencement_date?: string;  // "YYYY-MM-DD"
  duration_days?:     number;
  dlp_days?:          number;
  parties:            ContractParty[];
}

// CM-only on the backend (require_cm_role + contracts_cm_write RLS); 409 if
// the project already has a contract (pilot 1:1 cardinality, TB-27).
export async function createContract(
  projectId: string,
  payload: ContractCreatePayload
): Promise<ContractRoot> {
  return api.post(`/projects/${projectId}/contract`, payload);
}

export interface ContractDocumentPayload {
  label?: string;
  pdf_document_id?: string;
  precedence_rank?: number;
}

// CM-only. Creates a constituent-document / annex (ek) row — label-only
// (file pending) or already linked to an uploaded contract_document PDF.
export async function addContractDocument(
  projectId: string,
  contractId: string,
  payload: ContractDocumentPayload
): Promise<ContractRoot> {
  return api.post(`/projects/${projectId}/contract/${contractId}/documents`, payload);
}

// CM-only. Attach-later path for a label-only annex, or label/rank correction.
export async function updateContractDocument(
  projectId: string,
  contractId: string,
  linkId: string,
  payload: ContractDocumentPayload
): Promise<ContractRoot> {
  return api.put(
    `/projects/${projectId}/contract/${contractId}/documents/${linkId}`,
    payload
  );
}

// CM-only. Unlinks the document from the contract (deletes the link row;
// the filed PDF itself stays in Documents / storage).
export async function unlinkContractDocument(
  projectId: string,
  contractId: string,
  linkId: string
): Promise<ContractRoot> {
  return api.delete(
    `/projects/${projectId}/contract/${contractId}/documents/${linkId}`
  );
}

// Upload a PDF as entity_type=contract_document (entity_id MUST = projectId,
// backend guard in documents.py). Returns the new pdf_document id. Caller then
// links it via addContractDocument / updateContractDocument (CM-only).
export async function uploadContractPdf(
  projectId: string,
  file: File
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.postForm<{ doc_id: string }>(
    `/projects/${projectId}/documents/upload?entity_type=contract_document&entity_id=${projectId}`,
    formData
  );
  return res.doc_id;
}

export async function updateChronology(
  projectId: string,
  chronologyId: string,
  title: string
): Promise<Chronology> {
  return api.patch(
    `/projects/${projectId}/chronologies/${chronologyId}`,
    { title }
  );
}

export async function fetchChronology(
  projectId: string,
  chronologyId: string
): Promise<Chronology> {
  return api.get(
    `/projects/${projectId}/chronologies/${chronologyId}`
  );
}

export async function createChronology(
  projectId: string,
  body: {
    title: string;
    entity_type: string;
    entity_id?: string;
  }
): Promise<Chronology> {
  return api.post(
    `/projects/${projectId}/chronologies`,
    body
  );
}

export async function updateChronologyEvent(
  projectId: string,
  chronologyId: string,
  eventId: string,
  body: {
    event_type?: string;
    is_key_event?: boolean;
    event_date?: string;
    subject?: string;
  }
): Promise<ChronologyEvent> {
  return api.patch(
    `/projects/${projectId}/chronologies/${chronologyId}/events/${eventId}`,
    body
  );
}

export async function addChronologyEvent(
  projectId: string,
  chronologyId: string,
  body: {
    event_date: string;
    event_type: string;
    document_ref_id?: string;
    document_ref_type?: string;
    is_key_event?: boolean;
    activity_id?: string;
    boq_ref?: string;
    manual_narrative?: string;
    subject?: string;
  }
): Promise<ChronologyEvent> {
  return api.post(
    `/projects/${projectId}/chronologies/${chronologyId}/events`,
    body
  );
}

export async function previewChronologyNarrative(
  projectId: string,
  body: {
    event_type: string;
    event_date: string;
    subject?: string;
    document_ref_id?: string;
    document_ref_type?: string;
    dispute_id?: string;
    chronology_id?: string;
    note?: string;
  },
): Promise<{ narrative_text: string; review_required: boolean; warnings: string[] }> {
  return api.post(`/projects/${projectId}/chronologies/preview-narrative`, body);
}

export async function approveNarrative(
  projectId: string,
  chronologyId: string,
  eventId: string,
  approvedNarrative: string
): Promise<ChronologyEvent> {
  return api.post(
    `/projects/${projectId}/chronologies/${chronologyId}/events/${eventId}/approve-narrative`,
    { approved_narrative: approvedNarrative }
  );
}

export async function inactivateChronologyEvent(
  projectId: string,
  chronologyId: string,
  eventId: string,
  reason: string
): Promise<ChronologyEvent> {
  return api.post(
    `/projects/${projectId}/chronologies/${chronologyId}/events/${eventId}/inactivate`,
    { reason }
  );
}

export async function fetchUnreadCount(
  projectId: string
): Promise<number> {
  const res = await api.get<{ count: number }>(
    `/projects/${projectId}/alerts/unread_count`
  );
  return res.count;
}

export async function fetchAlertDocuments(
  projectId: string,
  alertId: string
): Promise<AlertDocument[]> {
  return api.get(
    `/projects/${projectId}/alerts/${alertId}/documents`
  );
}

// ── Project Intelligence (SYSTEM tab) ─────────────────────────────────────
export type IntelligenceCitation = {
  index: number;
  entity_type: "correspondence" | "rfi" | "change" | "deliverable";
  entity_id: string;
  ref: string;
  subject: string;
  date?: string | null;
  status?: string | null;
};

export type IntelligenceAskResponse = {
  answer_text: string;
  citations: IntelligenceCitation[];
  confidence_score: number;
  warnings: string[];
  review_required: boolean;
  objectivity_flag: boolean;
  retrieval_mode: "keyword";
  source_count: number;
};

export async function askProjectIntelligence(
  projectId: string,
  body: {
    question: string;
    messages?: { role: "user" | "assistant"; content: string }[];
    language?: "en" | "tr" | "ar";
  },
): Promise<IntelligenceAskResponse> {
  return api.post(`/projects/${projectId}/intelligence/ask`, body);
}

// ── Dispute Ready dossier ─────────────────────────────────────────────────
export type DisputeStatus = "draft" | "open" | "prepared" | "closed";
export type DisputeOrigin = "change" | "correspondence" | "mixed" | "manual";

export type DisputeListRow = {
  id: string;
  project_id: string;
  dispute_number: string;
  title: string;
  status: DisputeStatus;
  origin: DisputeOrigin;
  source_change_id: string | null;
  source_correspondence_id: string | null;
  chronology_id: string | null;
  chronology_entity_type?: string | null;
  chronology_title?: string | null;
  pack_storage_path: string | null;
  pack_generated_at: string | null;
  created_at: string;
};

export type DisputeImpact = {
  id: string;
  dispute_id: string;
  type: "cost" | "time" | "other";
  label: string;
  amount: number | null;
  unit: string | null;
  notes: string | null;
  sort_order: number;
};

export type DisputePositionRef = {
  id: string;
  position_id: string;
  ref_type: "change" | "correspondence" | "rfi" | "document" | "manual";
  entity_id: string | null;
  document_id: string | null;
  manual_title: string | null;
  manual_date: string | null;
  manual_note: string | null;
};

export type DisputePosition = {
  id: string;
  issue_id: string;
  side: "claim" | "response";
  title: string;
  summary: string | null;
  sort_order: number;
  dispute_position_refs?: DisputePositionRef[];
};

export type DisputeIssue = {
  id: string;
  dispute_id: string;
  title: string;
  sort_order: number;
  dispute_positions?: DisputePosition[];
};

export type DisputeDossier = DisputeListRow & {
  summary: string | null;
  venue: string | null;
  dispute_impacts?: DisputeImpact[];
  dispute_issues?: DisputeIssue[];
};

export async function fetchDisputes(projectId: string, status?: string): Promise<DisputeListRow[]> {
  const qs = status ? `?status=${status}` : "";
  return api.get(`/projects/${projectId}/disputes${qs}`);
}

export async function fetchDispute(projectId: string, disputeId: string): Promise<DisputeDossier> {
  return api.get(`/projects/${projectId}/disputes/${disputeId}`);
}

export async function fetchDisputeChronologySeed(
  projectId: string,
  disputeId: string,
): Promise<{ ids: string[] }> {
  return api.get(`/projects/${projectId}/disputes/${disputeId}/chronology/seed-docs`);
}

export async function createDisputeChronology(
  projectId: string,
  disputeId: string,
): Promise<DisputeDossier> {
  return api.post(`/projects/${projectId}/disputes/${disputeId}/chronology`, {});
}

export async function forkDisputeChronology(
  projectId: string,
  disputeId: string,
): Promise<DisputeDossier> {
  return api.post(`/projects/${projectId}/disputes/${disputeId}/chronology/fork`, {});
}

export async function generateDisputePosition(
  projectId: string,
  disputeId: string,
  issueId: string,
  side: "claim" | "response",
): Promise<{ title: string; summary: string; review_required: boolean; warnings: string[] }> {
  return api.post(
    `/projects/${projectId}/disputes/${disputeId}/issues/${issueId}/generate-position`,
    { side, issue_id: issueId },
  );
}

export async function createDispute(
  projectId: string,
  body: {
    title: string;
    origin: DisputeOrigin;
    summary?: string;
    venue?: string;
    source_change_id?: string;
    source_correspondence_id?: string;
  },
): Promise<DisputeDossier> {
  return api.post(`/projects/${projectId}/disputes`, body);
}

export async function updateDispute(
  projectId: string,
  disputeId: string,
  body: Partial<{ title: string; status: string; summary: string; venue: string; chronology_id: string | null }>,
): Promise<DisputeDossier> {
  return api.patch(`/projects/${projectId}/disputes/${disputeId}`, body);
}

export async function addDisputeImpact(
  projectId: string,
  disputeId: string,
  body: { type: "cost" | "time" | "other"; label: string; amount?: number; unit?: string; notes?: string },
): Promise<DisputeImpact> {
  return api.post(`/projects/${projectId}/disputes/${disputeId}/impacts`, body);
}

export async function deleteDisputeImpact(projectId: string, disputeId: string, impactId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/disputes/${disputeId}/impacts/${impactId}`);
}

export async function addDisputeIssue(
  projectId: string,
  disputeId: string,
  body: { title: string },
): Promise<DisputeIssue> {
  return api.post(`/projects/${projectId}/disputes/${disputeId}/issues`, body);
}

export async function deleteDisputeIssue(projectId: string, disputeId: string, issueId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/disputes/${disputeId}/issues/${issueId}`);
}

export async function addDisputePosition(
  projectId: string,
  disputeId: string,
  issueId: string,
  body: { side: "claim" | "response"; title: string; summary?: string },
): Promise<DisputePosition> {
  return api.post(`/projects/${projectId}/disputes/${disputeId}/issues/${issueId}/positions`, body);
}

export async function deleteDisputePosition(
  projectId: string, disputeId: string, issueId: string, positionId: string,
): Promise<void> {
  await api.delete(`/projects/${projectId}/disputes/${disputeId}/issues/${issueId}/positions/${positionId}`);
}

export async function addDisputePositionRef(
  projectId: string,
  disputeId: string,
  issueId: string,
  positionId: string,
  body: {
    ref_type: string;
    entity_id?: string;
    document_id?: string;
    manual_title?: string;
    manual_date?: string;
    manual_note?: string;
  },
): Promise<DisputePositionRef> {
  return api.post(
    `/projects/${projectId}/disputes/${disputeId}/issues/${issueId}/positions/${positionId}/refs`,
    body,
  );
}

export async function deleteDisputePositionRef(
  projectId: string, disputeId: string, issueId: string, positionId: string, refId: string,
): Promise<void> {
  await api.delete(
    `/projects/${projectId}/disputes/${disputeId}/issues/${issueId}/positions/${positionId}/refs/${refId}`,
  );
}

export async function prepareDisputePack(projectId: string, disputeId: string): Promise<DisputeDossier> {
  return api.post(`/projects/${projectId}/disputes/${disputeId}/pack`, {});
}

export async function uploadDisputeDocument(
  projectId: string,
  disputeId: string,
  file: File,
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.postForm<{ doc_id: string }>(
    `/projects/${projectId}/documents/upload?entity_type=dispute&entity_id=${disputeId}`,
    formData,
  );
  return res.doc_id;
}

export async function downloadDisputePack(
  projectId: string,
  disputeId: string,
  disputeNumber: string,
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/projects/${projectId}/disputes/${disputeId}/pack`,
    { credentials: "include" },
  );
  if (!res.ok) {
    if (res.status === 401) {
      const { clearAuth, loginRedirectUrl } = await import("../store/auth");
      clearAuth();
      window.location.href = loginRedirectUrl();
    }
    throw new ApiError(res.status, "Sunucu hatası");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${disputeNumber}-pack.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
