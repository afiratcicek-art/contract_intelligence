/**
 * Authoring API wrappers — mirrors existing api.get/post/patch style.
 */
import { api, type LinkableDoc } from "./api";

export interface DocumentTemplate {
  id: string;
  project_id: string;
  doc_type: "letter" | "rfi";
  name: string;
  header_text?: string | null;
  footer_text?: string | null;
  header_image_path?: string | null;
  footer_image_path?: string | null;
  watermark_image_path?: string | null;
  field_config?: Record<string, unknown>;
  is_active: boolean;
}

export interface DocumentDraft {
  id: string;
  project_id: string;
  doc_type: "letter" | "rfi";
  template_id?: string | null;
  subject?: string | null;
  body_html: string;
  field_values: {
    project?: string;
    attention_to?: string;
    references?: Array<Record<string, unknown>>;
    /** Opt-in: append reference PDF copies to e-bundle (default true when absent). */
    include_reference_copies?: boolean;
    [key: string]: unknown;
  };
  status: "drafting" | "approved" | "discarded";
  version: number;
  docx_path?: string | null;
  bundle_pdf_path?: string | null;
  materialized_entity_type?: string | null;
  materialized_entity_id?: string | null;
  document_templates?: DocumentTemplate | null;
  updated_at?: string;
}

export async function listAuthoringTemplates(
  projectId: string,
  docType?: string
): Promise<DocumentTemplate[]> {
  const q = docType ? `?doc_type=${docType}` : "";
  return api.get(`/projects/${projectId}/authoring/templates${q}`);
}

export async function createAuthoringTemplate(
  projectId: string,
  body: {
    doc_type: "letter" | "rfi";
    name: string;
    header_text?: string;
    footer_text?: string;
    is_active?: boolean;
    field_config?: Record<string, unknown>;
  }
): Promise<DocumentTemplate> {
  return api.post(`/projects/${projectId}/authoring/templates`, body);
}

export async function updateAuthoringTemplate(
  projectId: string,
  templateId: string,
  body: Partial<{
    name: string;
    header_text: string;
    footer_text: string;
    is_active: boolean;
    field_config: Record<string, unknown>;
  }>
): Promise<DocumentTemplate> {
  return api.patch(`/projects/${projectId}/authoring/templates/${templateId}`, body);
}

export async function deleteAuthoringTemplate(
  projectId: string,
  templateId: string
): Promise<void> {
  await api.delete(`/projects/${projectId}/authoring/templates/${templateId}`);
}

export async function uploadTemplateChrome(
  projectId: string,
  templateId: string,
  slot: "header" | "footer" | "watermark",
  file: File
): Promise<DocumentTemplate> {
  const fd = new FormData();
  fd.append("slot", slot);
  fd.append("file", file);
  return api.postForm(
    `/projects/${projectId}/authoring/templates/${templateId}/chrome`,
    fd
  );
}

export async function fetchTemplateChromeUrl(
  projectId: string,
  templateId: string,
  slot: "header" | "footer" | "watermark"
): Promise<{ signed_url: string; expires_in: number; slot: string }> {
  return api.get(
    `/projects/${projectId}/authoring/templates/${templateId}/chrome-url?slot=${slot}`
  );
}

export async function listAuthoringDrafts(
  projectId: string,
  opts?: { status?: string; doc_type?: string }
): Promise<DocumentDraft[]> {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.doc_type) params.set("doc_type", opts.doc_type);
  const q = params.toString() ? `?${params}` : "";
  return api.get(`/projects/${projectId}/authoring/drafts${q}`);
}

export async function createAuthoringDraft(
  projectId: string,
  body: {
    doc_type: "letter" | "rfi";
    subject?: string;
    body_html?: string;
    field_values?: Record<string, unknown>;
    template_id?: string;
  }
): Promise<DocumentDraft> {
  return api.post(`/projects/${projectId}/authoring/drafts`, body);
}

