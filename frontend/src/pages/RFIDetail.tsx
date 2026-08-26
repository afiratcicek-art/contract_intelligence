import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import LanguageToggle from "../components/LanguageToggle";
import { api, ApiError, approveRFI, fetchLinkableDocuments, type LinkableDoc } from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import Button from "../components/Button";
import AiActionButton from "../components/AiActionButton";
import EntryModeMenu from "../components/EntryModeMenu";
import StatusChip from "../components/StatusChip";
import { getAuth, clearAuth } from "../store/auth";
import ThemeToggle from "../components/ThemeToggle";
import { useLanguage } from "../context/LanguageContext";
import { useToastContext } from "../context/ToastContext";
import RelationPopup from "../components/RelationPopup";
import DocumentLink from "../components/DocumentLink";
import ReferenceLink from "../components/ReferenceLink";
import { DOCUMENT_TYPE_LABELS, parseStatusLabel, type RefItem } from "../constants/documentTypes";
import { formatDateCompact } from "../utils/format";

interface ChainItem {
  id: string;
  rfi_number: string;
  subject: string;
  rfi_type: string;
  status: string;
  submitted_date: string;
}

interface RFIChain {
  ancestors: ChainItem[];
  children: ChainItem[];
  is_latest: boolean;
}

interface LinkedCorr {
  id: string;
  corr_number: string;
  subject: string;
  type: string;
  status: string;
  correspondence_date: string;
}

interface RFIDetail {
  id: string;
  rfi_number: string;
  subject: string;
  description: string | null;
  discipline: string | null;
  submitted_by: string | null;
  submitted_date: string | null;
  response_due_date: string | null;
  version: number;
  entry_mode: "authored" | "recorded";
  response_due_source: string | null;
  response_due_day_type: string | null;
  actual_response_date: string | null;
  status: string;
  parent_id: string | null;
  rfi_type: string;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  assigned_to: string | null;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
  linked_correspondences: LinkedCorr[];
  chain: RFIChain;
  keywords?: string[];
}

interface DeadlineInfo {
  deadline: string | null;
  deadline_source: string | null;
  days_remaining: number | null;
  urgency: string;
}

const RFI_TYPE_LABELS: Record<string, { en: string; tr: string }> = {
  original: { en: "Original", tr: "Orijinal" },
  response: { en: "Response", tr: "Yanıt" },
  revision: { en: "Revision", tr: "Revize" },
};

