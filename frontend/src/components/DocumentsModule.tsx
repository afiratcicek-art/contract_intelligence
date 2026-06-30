import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

/* ── Local types ───────────────────────────────────────────
   Mirrors Workspace.tsx SearchResult + minimal RFI/Corr
   shapes from backend list endpoints. Keep local — these
   are component-scoped, not application-wide types.       */
interface RFIRow {
  id: string;
  rfi_number: string;
  subject: string;
  status: string;
  submitted_date: string;
  parent_id?: string | null;
  rfi_type?: string;
}

interface CorrRow {
  id: string;
  corr_number: string;
  subject: string;
  status: string;
  correspondence_date: string;
  parent_id?: string | null;
  has_response?: boolean;
}

interface DocSearchResult {
  module: "rfi" | "correspondence";
  ref: string;
  subject: string;
  status: string;
  date: string;
  id: string;
  parent_id?: string | null;
  has_response?: boolean;
  rfi_type?: string;
}

interface Props {
  projectId: string;
}

export default function DocumentsModule({ projectId }: Props) {
  const navigate = useNavigate();

  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<DocSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Design tokens — consistent with rest of app */
  const bg          = "var(--color-bg-primary)";
  const cardBg      = "var(--color-bg-secondary)";
  const border      = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond  = "var(--color-text-secondary)";
  const accent      = "var(--color-accent)";

  /* ── Navigation ─────────────────────────────────────────
     Local mirror of Workspace.tsx generalNavTarget.
     Kept here so DocumentsModule has no page-level deps.  */
  const navTarget = (mod: "rfi" | "correspondence", id: string) => {
    if (mod === "correspondence")
      return `/projects/${projectId}/workspace/correspondence/${id}`;
    if (mod === "rfi")
      return `/projects/${projectId}/workspace/rfis/${id}`;
    return `/projects/${projectId}/workspace`;
  };

  /* ── Search ──────────────────────────────────────────────
     Parallel fetch: rfis + correspondences chain RPCs
     (invoked server-side when q is present).
     Empty query → clear results, no API call.            */
  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) { setResults([]); return; }
      setLoading(true);
      try {
        const enc = encodeURIComponent(q.trim());
        const [rfis, corrs] = await Promise.all([
          api.get<RFIRow[]>(
            `/projects/${projectId}/rfis?limit=100&q=${enc}`
          ),
          api.get<CorrRow[]>(
            `/projects/${projectId}/correspondences?limit=100&q=${enc}`
          ),
        ]);

        const rfiResults: DocSearchResult[] = (rfis ?? []).map((r) => ({
          module: "rfi" as const,
          ref:     r.rfi_number,
          subject: r.subject,
          status:  r.status,
          date:    r.submitted_date,
          id:      r.id,
          parent_id: r.parent_id,
          rfi_type:  r.rfi_type,
        }));

        const corrResults: DocSearchResult[] = (corrs ?? []).map((c) => ({
          module: "correspondence" as const,
          ref:     c.corr_number,
          subject: c.subject,
          status:  c.status,
          date:    c.correspondence_date,
          id:      c.id,
          parent_id:    c.parent_id,
          has_response: c.has_response,
        }));

        /* Correspondence first — mirrors General Search ordering */
        setResults([...corrResults, ...rfiResults]);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(val), 400);
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  /* ── Status pill ─────────────────────────────────────── */
  const statusPill = (status: string) => {
    const map: Record<string, { bg: string; color: string }> = {
      open:      { bg: "var(--color-warning-bg)",  color: "var(--color-warning)"  },
      responded: { bg: "var(--color-success-bg)",  color: "var(--color-success)"  },
      closed:    { bg: "var(--color-bg-secondary)", color: "var(--color-text-secondary)" },
      pending:   { bg: "var(--color-warning-bg)",  color: "var(--color-warning)"  },
    };
    const s = map[status] ?? map["pending"];
    return (
      <span style={{
        fontSize: 10, fontWeight: 500, padding: "2px 8px",
        backgroundColor: s.bg, color: s.color,
        textTransform: "uppercase" as const, letterSpacing: "0.04em",
        fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" as const,
      }}>
        {status}
      </span>
    );
  };

  /* ── Render: Correspondence rows (parent-child) ───────── */
  const renderCorrSection = (group: DocSearchResult[]) => {
    const childMap = new Map<string, DocSearchResult[]>();
    group.filter((r) => r.parent_id).forEach((r) => {
      const arr = childMap.get(r.parent_id!) ?? [];
      arr.push(r);
      childMap.set(r.parent_id!, arr);
    });
    const parents = group.filter((r) => !r.parent_id);

    const renderRow = (r: DocSearchResult, isChild = false) => (
      <div key={r.id}>
        <div
          onClick={() => navigate(navTarget(r.module, r.id))}
          style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: isChild ? "7px 12px 7px 28px" : "9px 12px",
            background: isChild ? bg : cardBg,
            marginBottom: 2, cursor: "pointer",
            borderLeft: `2px solid ${
              isChild ? accent
              : r.status === "responded" ? "var(--color-success)"
              : accent
            }`,
          }}
        >
          <div>
            <span style={{
              fontFamily: "JetBrains Mono, monospace", fontSize: 10,
              color: textSecond, display: "flex", alignItems: "center", gap: 3,
            }}>
              {isChild && (
                <span style={{ color: accent, marginRight: 2 }}>└</span>
              )}
              {r.ref}
              {r.has_response && (
                <span style={{ fontSize: 11, color: accent }}>↩</span>
              )}
            </span>
            <p style={{
              fontSize: isChild ? 11 : 12, color: textPrimary,
              fontWeight: 500, marginTop: 2,
            }}>
              {r.subject}
            </p>
            <p style={{ fontSize: 10, color: textSecond, marginTop: 1 }}>
              {r.date}
            </p>
          </div>
          {statusPill(r.status)}
        </div>
        {(childMap.get(r.id) ?? []).map((child) =>
          renderRow(child, true)
        )}
      </div>
    );

    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
          letterSpacing: "0.08em", color: textSecond, marginBottom: 8,
          fontFamily: "Inter, sans-serif",
        }}>
          Correspondence
        </div>
        {parents.map((r) => renderRow(r, false))}
        {/* Orphan children — parent not in result set */}
        {group
          .filter((r) => r.parent_id && !group.find((p) => p.id === r.parent_id))
          .map((r) => renderRow(r, false))}
      </div>
    );
  };

  /* ── Render: RFI rows (parent-child) ─────────────────── */
  const renderRfiSection = (group: DocSearchResult[]) => {
    const childMap = new Map<string, DocSearchResult[]>();
    group.filter((r) => r.parent_id).forEach((r) => {
      const arr = childMap.get(r.parent_id!) ?? [];
      arr.push(r);
      childMap.set(r.parent_id!, arr);
    });
    const parents = group.filter((r) => !r.parent_id);

    const renderRow = (r: DocSearchResult, isChild = false) => (
      <div key={r.id}>
        <div
          onClick={() => navigate(navTarget(r.module, r.id))}
          style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between",
            padding: isChild ? "7px 12px 7px 28px" : "9px 12px",
            background: isChild ? bg : cardBg,
            marginBottom: 2, cursor: "pointer",
            borderLeft: `2px solid ${
              isChild ? accent
              : r.status === "responded" ? "var(--color-success)"
              : accent
            }`,
          }}
        >
          <div>
            <span style={{
              fontFamily: "JetBrains Mono, monospace", fontSize: 10,
              color: textSecond, display: "flex", alignItems: "center", gap: 3,
            }}>
              {isChild && (
                <span style={{ color: accent, marginRight: 2 }}>└</span>
              )}
              {r.ref}
              {r.rfi_type && r.rfi_type !== "original" && (
                <span style={{
                  fontSize: 11, fontWeight: 500, padding: "1px 4px",
                  backgroundColor:
                    r.rfi_type === "response"
                      ? "var(--color-success-bg)"
                      : "var(--color-bg-secondary)",
                  color:
                    r.rfi_type === "response"
                      ? "var(--color-success)"
                      : textSecond,
                  textTransform: "uppercase" as const,
                }}>
                  {r.rfi_type === "response" ? "RES" : "REV"}
                </span>
              )}
            </span>
            <p style={{
              fontSize: isChild ? 11 : 12, color: textPrimary,
              fontWeight: 500, marginTop: 2,
            }}>
              {r.subject}
            </p>
            <p style={{ fontSize: 10, color: textSecond, marginTop: 1 }}>
              {r.date}
            </p>
          </div>
          {r.rfi_type === "response" ? (
            <span style={{
              fontSize: 10, fontWeight: 500, padding: "2px 8px",
              backgroundColor: "var(--color-success-bg)",
              color: "var(--color-success)",
              textTransform: "uppercase" as const, letterSpacing: "0.04em",
            }}>
              RESPONSE
            </span>
          ) : statusPill(r.status)}
        </div>
        {(childMap.get(r.id) ?? []).map((child) =>
          renderRow(child, true)
        )}
      </div>
    );

    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
          letterSpacing: "0.08em", color: textSecond, marginBottom: 8,
          fontFamily: "Inter, sans-serif",
        }}>
          RFIs
        </div>
        {parents.map((r) => renderRow(r, false))}
        {group
          .filter((r) => r.parent_id && !group.find((p) => p.id === r.parent_id))
          .map((r) => renderRow(r, false))}
      </div>
    );
  };

  /* ── Derived lists ───────────────────────────────────── */
  const corrGroup = results.filter((r) => r.module === "correspondence");
  const rfiGroup  = results.filter((r) => r.module === "rfi");

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 20 }}>

      {/* Search bar */}
      <div style={{ position: "relative" as const }}>
        <input
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Belgeleri ara — konu, anahtar kelime, referans..."
          style={{
            width: "100%", boxSizing: "border-box" as const,
            padding: "9px 36px 9px 12px",
            background: cardBg, border: `1px solid ${border}`,
            borderRadius: 0, fontSize: 13, color: textPrimary,
            fontFamily: "Inter, sans-serif", outline: "none",
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); }}
            style={{
              position: "absolute" as const, right: 10, top: "50%",
              transform: "translateY(-50%)",
              background: "none", border: "none",
              fontSize: 16, color: textSecond, cursor: "pointer", padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* States */}
      {loading && (
        <p style={{ fontSize: 12, color: textSecond, fontFamily: "Inter, sans-serif" }}>
          Aranıyor...
        </p>
      )}

      {!loading && query.trim() && results.length === 0 && (
        <p style={{
          fontSize: 12, color: textSecond, fontStyle: "italic",
          fontFamily: "Inter, sans-serif",
        }}>
          Sonuç bulunamadı.
        </p>
      )}

      {!query.trim() && (
        <p style={{
          fontSize: 12, color: textSecond, fontStyle: "italic",
          fontFamily: "Inter, sans-serif",
        }}>
          Proje belgelerini aramak için yazmaya başlayın.
        </p>
      )}

      {/* Results — Correspondence + RFI sections */}
      {!loading && results.length > 0 && (
        <div>
          {corrGroup.length > 0 && renderCorrSection(corrGroup)}
          {rfiGroup.length  > 0 && renderRfiSection(rfiGroup)}
        </div>
      )}

      {/* ── Document Relationship Graph ───────────────────────
          Placeholder — DocumentRelationGraph.tsx (pending).
          Feeds from document_relations table (migration 018).
          Will show node graph of related docs when populated. */}
      <div style={{
        marginTop: 8, padding: "14px 16px",
        background: cardBg, borderLeft: `2px solid ${border}`,
      }}>
        <p style={{
          fontSize: 11, fontWeight: 500, color: textSecond,
          textTransform: "uppercase" as const, letterSpacing: "0.08em",
          fontFamily: "Inter, sans-serif", margin: 0,
        }}>
          Belge İlişki Grafiği
        </p>
        <p style={{
          fontSize: 11, color: textSecond, fontStyle: "italic",
          fontFamily: "Inter, sans-serif", marginTop: 6, marginBottom: 0,
        }}>
          İlişki grafiği yakında aktif olacak.
        </p>
      </div>

    </div>
  );
}