export async function fetchAuthoringDraft(
  projectId: string,
  draftId: string
): Promise<DocumentDraft> {
  return api.get(`/projects/${projectId}/authoring/drafts/${draftId}`);
}

export async function patchAuthoringDraft(
  projectId: string,
  draftId: string,
  body: {
    version: number;
    subject?: string;
    body_html?: string;
    field_values?: Record<string, unknown>;
  }
): Promise<DocumentDraft> {
  return api.patch(`/projects/${projectId}/authoring/drafts/${draftId}`, body);
}

export type AiChatResult = {
  reply_text: string;
  confidence_score: number;
  warnings: string[];
  review_required: boolean;
  objectivity_flag: boolean;
};

export async function aiChat(
  projectId: string,
  draftId: string,
  body: {
    messages: { role: "user" | "assistant"; content: string }[];
    selection_text?: string;
    language?: "en" | "ar" | "tr";
    version: number;
    current_body?: string;
    intent?: "revise" | "comment";
  }
): Promise<AiChatResult> {
  return api.post(`/projects/${projectId}/authoring/drafts/${draftId}/ai-chat`, {
    messages: body.messages,
    selection_text: body.selection_text,
    language: body.language,
    version: body.version,
    current_body: body.current_body,
    intent: body.intent,
  });
}

export async function generateAuthoringDocx(
  projectId: string,
  draftId: string,
  includeReferenceCopies: boolean = true
): Promise<{
  draft: DocumentDraft;
  docx_path: string;
  bundle_pdf_path?: string | null;
  pdf_preview_available: boolean;
  bundle_available: boolean;
}> {
  return api.post(`/projects/${projectId}/authoring/drafts/${draftId}/generate-docx`, {
    include_reference_copies: includeReferenceCopies,
  });
}

export async function fetchAuthoringDocxUrl(
  projectId: string,
  draftId: string
): Promise<{ signed_url: string; expires_in: number }> {
  return api.get(`/projects/${projectId}/authoring/drafts/${draftId}/docx-url`);
}

export async function fetchAuthoringBundleUrl(
  projectId: string,
  draftId: string
): Promise<{ signed_url: string; expires_in: number }> {
  return api.get(`/projects/${projectId}/authoring/drafts/${draftId}/bundle-url`);
}

/** Temporary signed URL for any project pdf_document (reference preview). */
export async function getDocumentSignedUrl(
  projectId: string,
  docId: string
): Promise<{ signed_url: string; expires_in: number }> {
  return api.get(
    `/projects/${projectId}/documents/${docId}/signed-url`
  );
}

/** Resolve (and cache) pdf_document.page_count — PDF count / docx render→count. */
export async function fetchDocumentPageCount(
  projectId: string,
  docId: string
): Promise<{ page_count: number | null }> {
  return api.get(`/projects/${projectId}/documents/${docId}/page-count`);
}

/** Authoring picker: RFI + Corr + filed contract docs + amendments. */
export async function fetchAuthoringLinkable(
  projectId: string
): Promise<LinkableDoc[]> {
  return api.get(`/projects/${projectId}/authoring/linkable-references`);
}

export async function uploadAuthoringReferenceFile(
  projectId: string,
  draftId: string,
  file: File
): Promise<{ doc_id: string; original_filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return api.postForm(
    `/projects/${projectId}/authoring/drafts/${draftId}/reference-files`,
    fd
  );
}

export async function approveAuthoringDraft(
  projectId: string,
  draftId: string,
  body: {
    version: number;
    document_number: string;
    correspondence_date?: string;
    direction?: "incoming" | "outgoing";
    corr_type?: string;
    discipline?: string;
    parent_id?: string;
    relation?: "response" | "followup" | "revision";
  }
): Promise<{
  draft: DocumentDraft;
  materialized: Record<string, unknown>;
  entity_type: string;
}> {
  return api.post(`/projects/${projectId}/authoring/drafts/${draftId}/approve`, body);
}
