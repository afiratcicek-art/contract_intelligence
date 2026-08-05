import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import Button from "./Button";
import StatusChip from "./StatusChip";
import { useLanguage } from "../context/LanguageContext";

export type DeliverableRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  expiry_date: string | null;
  category: string | null;
  kind: string | null;
  cadence?: string | null;
  direction: string | null;
  time_status: string | null;
  days_remaining?: number | null;
  pending_detail: boolean;
};

type Suggestion = {
  key: string;
  title: string;
  category: string;
  kind: string;
  cadence: string;
  source: string;
  already_present: boolean;
  conditional?: boolean;
  origin: string;
};

type SuggestionsPayload = {
  country_code: string;
  suggestions: Suggestion[];
  blind_spot_nudges: { key: string; nudge: { tr: string; en: string }; category: string }[];
  contract_scan_available: boolean;
  source: string;
};

type Props = {
  projectId: string;
};

const CATEGORY_ORDER = [
  "hse",
  "insurance",
  "bond_security",
  "statutory",
  "report",
  "certification",
  "permit_approval",
  "administrative",
  "other",
];

const CADENCE_LABEL: Record<string, { tr: string; en: string }> = {
  one_time: { tr: "Tek sefer", en: "One-time" },
  recurring: { tr: "Tekrarlayan", en: "Recurring" },
  standing_renewal: { tr: "Yenilemeli", en: "Renewal" },
};

