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
  type: "rfi" | "correspondence";
  ref_number: string;
  subject: string;
  date: string;
  status: string;
  parent_id: string | null;
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
  subject_key:          string;
  governing_instrument: "contract" | "amendment";
  amendment:            AmendmentRef | null;
  override_id:          string | null;
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