export default function RFIDetail() {
  const { projectId, rfiId } = useParams<{ projectId: string; rfiId: string }>();
  const navigate = useNavigate();
  const auth = getAuth();
  const { lang, t } = useLanguage();
  const { showToast } = useToastContext();

  const [rfi, setRfi] = useState<RFIDetail | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [noticeConfigs, setNoticeConfigs] = useState<{ id: string; label: string; notice_period_days: number }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; full_name: string; project_role: string }[]>([]);
  const [flagForm, setFlagForm] = useState<{
    narrative: string;
    notice_config_id: string;
    assigned_to_user: string;
    document_references: string[];
    newFile: File | null;
  }>({
    narrative: "",
    notice_config_id: "",
    assigned_to_user: "",
    document_references: [],
    newFile: null,
  });
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [showRelations, setShowRelations] = useState(false);
  const [deadline, setDeadline] = useState<DeadlineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refs, setRefs] = useState<RefItem[]>([]);
  const citationRefs = refs.filter((r) => r.ref_role !== "attachment");
  // 035 CHECK: attachment ⇒ document_id NOT NULL. Tip bu kısıtı yansıtır.
  const attachmentRefs = refs.filter(
    (r): r is RefItem & { document_id: string } =>
      r.ref_role === "attachment" && r.document_id !== null
  );
  const [linkable, setLinkable] = useState<LinkableDoc[]>([]);
  const [refSearch, setRefSearch] = useState("");
  const [showRefDropdown, setShowRefDropdown] = useState(false);
  const [showManualRef, setShowManualRef] = useState(false);
  const [manualRef, setManualRef] = useState({ number: "", title: "", date: "", type: "", note: "" });
  const [refSaving, setRefSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const refPickerRef = useRef<HTMLDivElement>(null);

  const bg          = "var(--color-bg-primary)";
  const cardBg      = "var(--color-bg-secondary)";
  const border      = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond  = "var(--color-text-secondary)";
  const alertRed    = "var(--color-alert-red)";

  useEffect(() => {
    if (!projectId) return;
    api.get<{ id: string; label: string; notice_period_days: number }[]>(
      `/projects/${projectId}/notice-config`
    ).then(setNoticeConfigs).catch(() => {});
    api.get<{ user_id: string; full_name: string; project_role: string }[]>(
      `/projects/${projectId}/members`
    ).then(setMembers).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !rfiId) return;
    api.get<RefItem[]>(`/projects/${projectId}/rfis/${rfiId}/references`)
      .then(setRefs).catch(() => {});
  }, [projectId, rfiId]);

  useEffect(() => {
    const hasPending = refs.some(
      (r) => r.ref_role === "attachment" &&
        (r.parse_status === "pending" || r.parse_status === "processing")
    );
    if (!hasPending) return;
    const interval = setInterval(async () => {
      try {
        const updated = await api.get<RefItem[]>(`/projects/${projectId}/rfis/${rfiId}/references`);
        if (Array.isArray(updated)) {
          setRefs(updated);
        }
      } catch {
        // Sessizce devam et — polling hata verirse bir sonraki turda dener
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [refs, projectId, rfiId]);

  useEffect(() => {
    if (!projectId) return;
    fetchLinkableDocuments(projectId).then(setLinkable).catch(() => setLinkable([]));
  }, [projectId]);

  useEffect(() => {
    if (!showRefDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (refPickerRef.current && !refPickerRef.current.contains(e.target as Node)) {
        setShowRefDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRefDropdown]);

  const filteredLinkable = linkable.filter((d) => {
    const q = refSearch.toLowerCase();
    return (
      d.id !== rfiId &&
      // Etiket degil, id ile esles: target_label capraz-proje hedefte null doner
      // ve iki farkli tur ayni ref_number'i tasiyabilir.
      !refs.some((r) =>
        (d.type === "rfi" && r.rfi_id === d.id) ||
        (d.type === "correspondence" && r.ref_corr_id === d.id)
      ) &&
      (d.ref_number.toLowerCase().includes(q) || d.subject.toLowerCase().includes(q))
    );
  });

  const reloadRefs = () => {
    if (!projectId || !rfiId) return;
    api.get<RefItem[]>(`/projects/${projectId}/rfis/${rfiId}/references`)
      .then(setRefs).catch(() => {});
  };

  const handleRefError = (err: unknown) => {
    // TB-58: backend yetki hatasini 404 olarak maskeler (bilgi sizdirmama).
    // 403 hicbir zaman gelmez; "yok" ile "yetkin yok" ayirt EDILEMEZ.
    // Bu bilincli bir mimari karardir, duzeltilecek bir eksik degil.
    showToast(err instanceof Error ? err.message : "", "error");
  };

  const addRefFromDoc = async (doc: LinkableDoc) => {
    if (!projectId || !rfiId || refSaving) return;
    setRefSaving(true);
    try {
      await api.post(`/projects/${projectId}/rfis/${rfiId}/references`, {
        ref_type: doc.type === "rfi" ? "rfi" : "correspondence",
        rfi_id: doc.type === "rfi" ? doc.id : undefined,
        ref_corr_id: doc.type === "correspondence" ? doc.id : undefined,
      });
      reloadRefs();
      setRefSearch("");
      setShowRefDropdown(false);
    } catch (err) {
      handleRefError(err);
    } finally {
      setRefSaving(false);
    }
  };

  // 'other' secildiginde kullanicinin girdigi tur kunyesi note alanina yazilir:
  // rfi_references'ta serbest tip aciklamasi icin ayri kolon yok (TB-59).
  const addManualRef = async () => {
    if (!projectId || !rfiId || refSaving || !manualRef.number.trim() || !manualRef.type) return;
    setRefSaving(true);
    try {
      await api.post(`/projects/${projectId}/rfis/${rfiId}/references`, {
        ref_type: manualRef.type,
        external_doc_number: manualRef.number.trim(),
        external_doc_title: manualRef.title.trim() || undefined,
        external_doc_date: manualRef.date || undefined,
        note: manualRef.note.trim() || undefined,
      });
      reloadRefs();
      setManualRef({ number: "", title: "", date: "", type: "", note: "" });
      setShowManualRef(false);
    } catch (err) {
      handleRefError(err);
    } finally {
      setRefSaving(false);
    }
  };

  const canAddManual = manualRef.number.trim() !== "" && manualRef.type !== "";

  const reloadRfi = () => {
    if (!projectId || !rfiId) return Promise.resolve();
    return Promise.all([
      api.get<RFIDetail>(`/projects/${projectId}/rfis/${rfiId}`),
      api.get<DeadlineInfo>(`/projects/${projectId}/rfis/${rfiId}/deadline`),
    ]).then(([rfiData, deadlineData]) => {
      setRfi(rfiData);
      setDeadline(deadlineData);
    });
  };

  const handleApprove = async () => {
    if (!projectId || !rfiId || !rfi || approving) return;
    setApproving(true);
    setApproveConfirmOpen(false);
    try {
      await approveRFI(projectId, rfiId, rfi.version);
      showToast(lang === "tr" ? "RFI onaylandi." : "RFI approved.");
      await reloadRfi();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast(
          lang === "tr" ? "Kayit degismis, sayfayi yenileyin." : "Record changed, please refresh.",
          "error"
        );
      } else {
        showToast(err instanceof Error ? err.message : "", "error");
      }
    } finally {
      setApproving(false);
    }
  };

  useEffect(() => {
    if (!projectId || !rfiId) return;
    setLoading(true);
    Promise.all([
      api.get<RFIDetail>(`/projects/${projectId}/rfis/${rfiId}`),
      api.get<DeadlineInfo>(`/projects/${projectId}/rfis/${rfiId}/deadline`),
    ])
      .then(([rfiData, deadlineData]) => { setRfi(rfiData); setDeadline(deadlineData); })
      .catch(() => setError(lang === "tr" ? "RFI yüklenemedi." : "Failed to load RFI."))
      .finally(() => setLoading(false));
  }, [projectId, rfiId]);

  const handleLogout = () => { clearAuth(); navigate("/login"); };

  const typeBadge = (rfiType: string) => {
    const label = RFI_TYPE_LABELS[rfiType]?.[lang as "en" | "tr"] ?? rfiType;
    const colors = rfiType === "original"
      ? { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" }
      : rfiType === "response"
      ? { bg: "var(--color-success-bg)", text: "var(--color-success)" }
      : { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" };
    return <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "2px 8px", backgroundColor: colors.bg, color: colors.text }}>{label}</span>;
  };

  const field = (label: string, value: string | null | undefined, mono = false) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? textPrimary : textSecond, fontFamily: mono ? "var(--font-meta)" : "var(--font-ui)", fontStyle: value ? "normal" : "italic" }}>{value ?? "—"}</div>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: textSecond, fontFamily: "var(--font-ui)" }}>{t("state.loading")}</p>
    </div>
  );

  if (error || !rfi) return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ fontSize: 13, color: alertRed, fontFamily: "var(--font-ui)" }}>{error || (lang === "tr" ? "RFI bulunamadı." : "RFI not found.")}</p>
    </div>
  );

  const chain = rfi.chain ?? { ancestors: [], children: [], is_latest: true };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      <nav className="app-chrome-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div className="gold-line gold-line-compact" />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}>{t("module.rfis")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span className="ref-number" style={{ color: textPrimary, fontWeight: 500 }}>{rfi.rfi_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecond }}>
          <span>{auth?.full_name}</span>
          <LanguageToggle />
          <ThemeToggle />
          <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecond }}>{t("nav.signout")}</button>
        </div>
      </nav>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>

        {/* Ancestor zinciri */}
        {chain.ancestors.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "8px 12px", backgroundColor: cardBg, borderLeft: `2px solid ${"var(--color-accent)"}` }}>
            <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, flexShrink: 0 }}>{t("chain.label")}</span>
            <div className="chain-rail">
              {chain.ancestors.map((a) => (
                <span
                  key={a.id}
                  className="chain-stop ref-number"
                  onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${a.id}`)}
                  title={RFI_TYPE_LABELS[a.rfi_type]?.[lang as "en" | "tr"] ?? a.rfi_type}
                  style={{ color: "var(--color-accent-text)", cursor: "pointer" }}
                >
                  {a.rfi_number}
                </span>
              ))}
              <span className="chain-stop chain-stop-current ref-number" style={{ color: textPrimary, fontWeight: 500 }}>
                {rfi.rfi_number}
              </span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="detail-header" style={{ marginBottom: 28 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="ref-number">{rfi.rfi_number}</span>
              {typeBadge(rfi.rfi_type)}
            </div>
            <h1 style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1)", fontWeight: 500, color: textPrimary, margin: 0, lineHeight: 1.3 }}>{rfi.subject}</h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 8, flexShrink: 0, marginLeft: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusChip status={rfi.status} />
              {rfi.status === "draft" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setApproveConfirmOpen(true)}
                  disabled={approving}
                  loading={approving}
                >
                  {lang === "tr" ? "Onayla" : "Approve"}
                </Button>
              )}
            </div>
            {deadline && deadline.days_remaining !== null && (
              <div style={{ fontSize: 11, color: deadline.urgency === "CRITICAL" || deadline.urgency === "WARNING" ? alertRed : textSecond, fontFamily: "var(--font-ui)", fontWeight: deadline.urgency !== "NORMAL" ? 500 : 400 }}>
                {deadline.days_remaining < 0 ? `${Math.abs(deadline.days_remaining)} ${lang === "tr" ? "gün geçti" : "days overdue"}` : deadline.days_remaining === 0 ? (lang === "tr" ? "Bugün" : "Today") : `${deadline.days_remaining} ${lang === "tr" ? "gün kaldı" : "days left"}`}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              <EntryModeMenu
                label={t("action.addresponse")}
                registerPath={`/projects/${projectId}/workspace/rfis/new?mode=response&parent_id=${rfi.id}&parent_number=${encodeURIComponent(rfi.rfi_number)}`}
                createPath={`/projects/${projectId}/workspace/authoring/new?doc_type=rfi&relation=response&parent_id=${rfi.id}&parent_number=${encodeURIComponent(rfi.rfi_number)}`}
              />
              {rfi.rfi_type === "response" && (
                <Button
                  type="button"
                  size="sm"
                  variant="warning"
                  onClick={() => setFlagOpen(true)}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {lang === "tr" ? "Potansiyel Etki" : "Potential Impact"}
                </Button>
              )}
              <EntryModeMenu
                label={t("action.addrevision")}
                variant="secondary"
                registerPath={`/projects/${projectId}/workspace/rfis/new?mode=revision&parent_id=${rfi.id}&parent_number=${encodeURIComponent(rfi.rfi_number)}`}
                createPath={`/projects/${projectId}/workspace/authoring/new?doc_type=rfi&relation=revision&parent_id=${rfi.id}&parent_number=${encodeURIComponent(rfi.rfi_number)}`}
              />
            </div>
          </div>
        </div>

        {/* Deadline banner */}
        {deadline && deadline.deadline && deadline.days_remaining !== null && deadline.days_remaining <= 3 && (
          <div style={{ backgroundColor: "var(--color-alert-red-bg)", border: `0.5px solid ${alertRed}`, padding: "10px 16px", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: alertRed, fontWeight: 500, fontFamily: "var(--font-ui)" }}>
              {deadline.days_remaining < 0 ? "OVERDUE" : (lang === "tr" ? "SON TARİH YAKLAŞIYOR" : "DEADLINE APPROACHING")}
            </span>
            <span style={{ fontSize: 12, color: alertRed, fontFamily: "var(--font-meta)" }}>{deadline.deadline}</span>
            {deadline.deadline_source && <span style={{ fontSize: 11, color: textSecond }}>{lang === "tr" ? "— Kaynak:" : "— Source:"} {deadline.deadline_source}</span>}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Bilgi" : "Information"}</div>
              {field(lang === "tr" ? "Disiplin" : "Discipline", rfi.discipline)}
              {field(lang === "tr" ? "Gönderen" : "Submitted By", rfi.submitted_by)}
              {field(
                lang === "tr" ? "Gönderim Tarihi" : "Submission Date",
                rfi.submitted_date === null
                  ? (lang === "tr" ? "Taslak — sunulmadi" : "Draft — not submitted")
                  : rfi.submitted_date?.slice(0, 10)
              )}
              {field(lang === "tr" ? "Harici Referans" : "External Reference", rfi.external_ref, true)}
              {attachmentRefs.some(r => r.location) && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${border}` }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.06em",
                    color: textSecond,
                    marginBottom: 4,
                  }}>
                    {lang === "tr" ? "Lokasyon" : "Location"}
                  </div>
                  <p style={{
                    fontSize: 12,
                    color: textPrimary,
                    fontFamily: "var(--font-ui)",
                    margin: 0,
                  }}>
                    {attachmentRefs.find(r => r.location)?.location}
                  </p>
                </div>
              )}
              {((rfi.keywords && rfi.keywords.length > 0) ||
                attachmentRefs.some(r => r.keywords && r.keywords.length > 0)) && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `0.5px solid ${border}` }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: "uppercase" as const,
                    letterSpacing: "0.06em",
                    color: textSecond,
                    marginBottom: 8,
                  }}>
                    {lang === "tr" ? "Anahtar Kelimeler" : "Keywords"}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                    {[...new Set([
                      ...(rfi.keywords || []),
                      ...attachmentRefs.flatMap(r => r.keywords || []),
                    ])].map((kw, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            background: bg,
                            border: `0.5px solid ${border}`,
                            color: textSecond,
                            fontFamily: "var(--font-meta)",
                          }}
                        >
                          {kw}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {showRelations && projectId && rfiId && (
                <RelationPopup
                  projectId={projectId}
                  entityType="rfi"
                  entityId={rfiId}
                  onClose={() => setShowRelations(false)}
                />
              )}
            </div>
            {rfi.description && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Açıklama" : "Description"}</div>
                <p style={{ fontSize: 13, color: textPrimary, fontFamily: "var(--font-ui)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" as const }}>{rfi.description}</p>
              </div>
            )}
            {rfi.status === "closed" && (
              <div style={{ background: cardBg, padding: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>{lang === "tr" ? "Kapanış" : "Closure"}</div>
                {field(lang === "tr" ? "Kapanış Tarihi" : "Closed On", rfi.closed_at?.slice(0, 10))}
                {field(lang === "tr" ? "Kapanış Notu" : "Close Note", rfi.close_note)}
              </div>
            )}
          </div>

          <div>
            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 16, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>Deadline</div>
              {field(lang === "tr" ? "Yanıt Beklenen" : "Response Due", rfi.response_due_date?.slice(0, 10))}
              {field(lang === "tr" ? "Deadline Kaynağı" : "Source", rfi.response_due_source)}
              {field(lang === "tr" ? "Gün Tipi" : "Day Type", rfi.response_due_day_type)}
              {field(lang === "tr" ? "Gerçek Yanıt Tarihi" : "Actual Response", rfi.actual_response_date?.slice(0, 10))}
            </div>

            {chain.children.length > 0 && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                  {`${t("chain.responses")} (${chain.children.length})`}
                </div>
                {chain.children.map((child) => (
                  <div key={child.id} onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${child.id}`)}
                    style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${"var(--color-accent)"}`, cursor: "pointer", background: "var(--color-bg-primary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {/* minWidth:0 lets a long subject wrap instead of growing over the
                        date, which cannot shrink. */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span className="ref-number" style={{ color: "var(--color-accent-text)" }}>{child.rfi_number}</span>
                        {typeBadge(child.rfi_type)}
                      </div>
                      <div style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{child.subject}</div>
                    </div>
                    <div className="data-figure" style={{ color: textSecond, flexShrink: 0, marginInlineStart: 8 }}>{formatDateCompact(child.submitted_date)}</div>
                  </div>
                ))}
              </div>
            )}

            {rfi.linked_correspondences && rfi.linked_correspondences.length > 0 && (
              <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                  {lang === "tr" ? `Bağlı Yazışmalar (${rfi.linked_correspondences.length})` : `Linked Correspondences (${rfi.linked_correspondences.length})`}
                </div>
                {rfi.linked_correspondences.map((c) => (
                  <div key={c.id} onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${c.id}`)}
                    style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${"var(--color-accent)"}`, cursor: "pointer", background: "var(--color-bg-primary)" }}>
                    <div style={{ fontFamily: "var(--font-meta)", fontSize: 11, color: textSecond }}>{c.corr_number}</div>
                    <div style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{c.subject}</div>
                    <div style={{ fontSize: 11, color: textSecond, marginTop: 2 }}>{c.correspondence_date?.slice(0, 10)}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                {lang === "tr" ? `Referanslar (${citationRefs.length})` : `References (${citationRefs.length})`}
              </div>

              {citationRefs.length === 0 && (
                <p style={{ fontSize: 12, color: textSecond, fontStyle: "italic", margin: "0 0 12px", fontFamily: "var(--font-ui)" }}>
                  {lang === "tr" ? "Henüz referans yok." : "No references yet."}
                </p>
              )}

              {citationRefs.map((r) => (
                <div key={r.id}
                  style={{ padding: "8px 10px", marginBottom: 4, borderLeft: `2px solid ${"var(--color-accent)"}`, background: "var(--color-bg-primary)" }}>
                  <div style={{ fontFamily: "var(--font-meta)", fontSize: 11, color: textSecond }}>
                    <ReferenceLink
                      projectId={projectId!}
                      item={r}
                      style={{ cursor: "pointer", color: "var(--color-accent)", textDecoration: "underline" }}
                    >
                      {r.target_label ?? "-"}
                    </ReferenceLink>
                    {DOCUMENT_TYPE_LABELS[r.ref_type] && (
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "2px 6px", background: "var(--color-bg-secondary)", color: textSecond }}>
                        {DOCUMENT_TYPE_LABELS[r.ref_type][lang as "en" | "tr"]}
                      </span>
                    )}
                  </div>
                  {r.target_subject && (
                    <div style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{r.target_subject}</div>
                  )}
                  {r.external_doc_date && (
                    <div style={{ fontSize: 11, color: textSecond, marginTop: 2 }}>{r.external_doc_date.slice(0, 10)}</div>
                  )}
                  {r.note && (
                    <div style={{ fontSize: 11, color: textSecond, marginTop: 2, fontStyle: "italic" }}>{r.note}</div>
                  )}
                </div>
              ))}

              <div style={{ marginTop: refs.length > 0 ? 12 : 0 }}>
                <div ref={refPickerRef} style={{ position: "relative", marginBottom: 8 }}>
                  <input
                    value={refSearch}
                    onChange={(e) => { setRefSearch(e.target.value); setShowRefDropdown(true); }}
                    onFocus={() => setShowRefDropdown(true)}
                    placeholder={lang === "tr" ? "RFI veya yazışma ara..." : "Search RFI or Correspondence..."}
                    disabled={refSaving}
                    style={{
                      width: "100%", padding: "8px 12px",
                      border: `1px solid ${border}`,
                      background: "var(--color-bg-primary)",
                      color: textPrimary,
                      fontSize: 12, borderRadius: 0,
                      boxSizing: "border-box" as const,
                      fontFamily: "var(--font-ui)",
                    }}
                  />
                  {showRefDropdown && filteredLinkable.length > 0 && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0,
                      background: "var(--color-bg-primary)",
                      border: `1px solid ${border}`,
                      zIndex: "var(--z-dropdown)" as unknown as number,
                      maxHeight: 220, overflowY: "auto",
                    }}>
                      {filteredLinkable.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => addRefFromDoc(doc)}
                          disabled={refSaving}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "8px 12px", background: "none", border: "none",
                            borderBottom: `1px solid ${border}`,
                            cursor: refSaving ? "not-allowed" : "pointer",
                            fontSize: 12, color: textPrimary,
                            fontFamily: "var(--font-ui)",
                            opacity: refSaving ? 0.5 : 1,
                          }}
                        >
                          <span style={{ fontFamily: "var(--font-meta)", fontSize: 11, color: textSecond }}>
                            {doc.ref_number}
                          </span>
                          {" "}{doc.subject}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowManualRef((v) => !v)}
                  disabled={refSaving}
                  style={{
                    fontSize: 11, background: "none",
                    border: `1px solid ${border}`,
                    color: textSecond, cursor: "pointer",
                    padding: "4px 12px", borderRadius: 0,
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {showManualRef
                    ? (lang === "tr" ? "Manuel girişi iptal" : "Cancel manual entry")
                    : (lang === "tr" ? "+ Sistemde olmayan referans ekle" : "+ Add reference not in system")}
                </button>
              </div>

              {showManualRef && (
                <div style={{
                  padding: 12, marginTop: 12,
                  border: `1px solid ${border}`,
                  background: "var(--color-bg-primary)",
                }}>
                  <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
                              letterSpacing: "0.08em", color: textSecond, marginBottom: 4 }}>
                    {lang === "tr" ? "TÜR *" : "TYPE *"}
                  </p>
                  <select
                    value={manualRef.type}
                    onChange={(e) => setManualRef({ ...manualRef, type: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", marginBottom: 12,
                      border: `1px solid ${border}`, background: "var(--color-bg-primary)",
                      color: manualRef.type ? textPrimary : textSecond,
                      fontSize: 12, borderRadius: 0, boxSizing: "border-box" as const,
                      fontFamily: "var(--font-ui)" }}
                  >
                    <option value="" disabled>
                      {lang === "tr" ? "— Seçiniz —" : "— Select —"}
                    </option>
                    {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v[lang as "en" | "tr"]}</option>
                    ))}
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 4 }}>
                        {lang === "tr" ? "NUMARA *" : "NUMBER *"}
                      </p>
                      <input
                        value={manualRef.number}
                        onChange={(e) => setManualRef({ ...manualRef, number: e.target.value })}
                        style={{
                          width: "100%", padding: "8px 10px",
                          border: `1px solid ${border}`,
                          background: "var(--color-bg-primary)",
                          color: textPrimary,
                          fontSize: 12, borderRadius: 0,
                          boxSizing: "border-box" as const,
                          fontFamily: "var(--font-ui)",
                        }}
                      />
                    </div>
                    <div>
                      <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 4 }}>
                        {lang === "tr" ? "TARİH" : "DATE"}
                      </p>
                      <input
                        type="date"
                        value={manualRef.date}
                        onChange={(e) => setManualRef({ ...manualRef, date: e.target.value })}
                        style={{
                          width: "100%", padding: "8px 10px",
                          border: `1px solid ${border}`,
                          background: "var(--color-bg-primary)",
                          color: textPrimary,
                          fontSize: 12, borderRadius: 0,
                          boxSizing: "border-box" as const,
                          fontFamily: "var(--font-ui)",
                        }}
                      />
                    </div>
                  </div>
                  <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 4 }}>
                    {lang === "tr" ? "BAŞLIK" : "TITLE"}
                  </p>
                  <input
                    value={manualRef.title}
                    onChange={(e) => setManualRef({ ...manualRef, title: e.target.value })}
                    style={{
                      width: "100%", padding: "8px 10px", marginBottom: 12,
                      border: `1px solid ${border}`,
                      background: "var(--color-bg-primary)",
                      color: textPrimary,
                      fontSize: 12, borderRadius: 0,
                      boxSizing: "border-box" as const,
                      fontFamily: "var(--font-ui)",
                    }}
                  />
                  {manualRef.type === "other" && (
                    <>
                      <p style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
                                  letterSpacing: "0.08em", color: textSecond, marginBottom: 4 }}>
                        {lang === "tr" ? "TÜR KÜNYESİ" : "TYPE DESCRIPTION"}
                      </p>
                      <input
                        value={manualRef.note}
                        onChange={(e) => setManualRef({ ...manualRef, note: e.target.value })}
                        placeholder={lang === "tr" ? "ör. Toplantı Tutanağı, Saha Notu"
                                                   : "e.g. Meeting Minutes, Site Note"}
                        style={{ width: "100%", padding: "8px 10px", marginBottom: 12,
                          border: `1px solid ${border}`, background: "var(--color-bg-primary)",
                          color: textPrimary, fontSize: 12, borderRadius: 0,
                          boxSizing: "border-box" as const, fontFamily: "var(--font-ui)" }}
                      />
                    </>
                  )}
                  <button
                    onClick={addManualRef}
                    disabled={refSaving || !canAddManual}
                    style={{
                      fontSize: 11, padding: "6px 14px",
                      background: canAddManual ? "var(--color-accent)" : "var(--color-border-medium)",
                      color: canAddManual ? "var(--color-bg-primary)" : textSecond,
                      border: "none", borderRadius: 0,
                      cursor: refSaving || !canAddManual ? "not-allowed" : "pointer",
                      fontWeight: 500, fontFamily: "var(--font-ui)",
                      opacity: refSaving ? 0.6 : 1,
                    }}
                  >
                    {lang === "tr" ? "Referans Ekle" : "Add Reference"}
                  </button>
                </div>
              )}
            </div>

            <div style={{ background: cardBg, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: textSecond, marginBottom: 12, paddingBottom: 8, borderBottom: `0.5px solid ${border}` }}>
                {lang === "tr" ? `Ekli Belgeler (${attachmentRefs.length})` : `Attached Documents (${attachmentRefs.length})`}
              </div>
              {attachmentRefs.length === 0 ? (
                <p style={{ fontSize: 12, color: textSecond, fontStyle: "italic", margin: 0, fontFamily: "var(--font-ui)" }}>
                  {lang === "tr" ? "Belge eklenmemiş." : "No documents attached."}
                </p>
              ) : (
                attachmentRefs.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `0.5px solid ${border}` }}>
                    <div>
                      <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500, margin: 0 }}>{r.target_label}</p>
                      <p style={{ fontSize: 11, color: textSecond, marginTop: 2 }}>
                        {((r.file_size_bytes ?? 0) / 1024).toFixed(0)} KB
                        {parseStatusLabel(r.parse_status, lang) && (
                          <span style={{ color: "var(--color-alert-red)", fontSize: 11, fontFamily: "var(--font-ui)" }}>
                            · {parseStatusLabel(r.parse_status, lang)}
                          </span>
                        )}
                      </p>
                    </div>
                    <DocumentLink
                      projectId={projectId!}
                      docId={r.document_id!}
                      style={{ fontSize: 11, color: "var(--color-accent-text)", background: "none", border: "none", cursor: "pointer", fontWeight: 500, fontFamily: "var(--font-ui)", textDecoration: "none" }}
                    >
                      {lang === "tr" ? "Aç →" : "Open →"}
                    </DocumentLink>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 32, paddingTop: 16, borderTop: `0.5px solid ${border}` }}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/projects/${projectId}/workspace?module=rfis`)}
          >
            {lang === "tr" ? "← RFI Listesine Dön" : "← Back to RFIs"}
          </Button>
        </div>

        <div style={{
          display: "flex", justifyContent: "flex-end",
          marginTop: 24, marginBottom: 8,
        }}>
          <AiActionButton onClick={() => setShowRelations(true)}>
            {lang === "tr" ? "Benzerlik Tespit Edilen Kayıtlar" : "Related records"}
          </AiActionButton>
        </div>

        <ConfirmModal
          open={approveConfirmOpen}
          message={
            lang === "tr"
              ? "Bu RFI'yi onaylayip muhataba çıkarmak istiyor musunuz? Gönderim ve yanıt tarihleri onay anında atanır."
              : "Approve this RFI for submission? Submission and response dates will be set at approval."
          }
          confirmLabel={lang === "tr" ? "Onayla" : "Approve"}
          cancelLabel={lang === "tr" ? "İptal" : "Cancel"}
          onConfirm={handleApprove}
          onCancel={() => !approving && setApproveConfirmOpen(false)}
        />

        {flagOpen && (
          <div
            style={{ position: "fixed", inset: 0, backgroundColor: "var(--color-overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "var(--z-modal)" as unknown as number, padding: 24 }}
            onClick={() => !flagSubmitting && setFlagOpen(false)}
          >
            <div
              style={{ backgroundColor: cardBg, padding: 24, width: "100%", maxWidth: 520, border: `1px solid ${border}`, maxHeight: "90vh", overflowY: "auto" as const }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h2)", fontWeight: 500, color: textPrimary, margin: "0 0 8px" }}>
                {lang === "tr" ? "Potansiyel Etki Bildir" : "Flag Potential Impact"}
              </h2>
              <p style={{ fontSize: 12, color: textSecond, margin: "0 0 20px", lineHeight: 1.5 }}>
                {lang === "tr"
                  ? "İç aksiyon alerti oluşturulur. Seçilen kişi bilgilendirilir."
                  : "Creates an internal action alert. The assigned person will be notified."}
              </p>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                  {lang === "tr" ? "Açıklama *" : "Narrative *"}
                </label>
                <textarea
                  value={flagForm.narrative}
                  onChange={(e) => setFlagForm({ ...flagForm, narrative: e.target.value })}
                  rows={4}
                  placeholder={lang === "tr" ? "Potansiyel etkiyi açıklayın..." : "Describe the potential impact..."}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, fontFamily: "var(--font-ui)", resize: "vertical" as const, boxSizing: "border-box" as const }}
                />
              </div>

              {noticeConfigs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                    {lang === "tr" ? "Potansiyel Sözleşme Maddesi (Opsiyonel)" : "Potential Contractual Trigger (Optional)"}
                  </label>
                  <select
                    value={flagForm.notice_config_id}
                    onChange={(e) => setFlagForm({ ...flagForm, notice_config_id: e.target.value })}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, fontFamily: "var(--font-ui)" }}
                  >
                    <option value="">{lang === "tr" ? "— Seçiniz —" : "— Select —"}</option>
                    {noticeConfigs.map((c) => (
                      <option key={c.id} value={c.id}>{c.label} ({c.notice_period_days}d)</option>
                    ))}
                  </select>
                </div>
              )}

              {attachmentRefs.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                    {lang === "tr" ? "İlgili Belgeler (Opsiyonel)" : "Related Documents (Optional)"}
                  </label>
                  <div style={{ border: `1px solid ${border}`, padding: "8px 10px", backgroundColor: "var(--color-bg-primary)" }}>
                    {attachmentRefs.map((r) => (
                      <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={flagForm.document_references.includes(r.document_id)}
                          onChange={(e) => {
                            const refs = e.target.checked
                              ? [...flagForm.document_references, r.document_id]
                              : flagForm.document_references.filter((id) => id !== r.document_id);
                            setFlagForm({ ...flagForm, document_references: refs });
                          }}
                        />
                        <span style={{ fontSize: 12, color: textPrimary, fontFamily: "var(--font-ui)" }}>{r.target_label}</span>
                        {parseStatusLabel(r.parse_status, lang) && (
                          <span style={{ color: "var(--color-alert-red)", fontSize: 11, fontFamily: "var(--font-ui)", marginLeft: "auto" }}>
                            {parseStatusLabel(r.parse_status, lang)}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                  {lang === "tr" ? "Yeni Dosya Ekle (Opsiyonel)" : "Add New File (Optional)"}
                </label>
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg,.dwg,.dxf"
                  onChange={(e) => setFlagForm({ ...flagForm, newFile: e.target.files?.[0] || null })}
                  style={{ fontSize: 12, color: textPrimary, fontFamily: "var(--font-ui)" }}
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", color: textSecond, marginBottom: 8 }}>
                  {lang === "tr" ? "Bildir" : "Notify"}
                </label>
                <select
                  value={flagForm.assigned_to_user}
                  onChange={(e) => setFlagForm({ ...flagForm, assigned_to_user: e.target.value })}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, color: textPrimary, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, fontFamily: "var(--font-ui)" }}
                >
                  <option value="">{lang === "tr" ? "— Tüm Ekip —" : "— Entire Team —"}</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.full_name} ({m.project_role})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => { setFlagOpen(false); setFlagForm({ narrative: "", notice_config_id: "", assigned_to_user: "", document_references: [], newFile: null }); }}
                  disabled={flagSubmitting}
                >
                  {lang === "tr" ? "İptal" : "Cancel"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={flagSubmitting || !flagForm.narrative.trim()}
                  loading={flagSubmitting}
                  loadingText={lang === "tr" ? "Gönderiliyor…" : "Submitting…"}
                  onClick={async () => {
                    if (!projectId || !rfi) return;
                    setFlagSubmitting(true);
                    try {
                      const res = await api.post<{ id: string }>(`/projects/${projectId}/alerts`, {
                        alert_type: "potential_impact",
                        source_entity_type: "rfi",
                        source_entity_id: rfi.id,
                        narrative: flagForm.narrative,
                        notice_config_id: flagForm.notice_config_id || undefined,
                        assigned_to_user: flagForm.assigned_to_user || undefined,
                        document_references: flagForm.document_references.length > 0
                          ? flagForm.document_references : undefined,
                      });
                      if (flagForm.newFile && res?.id) {
                        const fd = new FormData();
                        fd.append("file", flagForm.newFile);
                        await api.postForm(
                          `/projects/${projectId}/documents/upload?entity_type=internal_alert&entity_id=${res.id}`,
                          fd
                        );
                      }
                      setFlagOpen(false);
                      setFlagForm({ narrative: "", notice_config_id: "", assigned_to_user: "", document_references: [], newFile: null });
                    } catch {
                      /* silent */
                    } finally {
                      setFlagSubmitting(false);
                    }
                  }}
                >
                  {lang === "tr" ? "Flag Olarak İşaretle" : "Flag as Potential Impact"}
                </Button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
