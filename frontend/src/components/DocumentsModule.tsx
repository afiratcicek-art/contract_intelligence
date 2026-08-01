import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useDebounce } from "../hooks/useDebounce";
import {
  api,
  fetchContractResolution,
  fetchDocumentStats,
  listEventsByType,
  type AmendmentRow,
  type ChangeRow,
  type ContractDocumentRef,
  type ChronologyEventByType,
  type DocumentStats,
} from "../services/api";
import DocumentStatsPanel, { chronologyTypeLabel } from "./DocumentStatsPanel";
import FocusedRelationGraph from "./FocusedRelationGraph";
import StatusChip from "./StatusChip";

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
  module: "rfi" | "correspondence" | "change" | "amendment" | "contract" | "chronology";
  ref: string;
  subject: string;
  status: string;
  date: string;
  id: string;
  parent_id?: string | null;
  has_response?: boolean;
  rfi_type?: string;
}

/** The dimensions a click on the stats panel can carry.
 *  A keyword or location chip carries a search term. A card row carries a
 *  FIELD of a specific entity — the RFI card's rows are disciplines, the
 *  correspondence card's rows are types, Contract & Amendments rows are
 *  changeStatus / amendment / contractDoc, Diğer Belgeler rows are
 *  chronologyType. doSearch switches on this, and the switch is
 *  exhaustiveness-checked, so adding a member here without handling it
 *  there is a compile error rather than a silent keyword search. */
type FilterType =
  | "corrType"
  | "rfiDiscipline"
  | "keyword"
  | "location"
  | "changeStatus"
  | "amendment"
  | "contractDoc"
  | "chronologyType";

interface ActiveFilter {
  type: FilterType;
  value: string;
}

interface Props {
  projectId: string;
}

