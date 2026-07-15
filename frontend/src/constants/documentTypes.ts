// Referans ve kronoloji belge tipleri — tek kanonik kaynak.
// DB karsiligi: migration 032 (rfi_references / correspondence_references
// / chronology_events CHECK'leri). Bu liste 032 ile SENKRON tutulmali.
// Kayitli varlik tipleri (rfi/correspondence/change) buraya GIRMEZ —
// onlar arama kutusundan secilir, FK ile baglanir.

export const DOCUMENT_TYPE_LABELS: Record<string, { en: string; tr: string }> = {
  drawing:     { en: "Drawing",                          tr: "Çizim" },
  spec:        { en: "Specification",                    tr: "Şartname" },
  specialist:  { en: "Manufacturer / Specialist Document", tr: "Üretici / Uzman Belgesi" },
  submission:  { en: "Submission",                       tr: "Onay Sunumu" },
  response:    { en: "Response",                         tr: "Yanıt" },
  meeting:     { en: "Meeting / MOM",                    tr: "Toplantı Tutanağı" },
  inspection:  { en: "Inspection (WIR/MIR)",             tr: "Muayene (WIR/MIR)" },
  work_permit: { en: "Work Permit",                      tr: "Çalışma İzni" },
  other:       { en: "Other",                            tr: "Diğer" },
};

// RFI/Correspondence referans kaydi. RFIDetail ve CorrespondenceDetail paylasir.
export interface RefItem {
  id: string;
  ref_type: string;
  target_label: string | null;
  target_subject: string | null;
  external_doc_date: string | null;
  note: string | null;
  rfi_id: string | null;
  ref_corr_id: string | null;
  change_id: string | null;
  document_id: string | null;
  ref_role: string;
  // Yalniz ref_role='attachment' satirlarinda dolar (backend doc_meta).
  file_size_bytes?: number;
  parse_status?: string;
  doc_type?: string | null;
  keywords?: string[];
  location?: string | null;
}

/** pdf_document.parse_status → kullanıcıya gösterilecek etiket.
 *  null döner = gösterilecek bir şey yok (pending/completed sessizdir).
 *  Iki detay sayfası da bunu kullanır; kopyalanmaz. */
export function parseStatusLabel(status: string | null | undefined, lang: string): string | null {
  if (!status || status === "pending") return null;
  if (status === "processing") return lang === "tr" ? "İşleniyor" : "Processing";
  if (status === "done" || status === "completed") return null;
  if (status === "failed") return lang === "tr" ? "İşlem başarısız" : "Upload failed";
  return null;
}