export default function DeliverablesModule({ projectId }: Props) {
  const navigate = useNavigate();
  const { lang, t } = useLanguage();

  const [rows, setRows] = useState<DeliverableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [timeFilter, setTimeFilter] = useState<"" | "overdue" | "expiring_soon" | "recurring">("");
  const [draftOnly, setDraftOnly] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionsPayload | null>(null);
  const [suggestKeyword, setSuggestKeyword] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bg = "var(--color-bg-primary)";
  const cardBg = "var(--color-bg-secondary)";
  const border = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond = "var(--color-text-secondary)";

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<DeliverableRow[]>(`/projects/${projectId}/deliverables?limit=200`)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const live = rows.filter((d) => !d.pending_detail);
    const open = live.filter((d) => d.status === "open" || d.status === "in_progress");
    return {
      overdue: live.filter((d) => d.time_status === "overdue").length,
      expiring: live.filter((d) => d.time_status === "expiring_soon").length,
      open: open.length,
      completed: live.filter((d) => d.status === "completed").length,
      recurring: live.filter((d) => d.cadence === "recurring").length,
      drafts: rows.filter((d) => d.pending_detail).length,
      total: rows.length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((d) => {
      if (draftOnly && !d.pending_detail) return false;
      if (!draftOnly && d.pending_detail && timeFilter) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (timeFilter === "overdue" && d.time_status !== "overdue") return false;
      if (timeFilter === "expiring_soon" && d.time_status !== "expiring_soon") return false;
      if (timeFilter === "recurring" && d.cadence !== "recurring") return false;
      if (keyword) {
        const q = keyword.toLowerCase();
        if (!d.title.toLowerCase().includes(q) && !(d.category ?? "").includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, timeFilter, keyword, draftOnly]);

  const grouped = useMemo(() => {
    const map = new Map<string, DeliverableRow[]>();
    for (const d of filtered) {
      const cat = d.category || "other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(d);
    }
    const keys = [
      ...CATEGORY_ORDER.filter((c) => map.has(c)),
      ...[...map.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
    ];
    return keys.map((k) => ({ category: k, items: map.get(k)! }));
  }, [filtered]);

  const openSuggestions = async () => {
    setShowSuggestions(true);
    setSuggestKeyword("");
    setSuggestLoading(true);
    setError(null);
    try {
      const data = await api.get<SuggestionsPayload>(
        `/projects/${projectId}/deliverables/suggestions`
      );
      setSuggestions(data);
      const pre = new Set(
        (data.suggestions || [])
          .filter((s) => !s.already_present && !s.conditional)
          .map((s) => s.key)
      );
      setSelectedKeys(pre);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      setSuggestLoading(false);
    }
  };

  const filteredSuggestions = useMemo(() => {
    const list = suggestions?.suggestions ?? [];
    const q = suggestKeyword.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const cadenceLabel = (CADENCE_LABEL[s.cadence]?.[lang] ?? s.cadence).toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.kind.toLowerCase().includes(q) ||
        s.cadence.toLowerCase().includes(q) ||
        cadenceLabel.includes(q) ||
        s.key.toLowerCase().includes(q)
      );
    });
  }, [suggestions, suggestKeyword, lang]);

  const acceptSelected = async () => {
    if (selectedKeys.size === 0) return;
    setAccepting(true);
    setError(null);
    try {
      const contract = await api.get<{ id: string } | null>(`/projects/${projectId}/contract`);
      if (!contract?.id) {
        setError(
          lang === "tr"
            ? "Önce kontrat tanımlayın."
            : "Register a contract first."
        );
        return;
      }
      await api.post(`/projects/${projectId}/deliverables/suggestions/accept`, {
        contract_id: contract.id,
        keys: [...selectedKeys],
      });
      setShowSuggestions(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Accept failed");
    } finally {
      setAccepting(false);
    }
  };

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const trackDate = (d: DeliverableRow) => d.due_date ?? d.expiry_date ?? null;

  const timeColor = (ts: string | null) => {
    if (ts === "overdue") return "var(--color-alert-red)";
    if (ts === "expiring_soon") return "var(--color-warning)";
    return textSecond;
  };

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        background: active ? "var(--color-accent)" : "transparent",
        color: active ? "#F5F2ED" : textSecond,
        border: `1px solid ${active ? "var(--color-accent)" : border}`,
        padding: "4px 10px",
        fontSize: 11,
        fontFamily: "var(--font-ui)",
        cursor: "pointer",
        textTransform: "capitalize",
      }}
    >
      {label}
    </button>
  );

  const summaryCell = (
    label: string,
    value: number,
    color: string,
    onClick: () => void,
    active: boolean
  ) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 100,
        textAlign: "left",
        padding: "12px 14px",
        background: active ? "var(--color-accent-wash)" : cardBg,
        border: `0.5px solid ${active ? "var(--color-accent)" : border}`,
        cursor: "pointer",
      }}
    >
      <p
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: textSecond,
          margin: "0 0 6px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-brand)",
          fontSize: "1.5rem",
          color,
          margin: 0,
          fontWeight: 500,
        }}
      >
        {value}
      </p>
    </button>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-brand)",
              fontSize: "var(--type-h1-module)",
              color: textPrimary,
              fontWeight: 500,
            }}
          >
            {t("module.deliverables")}
          </div>
          <p style={{ fontSize: 12, color: textSecond, margin: "4px 0 0" }}>
            {lang === "tr"
              ? "C&C yükümlülük takibi — vade, yenileme ve kanıt."
              : "C&C obligation tracking — due, renewal, and evidence."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" type="button" onClick={openSuggestions}>
            {lang === "tr" ? "Önerileri gözden geçir" : "Review suggestions"}
          </Button>
          <Button
            size="sm"
            type="button"
            onClick={() =>
              navigate(`/projects/${projectId}/workspace/deliverables/new`)
            }
          >
            {t("action.newdeliverable")}
          </Button>
        </div>
      </div>

      {/* Tracking strip */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {summaryCell(
          lang === "tr" ? "Vadesi geçmiş" : "Overdue",
          counts.overdue,
          "var(--color-alert-red)",
          () => setTimeFilter(timeFilter === "overdue" ? "" : "overdue"),
          timeFilter === "overdue"
        )}
        {summaryCell(
          lang === "tr" ? "Yaklaşan" : "Expiring soon",
          counts.expiring,
          "var(--color-warning)",
          () =>
            setTimeFilter(timeFilter === "expiring_soon" ? "" : "expiring_soon"),
          timeFilter === "expiring_soon"
        )}
        {summaryCell(
          lang === "tr" ? "Açık" : "Open",
          counts.open,
          textPrimary,
          () => {
            setDraftOnly(false);
            setStatusFilter(statusFilter === "open" ? "" : "open");
            setTimeFilter("");
          },
          statusFilter === "open" && !draftOnly
        )}
        {summaryCell(
          lang === "tr" ? "Tamamlanan" : "Completed",
          counts.completed,
          "var(--color-success)",
          () => {
            setDraftOnly(false);
            setStatusFilter(statusFilter === "completed" ? "" : "completed");
            setTimeFilter("");
          },
          statusFilter === "completed" && !draftOnly
        )}
        {summaryCell(
          lang === "tr" ? "Tekrarlayan" : "Recurring",
          counts.recurring,
          "var(--color-copper)",
          () => setTimeFilter(timeFilter === "recurring" ? "" : "recurring"),
          timeFilter === "recurring"
        )}
        {summaryCell(
          lang === "tr" ? "Taslak" : "Drafts",
          counts.drafts,
          textSecond,
          () => {
            setKeyword("");
            setStatusFilter("");
            setTimeFilter("");
            // soft filter via keyword won't work — use a dedicated filter
            setDraftOnly((v) => !v);
          },
          draftOnly
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={lang === "tr" ? "Ara…" : "Search…"}
          style={{
            background: cardBg,
            border: `1px solid ${border}`,
            color: textPrimary,
            fontSize: 12,
            padding: "6px 10px",
            fontFamily: "var(--font-ui)",
            minWidth: 160,
            outline: "none",
          }}
        />
        {chip(t("filter.all"), !statusFilter && !timeFilter && !draftOnly, () => {
          setStatusFilter("");
          setTimeFilter("");
          setDraftOnly(false);
        })}
        {["open", "in_progress", "completed", "not_applicable"].map((s) =>
          chip(s.replace("_", " "), statusFilter === s, () => {
            setStatusFilter(statusFilter === s ? "" : s);
            setTimeFilter("");
            setDraftOnly(false);
          })
        )}
      </div>

      {error && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", marginBottom: 8 }}>
          {error}
        </p>
      )}

      {/* Suggestions panel */}
      {showSuggestions && (
        <div
          style={{
            marginBottom: 20,
            padding: 16,
            background: cardBg,
            border: `0.5px solid ${border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: "var(--font-brand)",
                  fontSize: "var(--type-h2)",
                  color: textPrimary,
                  margin: 0,
                  fontWeight: 500,
                }}
              >
                {lang === "tr" ? "Öneri listesi" : "Suggestion list"}
              </p>
              <p style={{ fontSize: 12, color: textSecond, margin: "4px 0 0" }}>
                {suggestions?.contract_scan_available
                  ? lang === "tr"
                    ? "Kontrat taraması + kütüphane"
                    : "Contract scan + library"
                  : lang === "tr"
                    ? `Ülke kütüphanesi (${suggestions?.country_code ?? "…"}) — kontrat LLM taraması henüz bağlı değil. Çoklu seçip kabul edin (HITL).`
                    : `Country library (${suggestions?.country_code ?? "…"}) — contract LLM scan not wired yet. Multi-select & accept (HITL).`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSuggestions(false)}
              style={{
                background: "none",
                border: "none",
                color: textSecond,
                cursor: "pointer",
                fontSize: 18,
              }}
            >
              ×
            </button>
          </div>

          {suggestLoading ? (
            <p style={{ fontSize: 12, color: textSecond }}>{t("state.loading")}</p>
          ) : (
            <>
              {(suggestions?.blind_spot_nudges ?? []).length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {suggestions!.blind_spot_nudges.map((n) => (
                    <p
                      key={n.key}
                      style={{
                        fontSize: 12,
                        color: "var(--color-warning)",
                        margin: "0 0 6px",
                        padding: "8px 10px",
                        background: bg,
                        borderLeft: "2px solid var(--color-warning)",
                      }}
                    >
                      {n.nudge[lang]}
                    </p>
                  ))}
                </div>
              )}
              <input
                type="search"
                value={suggestKeyword}
                onChange={(e) => setSuggestKeyword(e.target.value)}
                placeholder={
                  lang === "tr"
                    ? "Önerilerde ara (başlık, kategori…)"
                    : "Search suggestions (title, category…)"
                }
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 10,
                  padding: "8px 10px",
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  color: textPrimary,
                  fontSize: 13,
                  fontFamily: "var(--font-ui)",
                }}
              />
              <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
                {filteredSuggestions.length === 0 ? (
                  <p
                    style={{
                      fontSize: 12,
                      color: textSecond,
                      fontStyle: "italic",
                      margin: 0,
                      padding: "8px 0",
                    }}
                  >
                    {lang === "tr" ? "Eşleşen öneri yok." : "No matching suggestions."}
                  </p>
                ) : (
                  filteredSuggestions.map((s) => (
                  <label
                    key={s.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px 1fr auto",
                      gap: 10,
                      alignItems: "center",
                      padding: "8px 10px",
                      marginBottom: 4,
                      background: bg,
                      opacity: s.already_present ? 0.45 : 1,
                      cursor: s.already_present ? "default" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={s.already_present}
                      checked={selectedKeys.has(s.key)}
                      onChange={() => toggleKey(s.key)}
                    />
                    <div>
                      <p style={{ fontSize: 13, color: textPrimary, margin: 0 }}>
                        {s.title}
                        {s.conditional ? " *" : ""}
                      </p>
                      <span
                        style={{
                          fontSize: 11,
                          color: textSecond,
                          fontFamily: "var(--font-meta)",
                        }}
                      >
                        {s.category} · {s.kind} ·{" "}
                        {CADENCE_LABEL[s.cadence]?.[lang] ?? s.cadence}
                        {s.already_present
                          ? lang === "tr"
                            ? " · zaten var"
                            : " · already added"
                          : ""}
                      </span>
                    </div>
                  </label>
                  ))
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  size="sm"
                  type="button"
                  onClick={acceptSelected}
                  disabled={accepting || selectedKeys.size === 0}
                >
                  {accepting
                    ? lang === "tr"
                      ? "Ekleniyor…"
                      : "Adding…"
                    : lang === "tr"
                      ? `Seçilenleri ekle (${selectedKeys.size})`
                      : `Add selected (${selectedKeys.size})`}
                </Button>
                <button
                  type="button"
                  onClick={() => setShowSuggestions(false)}
                  style={{
                    background: "none",
                    border: `1px solid ${border}`,
                    color: textSecond,
                    padding: "6px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {lang === "tr" ? "Kapat" : "Close"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 12, color: textSecond }}>{t("state.loading")}</p>
      ) : filtered.length === 0 ? (
        <div style={{ padding: "28px 16px", background: cardBg, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: textPrimary, marginBottom: 8 }}>
            {t("state.nodeliverables")}
          </p>
          <p style={{ fontSize: 12, color: textSecond, marginBottom: 16 }}>
            {lang === "tr"
              ? "Boş kanvasla kalmayın — kütüphaneden çoklu öneri alın veya tek kalem ekleyin."
              : "Don't start from a blank canvas — pull multi-suggestions from the library or add one."}
          </p>
          <Button size="sm" type="button" onClick={openSuggestions}>
            {lang === "tr" ? "Önerileri gözden geçir" : "Review suggestions"}
          </Button>
        </div>
      ) : (
        grouped.map(({ category, items }) => (
          <div key={category} style={{ marginBottom: 20 }}>
            <p
              style={{
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: textSecond,
                marginBottom: 8,
                borderBottom: `0.5px solid ${border}`,
                paddingBottom: 6,
              }}
            >
              {category.replace("_", " ")} · {items.length}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 8,
              }}
            >
              {items.map((d) => (
                <div
                  key={d.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    navigate(
                      `/projects/${projectId}/workspace/deliverables/${d.id}`
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      navigate(
                        `/projects/${projectId}/workspace/deliverables/${d.id}`
                      );
                  }}
                  style={{
                    padding: "14px 14px 12px",
                    background: cardBg,
                    opacity: d.pending_detail ? 0.72 : 1,
                    borderLeft: `3px solid ${
                      d.pending_detail
                        ? "var(--color-border-medium)"
                        : d.time_status === "overdue"
                          ? "var(--color-alert-red)"
                          : d.time_status === "expiring_soon"
                            ? "var(--color-warning)"
                            : d.cadence === "recurring"
                              ? "var(--color-copper)"
                              : "var(--color-accent-light)"
                    }`,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: textPrimary,
                        margin: 0,
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      {d.title}
                    </p>
                    <StatusChip status={d.pending_detail ? "draft" : d.status} />
                  </div>
                  <p style={{ fontSize: 11, color: textSecond, margin: "0 0 10px" }}>
                    {d.kind ?? "—"}
                    {" · "}
                    {CADENCE_LABEL[d.cadence ?? ""]?.[lang] ?? d.cadence ?? "—"}
                    {d.pending_detail
                      ? ` · ${lang === "tr" ? "taslak — açıp kaydedin" : "draft — open & save"}`
                      : ""}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontFamily: "var(--font-meta)",
                        color: d.pending_detail
                          ? textSecond
                          : timeColor(d.time_status),
                      }}
                    >
                      {d.pending_detail
                        ? lang === "tr"
                          ? "Onay bekliyor"
                          : "Awaiting confirm"
                        : (trackDate(d) ?? "—")}
                      {!d.pending_detail && d.time_status === "overdue"
                        ? lang === "tr"
                          ? " · geçmiş"
                          : " · overdue"
                        : !d.pending_detail && d.time_status === "expiring_soon"
                          ? lang === "tr"
                            ? " · yaklaşıyor"
                            : " · soon"
                          : ""}
                    </span>
                    {!d.pending_detail &&
                      d.days_remaining != null &&
                      d.time_status && (
                      <span
                        style={{
                          fontSize: 11,
                          color: textSecond,
                          fontFamily: "var(--font-meta)",
                        }}
                      >
                        {d.days_remaining}d
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
