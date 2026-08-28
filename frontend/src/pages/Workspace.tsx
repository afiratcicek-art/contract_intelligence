import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useDebounce } from "../hooks/useDebounce";
import { api } from "../services/api";
import ThemeToggle from "../components/ThemeToggle";
import LanguageToggle from "../components/LanguageToggle";
import Button from "../components/Button";
import StatusChip from "../components/StatusChip";
import { getAuth, clearAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";
import { formatDateCompact } from "../utils/format";
import AlertsModule from "../components/AlertsModule";
import ChronologiesModule from "../components/ChronologiesModule";
import DocumentsModule from "../components/DocumentsModule";
import ContractInForceView from "../components/ContractInForceView";
import AuthoringTemplatesPanel from "../components/AuthoringTemplatesPanel";
import DeliverablesModule from "../components/DeliverablesModule";
import IntelligenceModule from "../components/IntelligenceModule";
import DisputesModule from "../components/DisputesModule";

type Module = "general" | "alerts" | "correspondence" | "rfis" | "changes" | "deliverables" | "chronologies" | "disputes" | "documents" | "intelligence" | "config";

// Server-side cap on the list fetches. A capped list is a false negative in a
// claim, so every list that hits it says so.
const LIST_LIMIT = 100;

interface SearchResult { module: string; label: string; ref: string; subject: string; status: string; date: string; id: string; parent_id?: string | null; has_response?: boolean; rfi_type?: string; }
interface CorrItem { id: string; corr_number: string; subject: string; type: string; status: string; correspondence_date: string; direction: string; response_due_date: string | null; parent_id: string | null; has_response: boolean; }
interface RFIItem { id: string; rfi_number: string; subject: string; status: string; submitted_date: string | null; response_due_date: string | null; discipline: string | null; parent_id: string | null; rfi_type: string; entry_mode: "authored" | "recorded"; }
interface ChangeItem { id: string; change_number: string; title: string; status: string; origin: string; notice_due_date: string | null; created_at: string; }

// Route key stays "changes"; the sidebar label is the contracts section.
function moduleLabel(mod: Module, t: (key: string) => string): string {
  switch (mod) {
    case "general": return t("module.general");
    case "alerts": return t("module.alerts");
    case "correspondence": return t("module.correspondence");
    case "rfis": return t("module.rfis");
    case "changes": return t("module.contracts");
    case "deliverables": return t("module.deliverables");
    case "chronologies": return t("module.chronologies");
    case "disputes": return t("module.disputes");
    case "documents": return t("module.documents");
    case "intelligence": return t("module.intelligence");
    case "config": return t("module.config");
  }
}

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
  const { t } = useLanguage();
  const location = useLocation();

  const [activeModule, setActiveModule] = useState<Module>(() => {
    const params = new URLSearchParams(location.search);
    const m = params.get("module") as Module | null;
    const valid: Module[] = ["general", "alerts", "correspondence", "rfis", "changes", "deliverables", "chronologies", "disputes", "documents", "intelligence", "config"];
    return m && valid.includes(m) ? m : "general";
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const m = params.get("module") as Module | null;
    const valid: Module[] = ["general", "alerts", "correspondence", "rfis", "changes", "deliverables", "chronologies", "disputes", "documents", "intelligence", "config"];
    if (m && valid.includes(m)) {
      setActiveModule(m);
    }
  }, [location.search]);

  // Contracts & Amendments sub-tab: "working" = the Changes list, "inforce" = B3 view.
  // Deep-link via ?tab= (same shape as ?module=). Absent param → default "working".
  const [contractTab, setContractTab] = useState<"working" | "inforce">(() => {
    const params = new URLSearchParams(location.search);
    const tb = params.get("tab");
    return tb === "inforce" || tb === "working" ? tb : "working";
  });
  useEffect(() => {
    const tb = new URLSearchParams(location.search).get("tab");
    if (tb === "inforce" || tb === "working") setContractTab(tb);
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
  const [corrError, setCorrError] = useState(false);
  const [corrKeyword, setCorrKeyword] = useState("");
  const debouncedCorrKeyword = useDebounce(corrKeyword, corrKeyword.trim() ? 400 : 0);
  const [corrStatus, setCorrStatus] = useState("");
  const [corrDir, setCorrDir] = useState("");
  const [corrDateFrom, setCorrDateFrom] = useState("");
  const [corrDateTo, setCorrDateTo] = useState("");
  const [corrDateField, setCorrDateField] = useState<"correspondence_date" | "response_due_date">("correspondence_date");

  const [rfis, setRfis] = useState<RFIItem[]>([]);
  const [rfiLoading, setRfiLoading] = useState(false);
  const [rfiError, setRfiError] = useState(false);
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
  const [changeError, setChangeError] = useState(false);
  const [changeKeyword, setChangeKeyword] = useState("");
  const [changeStatus, setChangeStatus] = useState("");
  const [changeOrigin, setChangeOrigin] = useState("");
  const [changeDateFrom, setChangeDateFrom] = useState("");
  const [changeDateTo, setChangeDateTo] = useState("");
  const [changeDateField, setChangeDateField] = useState<"created_at" | "notice_due_date">("created_at");

  const bg          = "var(--color-bg-primary)";
  const cardBg      = "var(--color-bg-secondary)";
  const border      = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecondary = "var(--color-text-secondary)";

  const inputStyle: React.CSSProperties = {
    background: cardBg, border: `0.5px solid ${border}`, color: textPrimary,
    fontSize: 11, fontFamily: "var(--font-ui)", padding: "4px 8px",
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
  const loadCorrs = useCallback(() => {
    setCorrLoading(true);
    setCorrError(false);
    let url = `/projects/${projectId}/correspondences?limit=${LIST_LIMIT}`;
    if (corrStatus) url += `&status=${corrStatus}`;
    if (corrDir) url += `&direction=${corrDir}`;
    if (debouncedCorrKeyword.trim()) url += `&q=${encodeURIComponent(debouncedCorrKeyword.trim())}`;
    api.get<CorrItem[]>(url).then(setCorrs).catch(() => { setCorrs([]); setCorrError(true); }).finally(() => setCorrLoading(false));
  }, [projectId, corrStatus, corrDir, debouncedCorrKeyword]);

  useEffect(() => {
    if (activeModule !== "correspondence") return;
    loadCorrs();
  }, [activeModule, loadCorrs]);

  // Debounced backend search — replaces client-side filtering.
  // q present → chain-aware RPC (search_rfi_chains).
  // q absent → standard list with status/discipline filters.
  const loadRfis = useCallback(() => {
    setRfiLoading(true);
    setRfiError(false);
    let url = `/projects/${projectId}/rfis?limit=${LIST_LIMIT}`;
    if (rfiStatus) url += `&status=${rfiStatus}`;
    if (rfiDiscipline) url += `&discipline=${rfiDiscipline}`;
    if (debouncedRfiKeyword.trim()) url += `&q=${encodeURIComponent(debouncedRfiKeyword.trim())}`;
    api.get<RFIItem[]>(url).then(setRfis).catch(() => { setRfis([]); setRfiError(true); }).finally(() => setRfiLoading(false));
  }, [projectId, rfiStatus, rfiDiscipline, debouncedRfiKeyword]);

  useEffect(() => {
    if (activeModule !== "rfis") return;
    loadRfis();
  }, [activeModule, loadRfis]);

  const loadChanges = useCallback(() => {
    setChangeLoading(true);
    setChangeError(false);
    let url = `/projects/${projectId}/changes?limit=${LIST_LIMIT}`;
    if (changeStatus) url += `&status=${changeStatus}`;
    if (changeOrigin) url += `&origin=${changeOrigin}`;
    api.get<ChangeItem[]>(url).then(setChanges).catch(() => { setChanges([]); setChangeError(true); }).finally(() => setChangeLoading(false));
  }, [projectId, changeStatus, changeOrigin]);

  useEffect(() => {
    if (activeModule !== "changes") return;
    loadChanges();
  }, [activeModule, loadChanges]);

  const handleLogout = () => { clearAuth(); navigate("/login"); };

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick} style={{ padding: "4px 10px", border: `0.5px solid ${active ? "var(--color-accent)" : border}`, fontSize: 11, color: active ? "var(--color-bg-primary)" : textSecondary, background: active ? "var(--color-accent)" : cardBg, cursor: "pointer", borderRadius: 0, fontFamily: "var(--font-ui)" }}>
      {label}
    </button>
  );

  const dateRange = (label: string, from: string, to: string, onFrom: (v: string) => void, onTo: (v: string) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 11, color: textSecondary, whiteSpace: "nowrap" }}>{label}:</span>
      <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} style={inputStyle} />
      <span style={{ fontSize: 11, color: textSecondary }}>—</span>
      <input type="date" value={to} onChange={(e) => onTo(e.target.value)} style={inputStyle} />
      {(from || to) && <button onClick={() => { onFrom(""); onTo(""); }} style={{ fontSize: 11, color: textSecondary, background: "none", border: "none", cursor: "pointer" }}>✕</button>}
    </div>
  );

  const keywordSearch = (value: string, onChange: (v: string) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: cardBg, border: `0.5px solid ${border}`, padding: "8px 10px", maxWidth: 280 }}>
      <span style={{ color: textSecondary, fontSize: 13 }}>⌕</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("filter.search")} aria-label={t("filter.search")} style={{ background: "none", border: "none", outline: "none", fontSize: 12, color: textPrimary, fontFamily: "var(--font-ui)", width: "100%" }} />
      {value && <button onClick={() => onChange("")} style={{ fontSize: 11, color: textSecondary, background: "none", border: "none", cursor: "pointer" }}>✕</button>}
    </div>
  );

  const filterRow = (...children: React.ReactNode[]) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
  );

  const moduleHeader = (title: string, onNew?: () => void, newLabel?: string) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <div style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1-module)", color: textPrimary, fontWeight: 500 }}>{title}</div>
      {onNew && (
        <Button size="sm" type="button" onClick={onNew}>
          {newLabel}
        </Button>
      )}
    </div>
  );

  const listHeader = (cols: { label: string; width: string }[]) => (
    <div className="list-row" style={{ display: "grid", gridTemplateColumns: cols.map(c => c.width).join(" "), gap: 8, padding: "6px 12px", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: textSecondary, borderBottom: `0.5px solid ${border}` }}>
      {cols.map(c => <span key={c.label}>{c.label}</span>)}
    </div>
  );

  const truncationNotice = () => (
    <div style={{ fontSize: 11, fontFamily: "var(--font-meta)", color: "var(--color-warning)", padding: "6px 12px", background: "var(--color-warning-bg)", marginBottom: 2 }}>
      {t("state.truncated").replace("{n}", String(LIST_LIMIT))}
    </div>
  );

  const loadFailed = (onRetry: () => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: "var(--color-alert-red)" }}>{t("state.loadfailed")}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>{t("action.retry")}</Button>
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

  const filteredGeneral = searchResults.filter((r) =>
    (!genModFilter || r.module === genModFilter) &&
    (!genStatusFilter || r.status === genStatusFilter) &&
    dateInRange(genDateField === "date" ? r.date : r.date, genDateFrom, genDateTo)
  );

  const SIDEBAR_MAIN: Module[] = ["changes", "general", "alerts", "correspondence", "rfis", "deliverables", "chronologies", "disputes"];
  const SIDEBAR_SYS: Module[] = ["documents", "intelligence", "config"];

  const generalNavTarget = (mod: string, id: string) => {
    if (mod === "correspondence") return `/projects/${projectId}/workspace/correspondence/${id}`;
    if (mod === "rfi") return `/projects/${projectId}/workspace/rfis/${id}`;
    if (mod === "change") return `/projects/${projectId}/workspace/changes/${id}`;
    if (mod === "deliverable") return `/projects/${projectId}/workspace/deliverables/${id}`;
    return `/projects/${projectId}/workspace`;
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", flexDirection: "column" }}>
      <nav className="app-chrome-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecondary }}>
          <div className="gold-line gold-line-compact" />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{projectName || t("nav.overview")}</span>
          <span style={{ color: "var(--color-text-secondary)" }}>/</span>
          <span style={{ color: textPrimary, fontWeight: 500 }}>{t("nav.workspace")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecondary }}>
          <span>{auth?.full_name}</span>
          <LanguageToggle />
          <ThemeToggle />
          <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecondary }}>{t("nav.signout")}</button>
        </div>
      </nav>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* File-divider nav: stacked modules, 3px accent tab marker */}
        <aside style={{ width: 200, backgroundColor: bg, borderRight: `0.5px solid ${border}`, padding: "16px 0", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 16px 12px", borderBottom: `0.5px solid ${border}`, marginBottom: 8 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: textPrimary, fontWeight: 500, lineHeight: 1.3 }}>{projectName}</div>
            <div style={{ fontSize: 11, color: textSecondary, marginTop: 2, fontFamily: "var(--font-meta)" }}>{t("nav.workspace")}</div>
          </div>
          {SIDEBAR_MAIN.map((mod) => {
            const active = activeModule === mod;
            return (
              <button
                key={mod}
                type="button"
                onClick={() => setActiveModule(mod)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  fontFamily: "var(--font-ui)",
                  background: active ? cardBg : "transparent",
                  borderTop: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  borderLeft: active ? "3px solid var(--color-accent)" : "3px solid transparent",
                  cursor: "pointer",
                  color: active ? textPrimary : textSecondary,
                  borderRadius: 0,
                }}
              >
                <span>{moduleLabel(mod, t)}</span>
                {mod === "alerts" && alertCount > 0 && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 500,
                    fontFamily: "var(--font-meta)",
                    backgroundColor: "var(--color-alert-red)",
                    color: "var(--color-bg-primary)",
                    borderRadius: "50%",
                    padding: "1px 6px",
                    minWidth: 16,
                    textAlign: "center",
                  }}>
                    {alertCount}
                  </span>
                )}
              </button>
            );
          })}
          <div style={{ height: "0.5px", background: border, margin: "8px 16px" }} />
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary)", padding: "4px 16px", fontFamily: "var(--font-meta)" }}>{t("module.system")}</div>
          {SIDEBAR_SYS.map((mod) => {
            const active = activeModule === mod;
            return (
              <button
                key={mod}
                type="button"
                onClick={() => setActiveModule(mod)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  color: active ? textPrimary : textSecondary,
                  background: active ? cardBg : "transparent",
                  borderTop: "none",
                  borderRight: "none",
                  borderBottom: "none",
                  borderLeft: active ? "3px solid var(--color-accent)" : "3px solid transparent",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                  fontFamily: "var(--font-ui)",
                  borderRadius: 0,
                }}
              >
                {moduleLabel(mod, t)}
              </button>
            );
          })}
        </aside>

        <main style={{ flex: 1, padding: 24, overflowY: "auto", backgroundColor: bg }}>

          {/* GENERAL */}
          {activeModule === "general" && (
            <div>
              {moduleHeader(t("general.title"))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: cardBg, border: "1px solid var(--color-border-light)", padding: "10px 14px", maxWidth: 560, marginBottom: 16 }}>
                <span style={{ color: textSecondary, fontSize: 16 }}>⌕</span>
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t("general.placeholder")} style={{ background: "none", border: "none", outline: "none", fontSize: 13, color: textPrimary, fontFamily: "var(--font-ui)", width: "100%" }} />
                {searching && <span style={{ fontSize: 11, color: textSecondary }}>{t("general.searching")}</span>}
                {searchQuery && <button onClick={() => { setSearchQuery(""); handleSearch(""); }} style={{ fontSize: 11, color: textSecondary, background: "none", border: "none", cursor: "pointer" }}>✕</button>}
              </div>
              {filterRow(
                ...["", "correspondence", "rfi", "change", "deliverable"].map((m) => chip(m === "" ? t("filter.all") : t(m === "rfi" ? "module.rfis" : m === "change" ? "module.changes" : m === "deliverable" ? "module.deliverables" : "module.correspondence"), genModFilter === m, () => setGenModFilter(m))),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "open", "draft", "under_review", "approved", "published", "closed", "overdue"].map((s) => chip(s === "" ? t("filter.allstatus") : t(`status.${s}`), genStatusFilter === s, () => setGenStatusFilter(s)))
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
                const label = t(mod === "correspondence" ? "module.correspondence" : mod === "rfi" ? "module.rfis" : mod === "change" ? "module.changes" : "module.deliverables");

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
                    <div key={r.id} className={isChild ? "chain-branch" : undefined}>
                      <div
                        className={isChild ? "chain-node" : undefined}
                        onClick={() => navigate(generalNavTarget(mod, r.id))}
                        style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between",
                          padding: isChild ? "8px 12px 8px 28px" : "8px 12px",
                          background: isChild ? "var(--color-bg-primary)" : cardBg,
                          marginBottom: 2, cursor: "pointer",
                          borderLeft: `2px solid ${r.status === "responded" ? ("var(--color-success)") : "var(--color-accent)"}`,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <span className="ref-number">{r.ref}</span>
                          <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>
                            {r.has_response && <span aria-label={t("status.responded")} style={{ fontSize: 11, color: "var(--color-accent-text)", marginInlineEnd: 5 }}>↩</span>}
                            {r.subject}
                          </p>
                          <p className="data-figure" style={{ color: textSecondary, marginTop: 1 }}>{formatDateCompact(r.date)}</p>
                        </div>
                        <StatusChip status={r.status} />
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
                    <div key={r.id} className={isChild ? "chain-branch" : undefined}>
                      <div
                        className={isChild ? "chain-node" : undefined}
                        onClick={() => navigate(generalNavTarget(mod, r.id))}
                        style={{
                          display: "flex", alignItems: "center",
                          justifyContent: "space-between",
                          padding: isChild ? "8px 12px 8px 28px" : "8px 12px",
                          background: isChild ? "var(--color-bg-primary)" : cardBg,
                          marginBottom: 2, cursor: "pointer",
                          borderLeft: `2px solid ${r.status === "responded" ? ("var(--color-success)") : "var(--color-accent)"}`,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <span className="ref-number">{r.ref}</span>
                          <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>
                            {r.rfi_type && r.rfi_type !== "original" && (
                              <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 4px", marginInlineEnd: 6, whiteSpace: "nowrap", backgroundColor: r.rfi_type === "response" ? "var(--color-success-bg)" : "var(--color-bg-secondary)", color: r.rfi_type === "response" ? "var(--color-success)" : "var(--color-text-secondary)" }}>
                                {r.rfi_type === "response" ? t("rfitype.response") : t("rfitype.revision")}
                              </span>
                            )}
                            {r.subject}
                          </p>
                          <p className="data-figure" style={{ color: textSecondary, marginTop: 1 }}>{formatDateCompact(r.date)}</p>
                        </div>
                        <StatusChip status={r.status} />
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
                      <div key={r.id} onClick={() => navigate(generalNavTarget(mod, r.id))} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: cardBg, marginBottom: 4, borderLeft: `2px solid ${"var(--color-accent)"}`, cursor: "pointer" }}>
                        <div>
                          <span className="ref-number">{r.ref}</span>
                          <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500, marginTop: 2 }}>{r.subject}</p>
                          <p className="data-figure" style={{ color: textSecondary, marginTop: 1 }}>{formatDateCompact(r.date)}</p>
                        </div>
                        <StatusChip status={r.status} />
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
                <div style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1-module)", color: textPrimary, fontWeight: 500 }}>{t("module.correspondence")}</div>
                <div style={{ position: "relative" as const }}>
                  <Button size="sm" type="button" onClick={() => setCorrDropdown(!corrDropdown)}>
                    {t("action.newcorrespondence")} ▾
                  </Button>
                  {corrDropdown && (
                    <div style={{ position: "absolute" as const, right: 0, top: "100%", zIndex: "var(--z-dropdown)" as unknown as number, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, minWidth: 200, marginTop: 2, borderRadius: 0 }}>
                      <button type="button" onClick={() => { setCorrDropdown(false); navigate(`/projects/${projectId}/workspace/correspondence/new?mode=new`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", borderRadius: 0 }}>
                        {t("action.register")}
                      </button>
                      <button type="button" onClick={() => { setCorrDropdown(false); navigate(`/projects/${projectId}/workspace/authoring/new?doc_type=letter`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", borderRadius: 0 }}>
                        {t("action.create")}
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
              {filterRow(...["", "open", "responded", "draft", "under_review", "approved", "published", "closed", "overdue"].map((s) => chip(s === "" ? t("filter.all") : t(`status.${s}`), corrStatus === s, () => setCorrStatus(s))))}
              {filterRow(
                chip(t("filter.issuedate"), corrDateField === "correspondence_date", () => setCorrDateField("correspondence_date")),
                chip(t("filter.duedate"), corrDateField === "response_due_date", () => setCorrDateField("response_due_date")),
                <div key="cdiv" style={{ width: "0.5px", background: border, height: 20 }} />,
                dateRange(corrDateField === "correspondence_date" ? t("filter.issuedate") : t("filter.duedate"), corrDateFrom, corrDateTo, setCorrDateFrom, setCorrDateTo)
              )}
              {corrLoading ? <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p> : corrError ? loadFailed(loadCorrs) : filteredCorrs.length === 0 ? <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.nocorrespondence")}</p> : (() => {
                // Parent-child gruplama
                const allIds = new Set(filteredCorrs.map(c => c.id));
                
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
                  <div key={c.id} className={isChild ? "chain-branch" : undefined}>
                    <div
                      className={isChild ? "list-row chain-node" : "list-row"}
                      onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${c.id}`)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "var(--gutter-ref) 1fr 90px 90px 90px var(--gutter-status)",
                        gap: 8,
                        padding: isChild ? "8px 12px 8px 28px" : "8px 12px",
                        background: isChild ? "var(--color-bg-primary)" : cardBg,
                        marginBottom: 2,
                        cursor: "pointer",
                        // The left rail carries status on every row, parent or child.
                        // Chain membership is the thread's job, not the rail's.
                        borderLeft: `2px solid ${c.status === "overdue" ? "var(--color-alert-red)" : c.status === "open" ? "var(--color-accent)" : c.status === "responded" ? ("var(--color-success)") : "transparent"}`,
                      }}
                    >
                      {/* Reference cell holds the reference and nothing else — markers
                          and badges live with the subject, where there is room to grow. */}
                      <span className="ref-number">{c.corr_number}</span>
                      <div>
                        <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500, margin: 0 }}>
                          {c.has_response && <span aria-label={t("status.responded")} style={{ fontSize: 11, color: "var(--color-accent-text)", marginInlineEnd: 5 }}>↩</span>}
                          {c.subject}
                        </p>
                        <p style={{ fontSize: 11, color: textSecondary, marginTop: 1, textTransform: "capitalize" as const }}>{c.type?.replace(/_/g, " ")}</p>
                      </div>
                      <span style={{ fontSize: 11, color: textSecondary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.direction === "incoming" ? t("filter.incoming") : c.direction === "outgoing" ? t("filter.outgoing") : c.direction}</span>
                      <span className="data-figure" style={{ color: textSecondary }}>{formatDateCompact(c.correspondence_date)}</span>
                      <span className="data-figure" style={{ color: c.response_due_date && c.response_due_date < today ? "var(--color-alert-red)" : textSecondary }}>{formatDateCompact(c.response_due_date)}</span>
                      <StatusChip status={c.status} />
                    </div>
                    {/* Children */}
                    {(childMap.get(c.id) ?? []).map(child => corrRow(child, true))}
                  </div>
                );

                return (
                  <div>
                    {corrs.length >= LIST_LIMIT && truncationNotice()}
                    {listHeader([{ label: t("col.no"), width: "var(--gutter-ref)" }, { label: t("col.subject"), width: "1fr" }, { label: t("col.direction"), width: "90px" }, { label: t("col.date"), width: "90px" }, { label: t("col.deadline"), width: "90px" }, { label: t("col.status"), width: "var(--gutter-status)" }])}
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
                <div style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1-module)", color: textPrimary, fontWeight: 500 }}>{t("module.rfis")}</div>
                <div style={{ position: "relative" as const }}>
                  <Button size="sm" type="button" onClick={() => setRfiDropdown(!rfiDropdown)}>
                    {t("action.newrfi")} ▾
                  </Button>
                  {rfiDropdown && (
                    <div style={{ position: "absolute" as const, right: 0, top: "100%", zIndex: "var(--z-dropdown)" as unknown as number, backgroundColor: "var(--color-bg-primary)", border: `1px solid ${border}`, minWidth: 200, marginTop: 2, borderRadius: 0 }}>
                      <button type="button" onClick={() => { setRfiDropdown(false); navigate(`/projects/${projectId}/workspace/rfis/new?mode=new`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", borderBottom: `0.5px solid ${border}`, borderRadius: 0 }}>
                        {t("action.register")}
                      </button>
                      <button type="button" onClick={() => { setRfiDropdown(false); navigate(`/projects/${projectId}/workspace/authoring/new?doc_type=rfi`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", borderBottom: `0.5px solid ${border}`, borderRadius: 0 }}>
                        {t("action.create")}
                      </button>
                      {/* Response/revision without parent: list shortcut → register only.
                          Parent-aware Create lives on RFI detail (EntryModeMenu). */}
                      <button type="button" onClick={() => { setRfiDropdown(false); navigate(`/projects/${projectId}/workspace/rfis/new?mode=response`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", borderBottom: `0.5px solid ${border}`, borderRadius: 0 }}>
                        {t("action.addresponse")}
                      </button>
                      <button type="button" onClick={() => { setRfiDropdown(false); navigate(`/projects/${projectId}/workspace/rfis/new?mode=revision`); }}
                        style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left" as const, fontSize: 12, color: textPrimary, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", borderRadius: 0 }}>
                        {t("action.addrevision")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {filterRow(
                keywordSearch(rfiKeyword, setRfiKeyword),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "open", "overdue", "responded", "closed"].map((s) => chip(s === "" ? t("filter.all") : t(`status.${s}`), rfiStatus === s, () => setRfiStatus(s)))
              )}
              {filterRow(...["", "Civil", "Architectural", "Structural", "Mechanical", "Electrical", "Plumbing", "Other"].map((d) => chip(d === "" ? t("filter.alldisciplines") : t(`discipline.${d.toLowerCase()}`), rfiDiscipline === d, () => setRfiDiscipline(d))))}
              {filterRow(
                chip(t("filter.submitteddate"), rfiDateField === "submitted_date", () => setRfiDateField("submitted_date")),
                chip(t("filter.duedate"), rfiDateField === "response_due_date", () => setRfiDateField("response_due_date")),
                <div key="rdiv" style={{ width: "0.5px", background: border, height: 20 }} />,
                dateRange(rfiDateField === "submitted_date" ? t("filter.submitteddate") : t("filter.duedate"), rfiDateFrom, rfiDateTo, setRfiDateFrom, setRfiDateTo)
              )}
              {rfiLoading ? <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p> : rfiError ? loadFailed(loadRfis) : filteredRfis.length === 0 ? <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.norfis")}</p> : (() => {
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
                  <div key={r.id} className={isChild ? "chain-branch" : undefined}>
                    <div
                      className={isChild ? "list-row chain-node" : "list-row"}
                      onClick={() => navigate(`/projects/${projectId}/workspace/rfis/${r.id}`)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "var(--gutter-ref) 1fr 100px 90px 90px var(--gutter-status)",
                        gap: 8,
                        padding: isChild ? "8px 12px 8px 28px" : "8px 12px",
                        background: isChild ? "var(--color-bg-primary)" : cardBg,
                        marginBottom: 2,
                        cursor: "pointer",
                        borderLeft: `2px solid ${r.status === "overdue" ? "var(--color-alert-red)" : r.status === "open" ? "var(--color-accent)" : r.status === "responded" ? ("var(--color-success)") : "transparent"}`,
                      }}
                    >
                      {/* Reference cell holds the reference and nothing else — the type
                          badge lives with the subject, where there is room to grow. */}
                      <span className="ref-number">{r.rfi_number}</span>
                      <p style={{ fontSize: isChild ? 11 : 12, color: textPrimary, fontWeight: 500 }}>
                        {r.rfi_type && r.rfi_type !== "original" && (
                          <span style={{ fontSize: 11, fontWeight: 500, padding: "1px 4px", marginInlineEnd: 6, backgroundColor: r.rfi_type === "response" ? "var(--color-success-bg)" : "var(--color-bg-secondary)", color: r.rfi_type === "response" ? "var(--color-success)" : "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                            {r.rfi_type === "response" ? t("rfitype.response") : t("rfitype.revision")}
                          </span>
                        )}
                        {r.subject}
                      </p>
                      <span style={{ fontSize: 11, color: textSecondary, textTransform: "capitalize" as const, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.discipline ?? "—"}</span>
                      <span className="data-figure" style={{ color: textSecondary }}>
                        {formatDateCompact(r.submitted_date)}
                      </span>
                      <span className="data-figure" style={{ color: r.response_due_date && r.response_due_date < today ? "var(--color-alert-red)" : textSecondary }}>{formatDateCompact(r.response_due_date)}</span>
                      <StatusChip status={r.status} />
                    </div>
                    {(rfiChildMap.get(r.id) ?? []).map(child => rfiRow(child, true))}
                  </div>
                );
                return (
                  <div>
                    {rfis.length >= LIST_LIMIT && truncationNotice()}
                    {listHeader([{ label: t("col.no"), width: "var(--gutter-ref)" }, { label: t("col.subject"), width: "1fr" }, { label: t("col.discipline"), width: "100px" }, { label: t("col.submitted"), width: "90px" }, { label: t("col.due"), width: "90px" }, { label: t("col.status"), width: "var(--gutter-status)" }])}
                    {rfiParents.map(r => rfiRow(r, false))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* CONTRACTS & AMENDMENTS (module key stays "changes") */}
          {activeModule === "changes" && (
            <div>
              {/* Sub-tabs — reuse the chip + filterRow primitives, no new component/styling.
                  Working = the existing Changes list; In-Force = the B3 resolution view. */}
              {filterRow(
                chip(t("inforce.tab.working"), contractTab === "working", () => setContractTab("working")),
                chip(t("inforce.tab.inforce"), contractTab === "inforce", () => setContractTab("inforce")),
              )}
              {contractTab === "working" && (
              <div>
              {moduleHeader(t("module.changes"), () => navigate(`/projects/${projectId}/workspace/changes/new`), t("action.newchange"))}
              {filterRow(
                keywordSearch(changeKeyword, setChangeKeyword),
                <div key="div1" style={{ width: "0.5px", background: border, height: 20 }} />,
                ...["", "draft", "open", "under_review", "approved", "rejected", "closed"].map((s) => chip(s === "" ? t("filter.all") : t(`status.${s}`), changeStatus === s, () => setChangeStatus(s)))
              )}
              {filterRow(...["", "client", "contractor", "engineer", "variation", "other"].map((o) => chip(o === "" ? t("filter.allorigins") : t(`origin.${o}`), changeOrigin === o, () => setChangeOrigin(o))))}
              {filterRow(
                chip(t("filter.createddate"), changeDateField === "created_at", () => setChangeDateField("created_at")),
                chip(t("filter.duedate"), changeDateField === "notice_due_date", () => setChangeDateField("notice_due_date")),
                <div key="chgdiv" style={{ width: "0.5px", background: border, height: 20 }} />,
                dateRange(changeDateField === "created_at" ? t("filter.createddate") : t("filter.duedate"), changeDateFrom, changeDateTo, setChangeDateFrom, setChangeDateTo)
              )}
              {changeLoading ? <p style={{ fontSize: 12, color: textSecondary }}>{t("state.loading")}</p> : changeError ? loadFailed(loadChanges) : filteredChanges.length === 0 ? <p style={{ fontSize: 12, color: textSecondary, fontStyle: "italic" }}>{t("state.nochanges")}</p> : (
                <div>
                  {changes.length >= LIST_LIMIT && truncationNotice()}
                  {listHeader([{ label: t("col.no"), width: "var(--gutter-ref)" }, { label: t("col.title"), width: "1fr" }, { label: t("col.origin"), width: "90px" }, { label: t("col.date"), width: "90px" }, { label: t("col.noticedue"), width: "90px" }, { label: t("col.status"), width: "var(--gutter-status)" }])}
                  {filteredChanges.map((c) => (
                    <div key={c.id} className="list-row" onClick={() => navigate(`/projects/${projectId}/workspace/changes/${c.id}`)} style={{ display: "grid", gridTemplateColumns: "var(--gutter-ref) 1fr 90px 90px 90px var(--gutter-status)", gap: 8, padding: "8px 12px", background: cardBg, marginBottom: 2, cursor: "pointer", borderLeft: `2px solid ${c.status === "open" ? "var(--color-accent)" : "transparent"}` }}>
                      <span className="ref-number">{c.change_number}</span>
                      <p style={{ fontSize: 12, color: textPrimary, fontWeight: 500 }}>{c.title}</p>
                      <span style={{ fontSize: 11, color: textSecondary, textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{c.origin}</span>
                      <span className="data-figure" style={{ color: textSecondary }}>{formatDateCompact(c.created_at)}</span>
                      <span className="data-figure" style={{ color: c.notice_due_date && c.notice_due_date < today ? "var(--color-alert-red)" : textSecondary }}>{formatDateCompact(c.notice_due_date)}</span>
                      <StatusChip status={c.status} />
                    </div>
                  ))}
                </div>
              )}
              </div>
              )}
              {contractTab === "inforce" && (
                <ContractInForceView projectId={String(projectId)} />
              )}
            </div>
          )}

          {/* DELIVERABLES — tracking-first module (not RFI-list clone) */}
          {activeModule === "deliverables" && (
            <DeliverablesModule projectId={String(projectId)} />
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
          {activeModule === "disputes" && (
            <DisputesModule projectId={String(projectId)} />
          )}
          {activeModule === "documents" && (
            <DocumentsModule
              projectId={String(projectId)}
            />
          )}
          {activeModule === "intelligence" && (
            <IntelligenceModule projectId={String(projectId)} />
          )}
          {activeModule === "config" && (
            <div>
              <div style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1-module)", color: textPrimary, fontWeight: 500, marginBottom: 8 }}>
                {t("module.config")}
              </div>
              <AuthoringTemplatesPanel projectId={String(projectId)} />
            </div>
          )}
          {!["general", "alerts", "correspondence",
            "rfis", "changes", "deliverables",
            "chronologies", "disputes", "documents", "intelligence", "config"].includes(activeModule) && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 300,
            }}>
              <div style={{ textAlign: "center" }}>
                <p style={{
                  fontFamily:
                    "var(--font-brand)",
                  fontSize: 16,
                  color: textPrimary,
                  marginBottom: 8,
                }}>
                  {moduleLabel(activeModule, t)}
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
