import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useDebounce } from "../hooks/useDebounce";
import { api } from "../services/api";
import ThemeToggle from "../components/ThemeToggle";
import { getAuth, clearAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";
import AlertsModule from "../components/AlertsModule";
import ChronologiesModule from "../components/ChronologiesModule";
import DocumentsModule from "../components/DocumentsModule";

type Module = "general" | "alerts" | "correspondence" | "rfis" | "changes" | "deliverables" | "chronologies" | "documents" | "config";

interface SearchResult { module: string; label: string; ref: string; subject: string; status: string; date: string; id: string; parent_id?: string | null; has_response?: boolean; rfi_type?: string; }
interface CorrItem { id: string; corr_number: string; subject: string; type: string; status: string; correspondence_date: string; direction: string; response_due_date: string | null; parent_id: string | null; has_response: boolean; }
interface RFIItem { id: string; rfi_number: string; subject: string; status: string; submitted_date: string; response_due_date: string | null; discipline: string | null; parent_id: string | null; rfi_type: string; }
interface ChangeItem { id: string; change_number: string; title: string; status: string; origin: string; notice_due_date: string | null; created_at: string; }
interface DeliverableItem { id: string; title: string; status: string; due_date: string | null; category: string | null; is_pre_completion: boolean; }

const MODULE_LABELS: Record<Module, string> = {
  general: "General", alerts: "Alerts & Actions",
  correspondence: "Correspondence", rfis: "RFIs",
  changes: "Changes", deliverables: "Deliverables", chronologies: "Chronologies",
  documents: "Documents", config: "Config",
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:         { bg: "var(--color-warning-bg)",   text: "var(--color-warning)" },
  draft:        { bg: "var(--color-bg-secondary)",  text: "var(--color-text-secondary)" },
  overdue:      { bg: "var(--color-alert-red-bg)",  text: "var(--color-alert-red)" },
  closed:       { bg: "var(--color-success-bg)",    text: "var(--color-success)" },
  approved:     { bg: "var(--color-success-bg)",    text: "var(--color-success)" },
  rejected:     { bg: "var(--color-alert-red-bg)",  text: "var(--color-alert-red)" },
  published:    { bg: "var(--color-success-bg)",    text: "var(--color-success)" },
  under_review: { bg: "var(--color-warning-bg)",    text: "var(--color-warning)" },
  pending:      { bg: "var(--color-warning-bg)",    text: "var(--color-warning)" },
  in_progress:  { bg: "var(--color-success-bg)",    text: "var(--color-success)" },
  responded:    { bg: "var(--color-success-bg)",    text: "var(--color-success)" },
};

const dateInRange = (dateStr: string | null | undefined, from: string, to: string): boolean => {
  if (!dateStr) return true;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

export default function Workspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const auth = getAuth();
  const { lang, toggle: toggleLang, t } = useLanguage();
  const location = useLocation();

  const [activeModule, setActiveModule] = useState<Module>(() => {
    const params = new URLSearchParams(location.search);
    const m = params.get("module") as Module | null;
    const valid: Module[] = ["general", "alerts", "correspondence", "rfis", "changes", "deliverables", "chronologies", "documents", "config"];
    return m && valid.includes(m) ? m : "general";
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const m = params.get("module") as Module | null;
    const valid: Module[] = ["general", "alerts", "correspondence", "rfis", "changes", "deliverables", "chronologies", "documents", "config"];
    if (m && valid.includes(m)) {
      setActiveModule(m);
    }
  }, [location.search]);
  const [projectName, setProjectName] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 400);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [genModFilter, setGenModFilter] = useState("");
  const [genStatusFilter, setGenStatusFilter] = useState("");
  const [genDateFrom, setGenDateFrom] = useState("");
  const [genDateTo, setGenDateTo] = useState("");
  const [genDateField, setGenDateField] = useState<"date" | "due_date">("date");

  const [corrs, setCorrs] = useState<CorrItem[]>([]);
  const [alertCount, setAlertCount] = useState<number>(0);
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrKeyword, setCorrKeyword] = useState("");
  const debouncedCorrKeyword = useDebounce(corrKeyword, corrKeyword.trim() ? 400 : 0);
  const [corrStatus, setCorrStatus] = useState("");
  const [corrDir, setCorrDir] = useState("");
  const [corrDateFrom, setCorrDateFrom] = useState("");
  const [corrDateTo, setCorrDateTo] = useState("");
  const [corrDateField, setCorrDateField] = useState<"correspondence_date" | "response_due_date">("correspondence_date");

  const [rfis, setRfis] = useState<RFIItem[]>([]);
  const [rfiLoading, setRfiLoading] = useState(false);
  const [rfiKeyword, setRfiKeyword] = useState("");
  const debouncedRfiKeyword = useDebounce(rfiKeyword, rfiKeyword.trim() ? 400 : 0);
  const [rfiStatus, setRfiStatus] = useState("");
  const [rfiDiscipline, setRfiDiscipline] = useState("");
  const [rfiDateFrom, setRfiDateFrom] = useState("");
  const [rfiDateTo, setRfiDateTo] = useState("");
  const [corrDropdown, setCorrDropdown] = useState(false);
  const [rfiDropdown, setRfiDropdown] = useState(false);
  const [rfiDateField, setRfiDateField] = useState<"submitted_date" | "response_due_date">("submitted_date");

  const [changes, setChanges] = useState<ChangeItem[]>([]);
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeKeyword, setChangeKeyword] = useState("");
  const [changeStatus, setChangeStatus] = useState("");
  const [changeOrigin, setChangeOrigin] = useState("");
  const [changeDateFrom, setChangeDateFrom] = useState("");
  const [changeDateTo, setChangeDateTo] = useState("");
  const [changeDateField, setChangeDateField] = useState<"created_at" | "notice_due_date">("created_at");

  const [deliverables, setDeliverables] = useState<DeliverableItem[]>([]);
  const [delivLoading, setDelivLoading] = useState(false);
  const [delivKeyword, setDelivKeyword] = useState("");
  const [delivStatus, setDelivStatus] = useState("");
  const [delivDateFrom, setDelivDateFrom] = useState("");
  const [delivDateTo, setDelivDateTo] = useState("");

  const bg          = "var(--color-bg-primary)";
  const cardBg      = "var(--color-bg-secondary)";
  const border      = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecondary = "var(--color-text-secondary)";

  const inputStyle: React.CSSProperties = {
    background: cardBg, border: `0.5px solid ${border}`, color: textPrimary,
    fontSize: 11, fontFamily: "Inter, sans-serif", padding: "5px 8px",
    borderRadius: 0, outline: "none", height: 28,
  };

  useEffect(() => {
    if (!projectId) return;
    api.get<{ name: string }>(`/projects/${projectId}`).then((p) => setProjectName(p.name)).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    api.get<{ count: number }>(`/projects/${projectId}/alerts/count`)
      .then((r) => setAlertCount(r.count))
      .catch(() => {});
  }, [projectId]);

  const handleSearch = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const res = await api.get<{ query: string; results: SearchResult[] }>(
        `/projects/${projectId}/search?q=${encodeURIComponent(q)}`
      );
      setSearchResults(res.results);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [projectId]);

  useEffect(() => {
    setSearchQuery("");
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    handleSearch(debouncedSearchQuery);
  }, [projectId, debouncedSearchQuery, handleSearch]);

  // Debounced backend search — replaces client-side filtering.
  useEffect(() => {
    if (activeModule !== "correspondence") return;
    setCorrLoading(true);
    let url = `/projects/${projectId}/correspondences?limit=100`;
    if (corrStatus) url += `&status=${corrStatus}`;
    if (corrDir) url += `&direction=${corrDir}`;
    if (debouncedCorrKeyword.trim()) url += `&q=${encodeURIComponent(debouncedCorrKeyword.trim())}`;
    api.get<CorrItem[]>(url).then(setCorrs).catch(() => setCorrs([])).finally(() => setCorrLoading(false));
  }, [activeModule, projectId, corrStatus, corrDir, debouncedCorrKeyword]);

  // Debounced backend search — replaces client-side filtering.
  // q present → chain-aware RPC (search_rfi_chains).
  // q absent → standard list with status/discipline filters.
  useEffect(() => {
    if (activeModule !== "rfis") return;
    setRfiLoading(true);
    let url = `/projects/${projectId}/rfis?limit=100`;
    if (rfiStatus) url += `&status=${rfiStatus}`;
    if (rfiDiscipline) url += `&discipline=${rfiDiscipline}`;
    if (debouncedRfiKeyword.trim()) url += `&q=${encodeURIComponent(debouncedRfiKeyword.trim())}`;
    api.get<RFIItem[]>(url).then(setRfis).catch(() => setRfis([])).finally(() => setRfiLoading(false));
  }, [activeModule, projectId, rfiStatus, rfiDiscipline, debouncedRfiKeyword]);

  useEffect(() => {
    if (activeModule !== "changes") return;
    setChangeLoading(true);
    let url = `/projects/${projectId}/changes?limit=100`;
    if (changeStatus) url += `&status=${changeStatus}`;
    if (changeOrigin) url += `&origin=${changeOrigin}`;
    api.get<ChangeItem[]>(url).then(setChanges).catch(() => setChanges([])).finally(() => setChangeLoading(false));
  }, [activeModule, projectId, changeStatus, changeOrigin]);

  useEffect(() => {
    if (activeModule !== "deliverables") return;
    setDelivLoading(true);
    let url = `/projects/${projectId}/deliverables?limit=100`;
    if (delivStatus) url += `&status=${delivStatus}`;
    api.get<DeliverableItem[]>(url).then(setDeliverables).catch(() => setDeliverables([])).finally(() => setDelivLoading(false));
  }, [activeModule, projectId, delivStatus]);

  const handleLogout = () => { clearAuth(); navigate("/login"); };

  const statusPill = (status: string) => {
    const c = STATUS_COLORS[status] ?? { bg: "var(--color-bg-secondary)", text: "var(--color-text-secondary)" };
    return <span style={{ background: c.bg, color: c.text, fontSize: 10, fontWeight: 500, padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{status}</span>;
  };

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick} style={{ padding: "4px 10px", border: `0.5px solid ${active ? "var(--color-accent)" : border}`, fontSize: 11, color: active ? "var(--color-bg-primary)" : textSecondary, background: active ? "var(--color-accent)" : cardBg, cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}>
      {label}
    </button>
  );

  const dateRange = (label: string, from: string, to: string, onFrom: (v: string) => void, onTo: (v: string) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 10, color: textSecondary, whiteSpace: "nowrap" }}>{label}:</span>
      <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} style={inputStyle} />
      <span style={{ fontSize: 10, color: textSecondary }}>—</span>
      <input type="date" value={to} onChange={(e) => onTo(e.target.value)} style={inputStyle} />
      {(from || to) && <button onClick={() => { onFrom(""); onTo(""); }} style={{ fontSize: 11, color: textSecondary, background: "none", border: "none", cursor: "pointer" }}>✕</button>}
    </div>
  );

  const keywordSearch = (value: string, onChange: (v: string) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: cardBg, border: `0.5px solid ${border}`, padding: "5px 10px", maxWidth: 280 }}>
      <span style={{ color: textSecondary, fontSize: 13 }}>⌕</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("filter.search")} style={{ background: "none", border: "none", outline: "none", fontSize: 12, color: textPrimary, fontFamily: "Inter, sans-serif", width: "100%" }} />
      {value && <button onClick={() => onChange("")} style={{ fontSize: 11, color: textSecondary, background: "none", border: "none", cursor: "pointer" }}>✕</button>}
    </div>
  );

  const filterRow = (...children: React.ReactNode[]) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
  );

  const moduleHeader = (title: string, onNew?: () => void, newLabel?: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <div style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 20, color: textPrimary, fontWeight: 500 }}>{title}</div>
      {onNew && <button onClick={onNew} style={{ background: "var(--color-accent)", color: "var(--color-bg-primary)", border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 500, letterSpacing: "0.5px", cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}>{newLabel}</button>}
    </div>
  );

  const listHeader = (cols: { label: string; width: string }[]) => (
    <div style={{ display: "grid", gridTemplateColumns: cols.map(c => c.width).join(" "), gap: 8, padding: "6px 12px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: textSecondary, borderBottom: `0.5px solid ${border}` }}>
      {cols.map(c => <span key={c.label}>{c.label}</span>)}
    </div>
  );

  const today = new Date().toISOString().slice(0, 10);

  // Keyword matching now happens server-side (search_correspondence_chains RPC).
  const filteredCorrs = corrs.filter((c) =>
    dateInRange(corrDateField === "correspondence_date" ? c.correspondence_date : c.response_due_date, corrDateFrom, corrDateTo)
  );

  // Keyword matching now happens server-side (search_rfi_chains RPC).
  // Only date-range filtering remains client-side.
  const filteredRfis = rfis.filter((r) =>
    dateInRange(
      rfiDateField === "submitted_date" ? r.submitted_date : r.response_due_date,
      rfiDateFrom,
      rfiDateTo
    )
  );

  const filteredChanges = changes.filter((c) =>
    (!changeKeyword || c.title.toLowerCase().includes(changeKeyword.toLowerCase()) || c.change_number.toLowerCase().includes(changeKeyword.toLowerCase())) &&
    dateInRange(changeDateField === "created_at" ? c.created_at : c.notice_due_date, changeDateFrom, changeDateTo)
  );

  const filteredDeliverables = deliverables.filter((d) =>
    (!delivKeyword || d.title.toLowerCase().includes(delivKeyword.toLowerCase())) &&
    dateInRange(d.due_date, delivDateFrom, delivDateTo)
  );

  const filteredGeneral = searchResults.filter((r) =>
    (!genModFilter || r.module === genModFilter) &&
    (!genStatusFilter || r.status === genStatusFilter) &&
    dateInRange(genDateField === "date" ? r.date : r.date, genDateFrom, genDateTo)
  );

  const SIDEBAR_MAIN: Module[] = ["general", "alerts", "correspondence", "rfis", "changes", "deliverables", "chronologies"];
  const SIDEBAR_SYS: Module[] = ["documents", "config"];

  const generalNavTarget = (mod: string, id: string) => {
    if (mod === "correspondence") return `/projects/${projectId}/workspace/correspondence/${id}`;
    if (mod === "rfi") return `/projects/${projectId}/workspace/rfis/${id}`;
    if (mod === "change") return `/projects/${projectId}/workspace/changes/${id}`;
    if (mod === "deliverable") return `/projects/${projectId}/workspace/deliverables/${id}`;
    return `/projects/${projectId}/workspace`;
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", flexDirection: "column" }}>
      <nav style={{ backgroundColor: bg, borderBottom: `0.5px solid ${border}`, padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecondary }}>
          <div style={{ width: 2, height: 20, background: "linear-gradient(to bottom, transparent, var(--color-accent) 20%, var(--color-accent) 80%, transparent)" }} />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{projectName || t("nav.overview")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>{t("nav.workspace")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecondary }}>
          <span>{auth?.full_name}</span>
          <button onClick={toggleLang} style={{ background: "none", border: `1px solid ${border}`, cursor: "pointer", fontSize: 11, color: textSecondary, padding: "2px 8px", fontFamily: "JetBrains Mono, monospace", fontWeight: 500, letterSpacing: "0.5px" }}>
            {lang === "en" ? "TR" : "EN"}
          </button>
          <ThemeToggle />
          <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecondary }}>{t("nav.signout")}</button>
        </div>
      </nav>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <aside style={{ width: 200, backgroundColor: bg, borderRight: `0.5px solid ${border}`, padding: "16px 0", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 16px 12px", borderBottom: `0.5px solid ${border}`, marginBottom: 8 }}>
            <div style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 12, color: textPrimary, fontWeight: 500, lineHeight: 1.3 }}>{projectName}</div>
            <div style={{ fontSize: 10, color: textSecondary, marginTop: 2 }}>{t("nav.workspace")}</div>
          </div>
          {SIDEBAR_MAIN.map((mod) => (
            <button
              key={mod}
              onClick={() => {
                setActiveModule(mod);
              }}
              style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between",
                width: "100%", textAlign: "left" as const,
                padding: mod === "general" ? "9px 16px" : "7px 16px",
                fontSize: mod === "general" ? 13 : 12,
                fontWeight: activeModule === mod ? 500 : 400,
                fontFamily: "Inter, sans-serif",
                background: activeModule === mod ? cardBg : "none",
                borderLeft: activeModule === mod ? `3px solid ${"var(--color-accent)"}` : "3px solid transparent",
                border: "none", cursor: "pointer",
                color: activeModule === mod ? textPrimary : textSecondary,
              }}
            >
              <span>{MODULE_LABELS[mod]}</span>
              {mod === "alerts" && alertCount > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 500,
                  backgroundColor: "var(--color-alert-red)",
                  color: "var(--color-bg-primary)",
                  borderRadius: "50%",
                  padding: "1px 6px",
                  minWidth: 16,
                  textAlign: "center" as const,
                }}>
                  {alertCount}
                </span>
              )}
            </button>
          ))}
          <div style={{ height: "0.5px", background: border, margin: "8px 16px" }} />
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: textSecondary, padding: "4px 16px" }}>System</div>
          {SIDEBAR_SYS.map((mod) => (
            <button key={mod} onClick={() => setActiveModule(mod)} style={{ display: "flex", alignItems: "center", padding: "7px 16px", fontSize: 12, fontWeight: activeModule === mod ? 500 : 400, color: activeModule === mod ? textPrimary : textSecondary, background: activeModule === mod ? cardBg : "none", border: "none", borderLeft: activeModule === mod ? `3px solid ${"var(--color-accent)"}` : "3px solid transparent", cursor: "pointer", width: "100%", textAlign: "left", fontFamily: "Inter, sans-serif" }}>
              {MODULE_LABELS[mod]}
            </button>
          ))}
        </aside>

        <main style={{ flex: 1, padding: 24, overflowY: "auto", backgroundColor: bg }}>

          {/* GENERAL */}
          {activeModule === "general" && (
            <div>
              {moduleHeader(t("general.title"))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: cardBg, border: "1px solid var(--color-border-light)", padding: "10px 14px", maxWidth: 560, marginBottom: 16 }}>
                <span style={{ color: textSecondary, fontSize: 16 }}>⌕</span>
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t("general.placeholder")} style={{ background: "none", border: "none", outline: "none", fontSize: 13, color: textPrimary, fontFamily: "Inter, sans-serif", width: "100%" }} />
                {searching && <span style={{ fontSize: 11, color: textSecondary }}>{t("general.searching")}</span>}
                {searchQuery && <button onClick={() => { setSearchQuery(""); handleSearch(""); }} style={{ fontSize: 11, color: textSecondary, background: "none", border: "none", cursor: "pointer" }}>✕</button>}
              </div>
              {filterRow(
                ...["", "correspondence", "rfi", "change", "deliverable"].map((m) => chip(m === "" ? t("filter.all") : m === "rfi" ? "RFIs" : m === "change" ? "Changes" : m === "deliverable" ? "Deliverables" : "Correspondence", genModFilter === m, () => setGenModFilter(m))),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "open", "draft", "under_review", "approved", "published", "closed", "overdue"].map((s) => chip(s === "" ? t("filter.allstatus") : s.replace("_", " "), genStatusFilter === s, () => setGenStatusFilter(s)))
              )}
              {filterRow(
                chip(t("filter.issuedate"), genDateField === "date", () => setGenDateField("date")),
                chip(t("filter.duedate"), genDateField === "due_date", () => setGenDateField("due_date")),
                <div key="gdiv" style={{ width: "0.5px", background: border, height: 20 }} />,
                dateRange(genDateField === "date" ? t("filter.issuedate") : t("filter.duedate"), genDateFrom, genDateTo, setGenDateFrom, setGenDateTo)
              )}
              {searching && <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p>}
              {!searching && filteredGeneral.length === 0 && <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("general.noresults")}</p>}
              {["correspondence", "rfi", "change", "deliverable"].map((mod) => {
                const group = filteredGeneral.filter((r) => r.module === mod);
                if (group.length === 0) return null;
                const label = mod === "correspondence" ? "Correspondence" : mod === "rfi" ? "RFIs" : mod === "change" ? "Changes" : "Deliverables";

                // Correspondence — parent-child gruplama
                if (mod === "correspondence") {
                  const corrChildMap = new Map<string, SearchResult[]>();
                  group.filter(r => r.parent_id).forEach(r => {
                    const arr = corrChildMap.get(r.parent_id!) ?? [];
                    arr.push(r);
                    corrChildMap.set(r.parent_id!, arr);
                  });
                  const corrParents = group.filter(r => !r.parent_id);
                  const renderCorrRow = (r: SearchResult, isChild = false) => (
                    <div key={r.id}>
                      <div
                        onClick={() => navigate(generalNavTarget(mod, r.id))}
                        style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between",
                          padding: isChild ? "7px 12px 7px 28px" : "9px 12px",
                          background: isChild ? "var(--color-bg-primary)" : cardBg,
                          marginBottom: 2, cursor: "pointer",
                          borderLeft: `2px solid ${isChild ? "var(--color-accent)" : r.status === "responded" ? ("var(--color-success)") : "var(--color-accent)"}`,
                        }}
                      >
                        <div>
                          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecondary, display: "flex", alignItems: "center", gap: 3 }}>
                            {isChild && <span style={{ color: "var(--color-accent)", marginRight: 2 }}>└</span>}
                            {r.ref}
                            {r.has_response && <span style={{ fontSize: 11, color: "var(--color-accent)" }}>↩</span>}
                          </span>
                          <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{r.subject}</p>
                          <p style={{ fontSize: 10, color: textSecondary, marginTop: 1 }}>{r.date}</p>
                        </div>
                        {statusPill(r.status)}
                      </div>
                      {(corrChildMap.get(r.id) ?? []).map(child => renderCorrRow(child, true))}
                    </div>
                  );
                  return (
                    <div key={mod} style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: textSecondary, marginBottom: 8 }}>{label}</div>
                      {corrParents.map(r => renderCorrRow(r, false))}
                      {/* Orphan children — parent search sonucunda yok */}
                      {group.filter(r => r.parent_id && !group.find(p => p.id === r.parent_id)).map(r => renderCorrRow(r, false))}
                    </div>
                  );
                }

                // RFI — parent-child gruplama
                if (mod === "rfi") {
                  const rfiSChildMap = new Map<string, SearchResult[]>();
                  group.filter(r => r.parent_id).forEach(r => {
                    const arr = rfiSChildMap.get(r.parent_id!) ?? [];
                    arr.push(r);
                    rfiSChildMap.set(r.parent_id!, arr);
                  });
                  const rfiSParents = group.filter(r => !r.parent_id);
                  const renderRfiRow = (r: SearchResult, isChild = false) => (
                    <div key={r.id}>
                      <div
                        onClick={() => navigate(generalNavTarget(mod, r.id))}
                        style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between",
                          padding: isChild ? "7px 12px 7px 28px" : "9px 12px",
                          background: isChild ? "var(--color-bg-primary)" : cardBg,
                          marginBottom: 2, cursor: "pointer",
                          borderLeft: `2px solid ${isChild ? "var(--color-accent)" : r.status === "responded" ? ("var(--color-success)") : "var(--color-accent)"}`,
                        }}
                      >
                        <div>
                          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecondary, display: "flex", alignItems: "center", gap: 3 }}>
                            {isChild && <span style={{ color: "var(--color-accent)", marginRight: 2 }}>└</span>}
                            {r.ref}
                            {r.rfi_type && r.rfi_type !== "original" && (
                              <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 4px", backgroundColor: r.rfi_type === "response" ? "var(--color-success-bg)" : "var(--color-bg-secondary)", color: r.rfi_type === "response" ? "var(--color-success)" : "var(--color-text-secondary)", textTransform: "uppercase" as const }}>
                                {r.rfi_type === "response" ? (lang === "tr" ? "YNT" : "RES") : (lang === "tr" ? "REV" : "REV")}
                              </span>
                            )}
                          </span>
                          <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{r.subject}</p>
                          <p style={{ fontSize: 10, color: textSecondary, marginTop: 1 }}>{r.date}</p>
                        </div>
                        {r.rfi_type === "response"
                          ? <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", backgroundColor: "var(--color-success-bg)", color: "var(--color-success)", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>RESPONSE</span>
                          : statusPill(r.status)}
                      </div>
                      {(rfiSChildMap.get(r.id) ?? []).map(child => renderRfiRow(child, true))}
                    </div>
                  );
                  return (
                    <div key={mod} style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: textSecondary, marginBottom: 8 }}>{label}</div>
                      {rfiSParents.map(r => renderRfiRow(r, false))}
                      {group.filter(r => r.parent_id && !group.find(p => p.id === r.parent_id)).map(r => renderRfiRow(r, false))}
                    </div>
                  );
                }

                // Diğer modüller — düz liste
                return (
                  <div key={mod} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: textSecondary, marginBottom: 8 }}>{label}</div>
                    {group.map((r) => (
                      <div key={r.id} onClick={() => navigate(generalNavTarget(mod, r.id))} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: cardBg, marginBottom: 3, borderLeft: `2px solid ${"var(--color-accent)"}`, cursor: "pointer" }}>
                        <div>
                          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecondary }}>{r.ref}</span>
                          <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{r.subject}</p>
                          <p style={{ fontSize: 10, color: textSecondary, marginTop: 1 }}>{r.date}</p>
                        </div>
                        {statusPill(r.status)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* CORRESPONDENCE */}
          {activeModule === "correspondence" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, position: "relative" as const }}>
                <div style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 20, color: textPrimary, fontWeight: 500 }}>Correspondence</div>
                <div style={{ position: "relative" as const }}>
                  <button onClick={() => setCorrDropdown(!corrDropdown)} style={{ background: "var(--color-accent)", color: "var(--color-bg-primary)", border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 500, letterSpacing: "0.5px", cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}>
                    {t("action.newcorrespondence")} ▾
                  </button>
                  {corrDropdown && (
                    <div style={{ position: "absolute" as const, right: 0, top: "100%", zIndex: "var(--z-dropdown)" as unknown as number, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, minWidth: 200, marginTop: 2 }}>
                      <button onClick={() => { setCorrDropdown(false); navigate(`/projects/${projectId}/workspace/correspondence/new?mode=new`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
                        {lang === "tr" ? "Yeni Yazışma" : "New Correspondence"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {filterRow(
                keywordSearch(corrKeyword, setCorrKeyword),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "incoming", "outgoing"].map((d) => chip(d === "" ? t("filter.alldirections") : d === "incoming" ? t("filter.incoming") : t("filter.outgoing"), corrDir === d, () => setCorrDir(d)))
              )}
              {filterRow(...["", "open", "responded", "draft", "under_review", "approved", "published", "closed", "overdue"].map((s) => chip(s === "" ? t("filter.all") : s.replace("_", " "), corrStatus === s, () => setCorrStatus(s))))}
              {filterRow(
                chip(t("filter.issuedate"), corrDateField === "correspondence_date", () => setCorrDateField("correspondence_date")),
                chip(t("filter.duedate"), corrDateField === "response_due_date", () => setCorrDateField("response_due_date")),
                <div key="cdiv" style={{ width: "0.5px", background: border, height: 20 }} />,
                dateRange(corrDateField === "correspondence_date" ? t("filter.issuedate") : t("filter.duedate"), corrDateFrom, corrDateTo, setCorrDateFrom, setCorrDateTo)
              )}
              {corrLoading ? <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p> : filteredCorrs.length === 0 ? <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.nocorrespondence")}</p> : (() => {
                // Parent-child gruplama
                const allIds = new Set(filteredCorrs.map(c => c.id));
                const childIds = new Set(filteredCorrs.filter(c => c.parent_id).map(c => c.id));
                
                // Filtrelenmiş listede child varsa parent'ı da dahil et (ghost parent)
                const ghostParents = corrs.filter(c => 
                  !allIds.has(c.id) && 
                  filteredCorrs.some(fc => fc.parent_id === c.id)
                );
                
                const allCorrs = [...ghostParents, ...filteredCorrs];
                const parents = allCorrs.filter(c => !c.parent_id);
                const childMap = new Map<string, typeof filteredCorrs>();
                allCorrs.filter(c => c.parent_id).forEach(c => {
                  const arr = childMap.get(c.parent_id!) ?? [];
                  arr.push(c);
                  childMap.set(c.parent_id!, arr);
                });

                const corrRow = (c: CorrItem, isChild = false) => (
                  <div key={c.id}>
                    <div
                      onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${c.id}`)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "90px 1fr 90px 90px 90px 90px",
                        gap: 8,
                        padding: isChild ? "7px 12px 7px 28px" : "9px 12px",
                        background: isChild ? "var(--color-bg-primary)" : cardBg,
                        marginBottom: 2,
                        cursor: "pointer",
                        borderLeft: isChild
                          ? `2px solid ${"var(--color-accent)"}`
                          : `2px solid ${c.status === "overdue" ? "var(--color-alert-red)" : c.status === "open" ? "var(--color-accent)" : c.status === "responded" ? ("var(--color-success)") : "transparent"}`,
                      }}
                    >
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: isChild ? 9 : 10, color: textSecondary, display: "flex", alignItems: "center", gap: 3 }}>
                        {isChild && <span style={{ color: "var(--color-accent)", marginRight: 2 }}>└</span>}
                        {c.corr_number}
                        {c.has_response && <span style={{ fontSize: 11, color: "var(--color-accent)" }}>🔗</span>}
                      </span>
                      <div>
                        <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500, margin: 0 }}>{c.subject}</p>
                        <p style={{ fontSize: 10, color: textSecondary, marginTop: 1 }}>{c.type}</p>
                      </div>
                      <span style={{ fontSize: 11, color: textSecondary, textTransform: "capitalize" as const }}>{c.direction}</span>
                      <span style={{ fontSize: 11, color: textSecondary }}>{c.correspondence_date?.slice(0, 10)}</span>
                      <span style={{ fontSize: 11, color: c.response_due_date && c.response_due_date < today ? "var(--color-alert-red)" : textSecondary }}>{c.response_due_date?.slice(0, 10) ?? "—"}</span>
                      {statusPill(c.status)}
                    </div>
                    {/* Children */}
                    {(childMap.get(c.id) ?? []).map(child => corrRow(child, true))}
                  </div>
                );

                return (
                  <div>
                    {listHeader([{ label: t("col.no"), width: "90px" }, { label: t("col.subject"), width: "1fr" }, { label: t("col.direction"), width: "90px" }, { label: t("col.date"), width: "90px" }, { label: t("col.deadline"), width: "90px" }, { label: t("col.status"), width: "90px" }])}
                    {parents.map(c => corrRow(c, false))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* RFIs */}
          {activeModule === "rfis" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, position: "relative" as const }}>
                <div style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 20, color: textPrimary, fontWeight: 500 }}>RFIs</div>
                <div style={{ position: "relative" as const }}>
                  <button onClick={() => setRfiDropdown(!rfiDropdown)} style={{ background: "var(--color-accent)", color: "var(--color-bg-primary)", border: "none", padding: "8px 16px", fontSize: 12, fontWeight: 500, letterSpacing: "0.5px", cursor: "pointer", borderRadius: 0, fontFamily: "Inter, sans-serif" }}>
                    {t("action.newrfi")} ▾
                  </button>
                  {rfiDropdown && (
                    <div style={{ position: "absolute" as const, right: 0, top: "100%", zIndex: "var(--z-dropdown)" as unknown as number, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, minWidth: 200, marginTop: 2 }}>
                      <button onClick={() => { setRfiDropdown(false); navigate(`/projects/${projectId}/workspace/rfis/new?mode=new`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "Inter, sans-serif", borderBottom: `0.5px solid ${border}` }}>
                        {lang === "tr" ? "Yeni RFI" : "New RFI"}
                      </button>
                      <button onClick={() => { setRfiDropdown(false); navigate(`/projects/${projectId}/workspace/rfis/new?mode=response`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "Inter, sans-serif", borderBottom: `0.5px solid ${border}` }}>
                        {lang === "tr" ? "↩ Yanıt Ekle" : "↩ Add Response"}
                      </button>
                      <button onClick={() => { setRfiDropdown(false); navigate(`/projects/${projectId}/workspace/rfis/new?mode=revision`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
                        {lang === "tr" ? "↺ Revize Ekle" : "↺ Add Revision"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {filterRow(
                keywordSearch(rfiKeyword, setRfiKeyword),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "open", "overdue", "responded", "closed"].map((s) => chip(s === "" ? t("filter.all") : s, rfiStatus === s, () => setRfiStatus(s)))
              )}
              {filterRow(...["", "Civil", "Architectural", "Structural", "Mechanical", "Electrical", "Plumbing", "Other"].map((d) => chip(d === "" ? t("filter.alldisciplines") : d, rfiDiscipline === d, () => setRfiDiscipline(d))))}
              {filterRow(
                chip(t("filter.submitteddate"), rfiDateField === "submitted_date", () => setRfiDateField("submitted_date")),
                chip(t("filter.duedate"), rfiDateField === "response_due_date", () => setRfiDateField("response_due_date")),
                <div key="rdiv" style={{ width: "0.5px", background: border, height: 20 }} />,
                dateRange(rfiDateField === "submitted_date" ? t("filter.submitteddate") : t("filter.duedate"), rfiDateFrom, rfiDateTo, setRfiDateFrom, setRfiDateTo)
              )}
              {rfiLoading ? <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p> : filteredRfis.length === 0 ? <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.norfis")}</p> : (() => {
                // Parent-child gruplama
                const rfiAllIds = new Set(filteredRfis.map(r => r.id));
                const rfiGhostParents = rfis.filter(r =>
                  !rfiAllIds.has(r.id) &&
                  filteredRfis.some(fr => fr.parent_id === r.id)
                );
                const allRfis = [...rfiGhostParents, ...filteredRfis];
                const rfiParents = allRfis.filter(r => !r.parent_id);
                const rfiChildMap = new Map<string, typeof filteredRfis>();
                allRfis.filter(r => r.parent_id).forEach(r => {
                  const arr = rfiChildMap.get(r.parent_id!) ?? [];
                  arr.push(r);
                  rfiChildMap.set(r.parent_id!, arr);
                });
                const rfiRow = (r: RFIItem, isChild = false) => (
                  <div key={r.id}>
                    <div
                      onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${r.id}`)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "90px 1fr 100px 90px 90px 80px",
                        gap: 8,
                        padding: isChild ? "7px 12px 7px 28px" : "9px 12px",
                        background: isChild ? "var(--color-bg-primary)" : cardBg,
                        marginBottom: 2,
                        cursor: "pointer",
                        borderLeft: isChild
                          ? `2px solid ${"var(--color-accent)"}`
                          : `2px solid ${r.status === "overdue" ? "var(--color-alert-red)" : r.status === "open" ? "var(--color-accent)" : r.status === "responded" ? ("var(--color-success)") : "transparent"}`,
                      }}
                    >
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: isChild ? 9 : 10, color: textSecondary, display: "flex", alignItems: "center", gap: 3 }}>
                        {isChild && <span style={{ color: "var(--color-accent)", marginRight: 2 }}>└</span>}
                        {r.rfi_number}
                        {r.rfi_type && r.rfi_type !== "original" && (
                          <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 4px", backgroundColor: r.rfi_type === "response" ? "var(--color-success-bg)" : "var(--color-bg-secondary)", color: r.rfi_type === "response" ? "var(--color-success)" : "var(--color-text-secondary)", textTransform: "uppercase" as const }}>
                            {r.rfi_type === "response" ? (lang === "tr" ? "YNT" : "RES") : (lang === "tr" ? "REV" : "REV")}
                          </span>
                        )}
                      </span>
                      <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500 }}>{r.subject}</p>
                      <span style={{ fontSize: 11, color: textSecondary, textTransform: "capitalize" as const }}>{r.discipline ?? "—"}</span>
                      <span style={{ fontSize: 11, color: textSecondary }}>{r.submitted_date?.slice(0, 10)}</span>
                      <span style={{ fontSize: 11, color: r.response_due_date && r.response_due_date < today ? "var(--color-alert-red)" : textSecondary }}>{r.response_due_date?.slice(0, 10) ?? "—"}</span>
                      {r.rfi_type === "response"
                        ? <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", backgroundColor: "var(--color-success-bg)", color: "var(--color-success)", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>RESPONSE</span>
                        : statusPill(r.status)}
                    </div>
                    {(rfiChildMap.get(r.id) ?? []).map(child => rfiRow(child, true))}
                  </div>
                );
                return (
                  <div>
                    {listHeader([{ label: t("col.no"), width: "90px" }, { label: t("col.subject"), width: "1fr" }, { label: t("col.discipline"), width: "100px" }, { label: t("col.submitted"), width: "90px" }, { label: t("col.due"), width: "90px" }, { label: t("col.status"), width: "80px" }])}
                    {rfiParents.map(r => rfiRow(r, false))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* CHANGES */}
          {activeModule === "changes" && (
            <div>
              {moduleHeader("Changes", () => navigate(`/projects/${projectId}/workspace/changes/new`), t("action.newchange"))}
              {filterRow(
                keywordSearch(changeKeyword, setChangeKeyword),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "draft", "open", "under_review", "approved", "rejected", "closed"].map((s) => chip(s === "" ? t("filter.all") : s.replace("_", " "), changeStatus === s, () => setChangeStatus(s)))
              )}
              {filterRow(...["", "client", "contractor", "engineer", "variation", "other"].map((o) => chip(o === "" ? t("filter.allorigins") : o, changeOrigin === o, () => setChangeOrigin(o))))}
              {filterRow(
                chip(t("filter.createddate"), changeDateField === "created_at", () => setChangeDateField("created_at")),
                chip(t("filter.duedate"), changeDateField === "notice_due_date", () => setChangeDateField("notice_due_date")),
                <div key="chgdiv" style={{ width: "0.5px", background: border, height: 20 }} />,
                dateRange(changeDateField === "created_at" ? t("filter.createddate") : t("filter.duedate"), changeDateFrom, changeDateTo, setChangeDateFrom, setChangeDateTo)
              )}
              {changeLoading ? <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p> : filteredChanges.length === 0 ? <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.nochanges")}</p> : (
                <div>
                  {listHeader([{ label: t("col.no"), width: "90px" }, { label: t("col.title"), width: "1fr" }, { label: t("col.origin"), width: "90px" }, { label: t("col.date"), width: "90px" }, { label: t("col.status"), width: "80px" }])}
                  {filteredChanges.map((c) => (
                    <div key={c.id} onClick={() => navigate(`/projects/${projectId}/workspace/changes/${c.id}`)} style={{ display: "grid", gridTemplateColumns: "90px 1fr 90px 90px 80px", gap: 8, padding: "9px 12px", background: cardBg, marginBottom: 3, cursor: "pointer", borderLeft: `2px solid ${c.status === "open" ? "var(--color-accent)" : "transparent"}` }}>
                      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: textSecondary }}>{c.change_number}</span>
                      <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{c.title}</p>
                      <span style={{ fontSize: 11, color: textSecondary, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{c.origin}</span>
                      <span style={{ fontSize: 11, color: textSecondary, whiteSpace: "nowrap" }}>{c.created_at?.slice(0, 10)}</span>
                      {statusPill(c.status)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* DELIVERABLES */}
          {activeModule === "deliverables" && (
            <div>
              {moduleHeader("Deliverables", () => navigate(`/projects/${projectId}/workspace/deliverables/new`), t("action.newdeliverable"))}
              {filterRow(
                keywordSearch(delivKeyword, setDelivKeyword),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "pending", "in_progress", "submitted", "approved", "rejected", "closed"].map((s) => chip(s === "" ? t("filter.all") : s.replace("_", " "), delivStatus === s, () => setDelivStatus(s)))
              )}
              {filterRow(dateRange(t("col.duedate"), delivDateFrom, delivDateTo, setDelivDateFrom, setDelivDateTo))}
              {delivLoading ? <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p> : filteredDeliverables.length === 0 ? <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.nodeliverables")}</p> : (
                <div>
                  {listHeader([{ label: t("col.title"), width: "1fr" }, { label: t("col.category"), width: "100px" }, { label: t("col.duedate"), width: "90px" }, { label: t("col.status"), width: "80px" }])}
                  {filteredDeliverables.map((d) => (
                    <div key={d.id} onClick={() => navigate(`/projects/${projectId}/workspace/deliverables/${d.id}`)} style={{ display: "grid", gridTemplateColumns: "1fr 100px 90px 80px", gap: 8, padding: "9px 12px", background: cardBg, marginBottom: 3, cursor: "pointer", borderLeft: `2px solid ${d.status === "in_progress" ? "var(--color-accent)" : "transparent"}` }}>
                      <div><p style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{d.title}</p>{d.is_pre_completion && <span style={{ fontSize: 11, color: "var(--color-accent)" }}>{t("state.precompletion")}</span>}</div>
                      <span style={{ fontSize: 11, color: textSecondary }}>{d.category ?? "—"}</span>
                      <span style={{ fontSize: 11, color: d.due_date && d.due_date < today ? "var(--color-alert-red)" : textSecondary }}>{d.due_date ?? "—"}</span>
                      {statusPill(d.status)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* OTHER */}
          {activeModule === "alerts" && (
            <AlertsModule projectId={String(projectId)} />
          )}
          {activeModule === "chronologies" && (
            <ChronologiesModule
              projectId={String(projectId)}
            />
          )}
          {activeModule === "documents" && (
            <DocumentsModule
              projectId={String(projectId)}
            />
          )}
          {!["general", "alerts", "correspondence",
            "rfis", "changes", "deliverables",
            "chronologies", "documents"].includes(activeModule) && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 300,
            }}>
              <div style={{ textAlign: "center" }}>
                <p style={{
                  fontFamily:
                    "Playfair Display, Georgia, serif",
                  fontSize: 16,
                  color: textPrimary,
                  marginBottom: 8,
                }}>
                  {MODULE_LABELS[activeModule]}
                </p>
                <p style={{
                  fontSize: 12,
                  color: textSecondary,
                  fontStyle: "italic",
                }}>
                  {t("state.comingsoon")}
                </p>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