export default function DocumentsModule({ projectId }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery]     = useState("");
  const debouncedQuery = useDebounce(query, 400);

  /* ── Focus mode ────────────────────────────────────────
     Driven by ?focus_type=correspondence|rfi&focus_id=...
     in the URL (alongside ?module=documents). Set by
     RelationPopup's "İlişki Haritasını Gör" link and by
     the per-row map trigger button. Cleared via badge ×. */
  const [focusType, setFocusType] = useState<"correspondence" | "rfi" | null>(null);
  const [focusId,   setFocusId]   = useState<string | null>(null);
  const [focusRef,  setFocusRef]  = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ft = params.get("focus_type");
    const fid = params.get("focus_id");
    const fref = params.get("focus_ref");
    if ((ft === "correspondence" || ft === "rfi") && fid) {
      setFocusType(ft);
      setFocusId(fid);
      setFocusRef(fref);
    } else {
      setFocusType(null);
      setFocusId(null);
      setFocusRef(null);
    }
  }, [location.search]);

  const clearFocus = () => {
    const params = new URLSearchParams(location.search);
    params.delete("focus_type");
    params.delete("focus_id");
    params.delete("focus_ref");
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true }
    );
  };

  const [results, setResults] = useState<DocSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter | null>(null);

  useEffect(() => {
    setStatsLoading(true);
    fetchDocumentStats(projectId)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, [projectId]);

  /* Design tokens — consistent with rest of app */
  const bg          = "var(--color-bg-primary)";
  const cardBg      = "var(--color-bg-secondary)";
  const border      = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond  = "var(--color-text-secondary)";
  const accent      = "var(--color-accent)";
  const accentText  = "var(--color-accent-text)";

  /* ── Navigation ─────────────────────────────────────────
     Local mirror of Workspace.tsx generalNavTarget.
     Kept here so DocumentsModule has no page-level deps.  */
  const navTarget = (
    mod: "rfi" | "correspondence" | "change" | "amendment" | "contract" | "chronology",
    id: string,
  ) => {
    if (mod === "correspondence")
      return `/projects/${projectId}/workspace/correspondence/${id}`;
    if (mod === "rfi")
      return `/projects/${projectId}/workspace/rfis/${id}`;
    if (mod === "change")
      return `/projects/${projectId}/workspace/changes/${id}`;
    if (mod === "amendment")
      return `/projects/${projectId}/workspace?module=changes&tab=inforce`;
    if (mod === "contract")
      return `/projects/${projectId}/workspace?module=changes&tab=inforce`;
    if (mod === "chronology")
      return `/projects/${projectId}/workspace?module=chronologies`;
    return `/projects/${projectId}/workspace`;
  };

  /* ── Search ──────────────────────────────────────────────
     Parallel fetch: rfis + correspondences chain RPCs
     (invoked server-side when q is present), plus govern-record
     endpoints for Contract & Amendments card rows.
     Empty query → clear results, no API call.            */
  const doSearch = useCallback(
    async (q: string, filter: ActiveFilter | null) => {
      if (!q.trim() && !filter) { setResults([]); return; }
      setLoading(true);
      try {
        const enc = encodeURIComponent(q.trim());
        const base = `/projects/${projectId}`;

        /* Free text asks both lists the same question, so both are queried.
           A card row does not: the RFI card's "Architectural" is a question
           about RFIs, and asking correspondences for the literal word
           "Architectural" is what produced the wrong results this replaces.
           So a card row narrows one list and drops the other entirely.
           Govern-record rows (change/amendment/contract) likewise skip RFI+corr. */
        let rfiUrl: string | null = `${base}/rfis?limit=100&q=${enc}`;
        let corrUrl: string | null = `${base}/correspondences?limit=100&q=${enc}`;
        let changeUrl: string | null = null;
        let amendmentUrl: string | null = null;
        let fetchContracts = false;
        let chronologyType: string | null = null;

        if (filter) {
          switch (filter.type) {
            case "rfiDiscipline": {
              const kw = q.trim() ? `&q=${enc}` : "";
              rfiUrl = `${base}/rfis?limit=100&discipline=${encodeURIComponent(filter.value)}${kw}`;
              corrUrl = null;
              break;
            }
            case "corrType": {
              const kw = q.trim() ? `&q=${enc}` : "";
              corrUrl = `${base}/correspondences?limit=100&type=${encodeURIComponent(filter.value)}${kw}`;
              rfiUrl = null;
              break;
            }
            case "changeStatus": {
              /* §6 bucket→DB status already resolved in DocumentStatsPanel;
                 value may be comma-joined multi-status ("impact_submitted,under_negotiation"). */
              const statuses = filter.value.split(",").map((s) => s.trim()).filter(Boolean);
              const statusQs = statuses
                .map((s) => `status=${encodeURIComponent(s)}`)
                .join("&");
              const kw = q.trim() ? `&q=${enc}` : "";
              changeUrl = `${base}/changes?limit=100&${statusQs}${kw}`;
              rfiUrl = null;
              corrUrl = null;
              break;
            }
            case "amendment": {
              /* Endpoint has no q — list all amendments (location-chip analogue). */
              amendmentUrl = `${base}/amendments?limit=100`;
              rfiUrl = null;
              corrUrl = null;
              break;
            }
            case "contractDoc": {
              fetchContracts = true;
              rfiUrl = null;
              corrUrl = null;
              break;
            }
            case "chronologyType": {
              /* tık===sayı: manual_only=true mirrors by_chronology_type. */
              chronologyType = filter.value;
              rfiUrl = null;
              corrUrl = null;
              break;
            }
            case "keyword":
            case "location":
              /* Both stay text searches across both lists. Neither endpoint has
                 a location parameter, so location cannot become a real filter
                 without backend work — do not fake it here. */
              break;
            default: {
              /* Exhaustiveness guard. Add a member to FilterType without
                 handling it above and this line stops compiling. That is the
                 point: an unhandled type would fall through to a keyword
                 search, which is the bug this switch exists to kill. */
              const _exhaustive: never = filter.type;
              void _exhaustive;
              break;
            }
          }
        }

        const [rfis, corrs, changes, amendments, resolution, chronoEvents] = await Promise.all([
          rfiUrl ? api.get<RFIRow[]>(rfiUrl) : Promise.resolve<RFIRow[]>([]),
          corrUrl ? api.get<CorrRow[]>(corrUrl) : Promise.resolve<CorrRow[]>([]),
          changeUrl ? api.get<ChangeRow[]>(changeUrl) : Promise.resolve<ChangeRow[]>([]),
          amendmentUrl
            ? api.get<AmendmentRow[]>(amendmentUrl)
            : Promise.resolve<AmendmentRow[]>([]),
          fetchContracts
            ? fetchContractResolution(projectId)
            : Promise.resolve(null),
          chronologyType
            ? listEventsByType(projectId, chronologyType, true)
            : Promise.resolve<ChronologyEventByType[]>([]),
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

        const changeResults: DocSearchResult[] = (changes ?? []).map((c) => ({
          module: "change" as const,
          ref:     c.change_number,
          subject: c.title,
          status:  c.status,
          date:    c.created_at,
          id:      c.id,
        }));

        const amendmentResults: DocSearchResult[] = (amendments ?? []).map((a) => ({
          module: "amendment" as const,
          ref:     a.amendment_number,
          subject: a.title,
          status:  a.arrival_path,
          date:    a.amendment_date ?? "",
          id:      a.id,
        }));

        const docs: ContractDocumentRef[] = resolution?.contract?.documents ?? [];
        const contractResults: DocSearchResult[] = docs
          .filter((d): d is ContractDocumentRef & { pdf_document_id: string } =>
            d.pdf_document_id != null
          )
          .map((d) => {
            const name = d.label ?? d.original_filename ?? "Belge";
            return {
              module: "contract" as const,
              ref:     name,
              subject: name,
              status:  "contract",
              date:    "",
              id:      d.pdf_document_id,
            };
          });

        const chronologyResults: DocSearchResult[] = (chronoEvents ?? []).map((e) => ({
          module: "chronology" as const,
          ref:     e.chronologies?.title ?? e.event_type,
          subject: e.subject ?? e.chronologies?.title ?? "",
          status:  e.chronologies?.entity_type ?? "",
          date:    e.event_date,
          id:      e.id,
        }));

        /* Correspondence first — mirrors General Search ordering; then RFI;
           then govern-record sections (change / amendment / contract / chronology). */
        setResults([
          ...corrResults,
          ...rfiResults,
          ...changeResults,
          ...amendmentResults,
          ...contractResults,
          ...chronologyResults,
        ]);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    /* Fire when there is something to search: a keyword, a filter, or both.
       An empty box with an active filter is valid — it means the whole
       filtered set. Only a truly empty state (no keyword AND no filter)
       clears the results. */
    if (!debouncedQuery.trim() && !activeFilter) {
      setResults([]);
      return;
    }
    doSearch(debouncedQuery, activeFilter);
  }, [debouncedQuery, activeFilter, doSearch]);

  const handleInput = (val: string) => {
    /* Typing only changes the keyword. It does NOT touch activeFilter: the
       badge stays pinned so the keyword narrows WITHIN the filter. The badge
       is cleared only by its own ✕ (removeFilter) or the box ✕. Emptying the
       box clears results only when there is also no active filter — with a
       filter present, an empty box means "the whole filtered set". */
    setQuery(val);
    if (!val.trim() && !activeFilter) {
      setResults([]);
    }
  };

  const handleFilter = (
    filterType: FilterType,
    value: string,
  ) => {
    if (filterType === "keyword" || filterType === "location") {
      /* Chips ARE keyword searches: the term belongs in the box and is the
         query. This is the original, correct behaviour — the badge model does
         not touch it. */
      setActiveFilter({ type: filterType, value });
      setQuery(value);
    } else {
      /* Card rows (corrType, rfiDiscipline, changeStatus, amendment, contractDoc,
         chronologyType) become a pinned badge. The filter leaves the box so the
         user can type a keyword ON TOP of it (where the endpoint supports q);
         the badge, not the box, now holds the filter value. */
      setActiveFilter({ type: filterType, value });
      setQuery("");
      setResults([]);
    }
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
            padding: isChild ? "8px 12px 8px 28px" : "8px 12px",
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
              fontFamily: "var(--font-meta)", fontSize: 11,
              color: textSecond, display: "flex", alignItems: "center", gap: 4,
            }}>
              {isChild && (
                <span style={{ color: accentText, marginRight: 2 }}>└</span>
              )}
              {r.ref}
              {r.has_response && (
                <span style={{ fontSize: 11, color: accentText }}>↩</span>
              )}
            </span>
            <p style={{
              fontSize: isChild ? 11 : 12, color: textPrimary,
              fontWeight: 500, marginTop: 2,
            }}>
              {r.subject}
            </p>
            <p style={{ fontSize: 11, color: textSecond, marginTop: 1 }}>
              {r.date}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const params = new URLSearchParams({
                  module: "documents",
                  focus_type: "correspondence",
                  focus_id: r.id,
                  focus_ref: r.ref,
                });
                navigate(`/projects/${projectId}/workspace?${params.toString()}`);
              }}
              title="İlişki haritasını gör"
              aria-label="İlişki haritasını gör"
              style={{
                background: "var(--color-ai-bg)", color: "var(--color-ai)",
                border: "1px solid var(--color-ai)", borderRadius: 6,
                width: 22, height: 22, display: "flex",
                alignItems: "center", justifyContent: "center",
                cursor: "pointer", padding: 0, flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2.5" />
                <circle cx="5" cy="19" r="2.5" />
                <circle cx="19" cy="19" r="2.5" />
                <line x1="12" y1="7.5" x2="6.5" y2="17" />
                <line x1="12" y1="7.5" x2="17.5" y2="17" />
              </svg>
            </button>
            <StatusChip status={r.status} />
          </div>
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
          fontFamily: "var(--font-ui)",
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
            padding: isChild ? "8px 12px 8px 28px" : "8px 12px",
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
              fontFamily: "var(--font-meta)", fontSize: 11,
              color: textSecond, display: "flex", alignItems: "center", gap: 4,
            }}>
              {isChild && (
                <span style={{ color: accentText, marginRight: 2 }}>└</span>
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
            <p style={{ fontSize: 11, color: textSecond, marginTop: 1 }}>
              {r.date}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const params = new URLSearchParams({
                  module: "documents",
                  focus_type: "rfi",
                  focus_id: r.id,
                  focus_ref: r.ref,
                });
                navigate(`/projects/${projectId}/workspace?${params.toString()}`);
              }}
              title="İlişki haritasını gör"
              aria-label="İlişki haritasını gör"
              style={{
                background: "var(--color-ai-bg)", color: "var(--color-ai)",
                border: "1px solid var(--color-ai)", borderRadius: 6,
                width: 22, height: 22, display: "flex",
                alignItems: "center", justifyContent: "center",
                cursor: "pointer", padding: 0, flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2.5" />
                <circle cx="5" cy="19" r="2.5" />
                <circle cx="19" cy="19" r="2.5" />
                <line x1="12" y1="7.5" x2="6.5" y2="17" />
                <line x1="12" y1="7.5" x2="17.5" y2="17" />
              </svg>
            </button>
            {r.rfi_type === "response" ? (
              <span style={{
                fontSize: 11, fontWeight: 500, padding: "2px 8px",
                backgroundColor: "var(--color-success-bg)",
                color: "var(--color-success)",
                textTransform: "uppercase" as const, letterSpacing: "0.04em",
              }}>
                RESPONSE
              </span>
            ) : <StatusChip status={r.status} />}
          </div>
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
          fontFamily: "var(--font-ui)",
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

  /* ── Render: flat govern-record rows (change/amendment/contract) ──
     Mirrors renderRfiSection house style, but: no parent-child, no
     relation-map button (focus graph does not cover these entities). */
  const renderRecordSection = (group: DocSearchResult[], title: string) => {
    if (group.length === 0) return null;
    const renderRow = (r: DocSearchResult) => (
      <div
        key={r.id}
        onClick={() => navigate(navTarget(r.module, r.id))}
        style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: cardBg,
          marginBottom: 2, cursor: "pointer",
          borderLeft: `2px solid ${accent}`,
        }}
      >
        <div>
          <span style={{
            fontFamily: "var(--font-meta)", fontSize: 11,
            color: textSecond,
          }}>
            {r.ref}
          </span>
          <p style={{
            fontSize: 12, color: textPrimary,
            fontWeight: 500, marginTop: 2,
          }}>
            {r.subject}
          </p>
          {r.date && (
            <p style={{ fontSize: 11, color: textSecond, marginTop: 1 }}>
              {r.date}
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusChip status={r.status} />
        </div>
      </div>
    );

    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, textTransform: "uppercase" as const,
          letterSpacing: "0.08em", color: textSecond, marginBottom: 8,
          fontFamily: "var(--font-ui)",
        }}>
          {title}
        </div>
        {group.map((r) => renderRow(r))}
      </div>
    );
  };

  /* ── Derived lists ───────────────────────────────────── */
  const corrGroup       = results.filter((r) => r.module === "correspondence");
  const rfiGroup        = results.filter((r) => r.module === "rfi");
  const changeGroup     = results.filter((r) => r.module === "change");
  const amendmentGroup  = results.filter((r) => r.module === "amendment");
  const contractGroup   = results.filter((r) => r.module === "contract");
  const chronologyGroup = results.filter((r) => r.module === "chronology");

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 20 }}>

      {/* Focus mode badge */}
      {focusId && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--color-ai-bg)", border: "1px solid var(--color-ai)",
          borderRadius: 0, padding: "8px 14px", marginBottom: 4,
        }}>
          <span style={{
            fontSize: 12, color: "var(--color-ai)", fontWeight: 500,
            fontFamily: "var(--font-ui)",
          }}>
            Odaklanıldı: {focusRef || focusId}
          </span>
          <button
            onClick={clearFocus}
            style={{
              background: "none", border: "none", color: "var(--color-ai)",
              fontSize: 16, cursor: "pointer", padding: 0,
            }}
            aria-label="Odağı kapat"
          >
            ×
          </button>
        </div>
      )}

      {activeFilter && (
        activeFilter.type === "rfiDiscipline"
        || activeFilter.type === "corrType"
        || activeFilter.type === "changeStatus"
        || activeFilter.type === "amendment"
        || activeFilter.type === "contractDoc"
        || activeFilter.type === "chronologyType"
      ) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          marginBottom: 8,
        }}>
          <span style={{ fontSize: 11, color: textSecond }}>
            {activeFilter.type === "rfiDiscipline" ? "RFI disiplini"
              : activeFilter.type === "corrType" ? "Yazışma türü"
              : activeFilter.type === "changeStatus" ? "Değişiklik durumu"
              : activeFilter.type === "amendment" ? "Amendments"
              : activeFilter.type === "chronologyType" ? "Diğer belge türü"
              : "Sözleşmeler"}:
          </span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", background: accent,
            color: "var(--color-bg-primary)", fontSize: 12, fontWeight: 500,
          }}>
            {activeFilter.type === "chronologyType"
              ? chronologyTypeLabel(activeFilter.value)
              : activeFilter.value}
            <button
              onClick={() => { setActiveFilter(null); }}
              aria-label="Filtreyi kaldır"
              style={{
                background: "none", border: "none", padding: 0,
                color: "var(--color-bg-primary)", cursor: "pointer",
                fontSize: 14, lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        </div>
      )}

      {/* Search bar */}
      <div style={{ position: "relative" as const }}>
        <input
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          disabled={!!focusId}
          placeholder={
            focusId
              ? "Odak modundasınız — aramak için odağı kapatın"
              : "Belgeleri ara — konu, anahtar kelime, referans..."
          }
          style={{
            opacity: focusId ? 0.5 : 1,
            cursor: focusId ? "not-allowed" : "text",
            width: "100%", boxSizing: "border-box" as const,
            padding: "8px 36px 8px 12px",
            background: cardBg, border: `1px solid ${border}`,
            borderRadius: 0, fontSize: 13, color: textPrimary,
            fontFamily: "var(--font-ui)", outline: "none",
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); setActiveFilter(null); }}
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
        <p style={{ fontSize: 12, color: textSecond, fontFamily: "var(--font-ui)" }}>
          Aranıyor...
        </p>
      )}

      {!loading && (query.trim() || activeFilter) && results.length === 0 && (
        <p style={{
          fontSize: 12, color: textSecond, fontStyle: "italic",
          fontFamily: "var(--font-ui)",
        }}>
          Sonuç bulunamadı.
        </p>
      )}

      {!query.trim() && !activeFilter && !focusId && statsLoading && (
        <p style={{ fontSize: 12, color: textSecond, fontFamily: "var(--font-ui)" }}>
          İstatistikler yükleniyor...
        </p>
      )}

      {!query.trim() && !activeFilter && !focusId && !statsLoading && stats && (
        <DocumentStatsPanel
          stats={stats}
          onFilter={handleFilter}
          activeFilter={activeFilter}
        />
      )}

      {/* Results — Correspondence + RFI + govern-record sections */}
      {!loading && results.length > 0 && (
        <div>
          {corrGroup.length > 0 && renderCorrSection(corrGroup)}
          {rfiGroup.length  > 0 && renderRfiSection(rfiGroup)}
          {renderRecordSection(changeGroup, "Değişiklikler")}
          {renderRecordSection(amendmentGroup, "Amendments")}
          {renderRecordSection(contractGroup, "Sözleşmeler")}
          {renderRecordSection(
            chronologyGroup,
            activeFilter?.type === "chronologyType"
              ? chronologyTypeLabel(activeFilter.value)
              : "Diğer Belgeler",
          )}
        </div>
      )}

      {focusId && focusType && (
        <FocusedRelationGraph
          projectId={projectId}
          entityType={focusType}
          entityId={focusId}
        />
      )}

    </div>
  );
}
