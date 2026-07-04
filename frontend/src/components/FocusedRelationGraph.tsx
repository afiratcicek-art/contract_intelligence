import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { entityPath } from "../utils/entityPath";

interface FocusNode {
  id: string;
  ref: string;
  subject: string;
  status: string;
  entity_type: "correspondence" | "rfi";
  tier: "chain" | "content" | "indirect";
  score: number;
}
interface CenterNode {
  id: string;
  ref: string;
  subject: string;
  status: string;
  entity_type: "correspondence" | "rfi";
  tier: "center";
  score: number;
}
interface FocusEdge {
  source: string;
  target: string;
  score: number;
  tier: "chain" | "content" | "indirect" | "cross";
}
interface FocusedGraphResponse {
  center: CenterNode;
  nodes: FocusNode[];
  edges: FocusEdge[];
  total_found: number;
  truncated: boolean;
  hidden_count: number;
}
interface Props {
  projectId: string;
  entityType: "correspondence" | "rfi";
  entityId: string;
}

const W = 760;
const H = 560;
const CX = 380;
const CY = 280;
const CENTER_R = 34;
const NODE_R_MAX = 26;
const NODE_R_MIN = 17;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

const TIER_OPACITY: Record<string, number> = {
  chain: 1,
  content: 0.7,
  indirect: 0.5,
  cross: 0.42,
};

interface LaidOutNode { x: number; y: number; r: number; }

/* ── Layout: center-anchored radial graph ──────────────────
   The center connects DIRECTLY to every node it has a
   content/indirect edge to (so the user sees the center
   relates to all of them, not just one). Chain edges between
   those nodes are ALSO drawn, as bridges — so a chain like
   CORR-009→010→011 reads as a connected sub-structure while
   each still shows its own relationship to the center.

   Ordering: nodes directly linked to center are placed on an
   arc. Within a chain, the most-recent member (a leaf in the
   parent→child chain, i.e. has no child among the set) is
   placed nearest the center (smallest radius / prime angle);
   older ancestors fan outward. Node radius shrinks with tier
   strength and chain depth so the freshest/strongest reads
   biggest.                                                    */
function computeLayout(
  center: CenterNode,
  nodes: FocusNode[],
  edges: FocusEdge[]
): Map<string, LaidOutNode> {
  const centerId = center.id;
  const idSet = new Set(nodes.map((n) => n.id));

  const chainAdj = new Map<string, string[]>();
  const childOf = new Map<string, string>();
  edges
    .filter((e) => e.tier === "chain")
    .forEach((e) => {
      if (!chainAdj.has(e.source)) chainAdj.set(e.source, []);
      if (!chainAdj.has(e.target)) chainAdj.set(e.target, []);
      chainAdj.get(e.source)!.push(e.target);
      chainAdj.get(e.target)!.push(e.source);
      childOf.set(e.target, e.source);
    });

  const directScore = new Map<string, number>();
  edges.forEach((e) => {
    if (e.tier === "chain") return;
    const other =
      e.source === centerId ? e.target : e.target === centerId ? e.source : null;
    if (other && idSet.has(other)) {
      directScore.set(other, Math.max(directScore.get(other) ?? 0, e.score));
    }
  });

  const visited = new Set<string>();
  const components: string[][] = [];
  const directIds = [...directScore.keys()];
  directIds.forEach((seed) => {
    if (visited.has(seed)) return;
    const comp: string[] = [];
    const q = [seed];
    visited.add(seed);
    while (q.length) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const nb of chainAdj.get(cur) ?? []) {
        if (!visited.has(nb) && directScore.has(nb)) {
          visited.add(nb);
          q.push(nb);
        }
      }
    }
    components.push(comp);
  });

  const result = new Map<string, LaidOutNode>();
  result.set(centerId, { x: CX, y: CY, r: CENTER_R });

  const compCount = Math.max(components.length, 1);
  components.forEach((comp, ci) => {
    const inComp = new Set(comp);
    const leaves = comp.filter((id) => {
      const kids = (chainAdj.get(id) ?? []).filter(
        (k) => inComp.has(k) && childOf.get(k) === id
      );
      return kids.length === 0;
    });
    const ordered: string[] = [];
    const seen = new Set<string>();
    const startLeaf = leaves.length ? leaves[0] : comp[0];
    let cursor: string | undefined = startLeaf;
    while (cursor && !seen.has(cursor)) {
      ordered.push(cursor);
      seen.add(cursor);
      cursor = childOf.get(cursor);
      if (cursor && !inComp.has(cursor)) cursor = undefined;
    }
    comp.forEach((id) => {
      if (!seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    });

    const baseAngle = (2 * Math.PI * ci) / compCount - Math.PI / 2;
    ordered.forEach((id, depth) => {
      const radius = 130 + depth * 92;
      const wedge = 0.34;
      const angle =
        baseAngle + (ordered.length > 1 ? (depth / ordered.length) * wedge - wedge / 2 : 0);
      const score = directScore.get(id) ?? 0.3;
      const r = Math.max(
        NODE_R_MIN,
        NODE_R_MAX - depth * 3 - (1 - score) * 4
      );
      result.set(id, {
        x: CX + radius * Math.cos(angle),
        y: CY + radius * Math.sin(angle),
        r,
      });
    });
  });

  let fb = 0;
  nodes.forEach((n) => {
    if (result.has(n.id)) return;
    const angle = (2 * Math.PI * fb) / Math.max(nodes.length, 1);
    fb += 1;
    result.set(n.id, {
      x: CX + 300 * Math.cos(angle),
      y: CY + 300 * Math.sin(angle),
      r: NODE_R_MIN,
    });
  });

  return result;
}

export default function FocusedRelationGraph({
  projectId,
  entityType,
  entityId,
}: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<FocusedGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [bridgeMode, setBridgeMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const svgWrapRef = useRef<HTMLDivElement>(null);
  const fsSvgWrapRef = useRef<HTMLDivElement>(null);

  const allBridgeIds: string[] = data
    ? [data.center.id, ...data.nodes.map((n) => n.id)]
    : [];
  const bridgeAll =
    allBridgeIds.length > 0 && allBridgeIds.every((id) => selectedIds.has(id));
  const toggleBridgeId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const handleBridgeAll = () =>
    setSelectedIds(bridgeAll ? new Set() : new Set(allBridgeIds));
  const handleBridgeNavigate = () => {
    if (selectedIds.size === 0) return;
    navigate(
      `/projects/${projectId}/workspace?module=chronologies`,
      { state: { bridgeIds: [...selectedIds] } }
    );
  };
  const border = "var(--color-border-light)";
  const textPrim = "var(--color-text-primary)";
  const textSec = "var(--color-text-secondary)";
  const bgPrimary = "var(--color-bg-primary)";
  const ai = "var(--color-ai)";
  const aiBg = "var(--color-ai-bg)";

  useEffect(() => {
    setLoading(true);
    setScale(1);
    setPan({ x: 0, y: 0 });
    api
      .get<FocusedGraphResponse>(
        `/projects/${projectId}/documents/focused-graph/${entityType}/${entityId}`
      )
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [projectId, entityType, entityId]);

  const posMap = useMemo(() => {
    if (!data) return new Map<string, LaidOutNode>();
    return computeLayout(data.center, data.nodes, data.edges);
  }, [data]);

  const nodeById = useMemo(() => {
    if (!data) return new Map<string, FocusNode | CenterNode>();
    return new Map<string, FocusNode | CenterNode>([
      [data.center.id, data.center],
      ...data.nodes.map((n) => [n.id, n] as const),
    ]);
  }, [data]);

  const goTo = (id: string) => {
    const n = nodeById.get(id);
    if (!n) return;
    navigate(entityPath(projectId, n.entity_type, n.id));
  };

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
  }, []);
  const resetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    const attach = (el: HTMLDivElement | null) => {
      if (!el) return () => {};
      const handler = (e: WheelEvent) => {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.12 : 0.89);
      };
      el.addEventListener("wheel", handler, { passive: false });
      return () => el.removeEventListener("wheel", handler);
    };
    const cleanups = [attach(svgWrapRef.current), attach(fsSvgWrapRef.current)];
    return () => cleanups.forEach((fn) => fn());
  }, [zoomBy, fullscreen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = (e.clientX - dragStart.current.x) / scale;
    const dy = (e.clientY - dragStart.current.y) / scale;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  };
  const handleMouseUp = () => {
    dragging.current = false;
  };

  if (loading) {
    return (
      <p style={{ fontSize: 12, color: textSec, fontFamily: "Inter, sans-serif" }}>
        İlişki haritası yükleniyor…
      </p>
    );
  }
  if (!data) {
    return (
      <p style={{ fontSize: 12, color: textSec, fontStyle: "italic", fontFamily: "Inter, sans-serif" }}>
        İlişki haritası yüklenemedi.
      </p>
    );
  }

  const { center, nodes, edges, truncated, hidden_count } = data;
  const hoveredNode = hovered ? nodeById.get(hovered) : null;

  const renderSvg = () => (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: "100%", height: "100%", display: "block",
        cursor: dragging.current ? "grabbing" : "grab",
        userSelect: "none" as const,
      }}
      aria-label="İlişki haritası"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <defs>
        <radialGradient id="focusGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={ai} stopOpacity="0.10" />
          <stop offset="55%" stopColor={ai} stopOpacity="0.02" />
          <stop offset="100%" stopColor={ai} stopOpacity="0" />
        </radialGradient>
        <marker id="focusArrow" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={ai} opacity="0.5" />
        </marker>
      </defs>

      <g transform={`translate(${CX},${CY}) scale(${scale}) translate(${-CX + pan.x},${-CY + pan.y})`}>
        <circle cx={CX} cy={CY} r={330} fill="url(#focusGlow)" />

        {[...edges]
          .sort((a, b) => {
            const rank = { cross: 0, indirect: 1, content: 2, chain: 3 };
            return rank[a.tier] - rank[b.tier];
          })
          .map((e, i) => {
            const src = posMap.get(e.source);
            const tgt = posMap.get(e.target);
            if (!src || !tgt) return null;
            const isHov = hovered === e.source || hovered === e.target;
            const isChain = e.tier === "chain";
            const weight =
              e.tier === "chain" ? 2.2
              : e.tier === "content" ? 1.6
              : e.tier === "indirect" ? 1.1
              : 1.0;
            const dash =
              e.tier === "indirect" ? "4,3"
              : e.tier === "cross" ? "1,3"
              : undefined;
            return (
              <line
                key={i}
                x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke={ai}
                strokeWidth={isHov ? weight + 1.5 : weight}
                strokeOpacity={isHov ? 1 : TIER_OPACITY[e.tier]}
                strokeDasharray={dash}
                strokeLinecap="round"
                markerEnd={isChain ? "url(#focusArrow)" : undefined}
                style={{ transition: "stroke-opacity 0.15s ease, stroke-width 0.15s ease" }}
              />
            );
          })}

        {nodes.map((n) => {
          const pos = posMap.get(n.id);
          if (!pos) return null;
          const isHov = hovered === n.id;
          const r = isHov ? pos.r + 3 : pos.r;
          return (
            <g
              key={n.id}
              style={{ cursor: "pointer" }}
              onClick={() => bridgeMode ? toggleBridgeId(n.id) : goTo(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              {bridgeMode && selectedIds.has(n.id) && (
                <circle cx={pos.x} cy={pos.y} r={r + 6}
                  fill="none" stroke="var(--color-accent)"
                  strokeWidth={1.8} strokeOpacity={0.9} />
              )}
              <circle
                cx={pos.x} cy={pos.y} r={r}
                fill={isHov ? ai : aiBg}
                stroke={ai}
                strokeWidth={1.5}
                fillOpacity={isHov ? 1 : TIER_OPACITY[n.tier]}
                strokeOpacity={TIER_OPACITY[n.tier]}
                style={{ transition: "r 0.15s ease, fill-opacity 0.15s ease" }}
              />
              <text
                x={pos.x} y={pos.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={11} fontWeight={500}
                fill={isHov ? "var(--color-bg-primary)" : "var(--color-text-primary)"}
                fontFamily="JetBrains Mono, monospace"
              >
                {n.ref}
              </text>
            </g>
          );
        })}

        <g
          style={{ cursor: "pointer" }}
          onClick={() => bridgeMode ? toggleBridgeId(center.id) : goTo(center.id)}
          onMouseEnter={() => setHovered(center.id)}
          onMouseLeave={() => setHovered(null)}
        >
          <circle cx={CX} cy={CY} r={CENTER_R} fill="none" stroke={ai} strokeWidth={1} opacity={0.35}>
            <animate attributeName="r" values={`${CENTER_R};${CENTER_R + 9};${CENTER_R}`} dur="2.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite" />
          </circle>
          {bridgeMode && selectedIds.has(center.id) && (
            <circle cx={CX} cy={CY} r={CENTER_R + 6}
              fill="none" stroke="var(--color-accent)"
              strokeWidth={1.8} strokeOpacity={0.9} />
          )}
          <circle
            cx={CX} cy={CY} r={hovered === center.id ? CENTER_R + 3 : CENTER_R}
            fill={ai} stroke={ai} strokeWidth={2}
            style={{ transition: "r 0.15s ease" }}
          />
          <text
            x={CX} y={CY} textAnchor="middle" dominantBaseline="middle"
            fontSize={10} fontWeight={500} fill="var(--color-bg-primary)" fontFamily="JetBrains Mono, monospace"
          >
            {center.ref}
          </text>
        </g>
      </g>
    </svg>
  );

  const controls = (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <button onClick={() => zoomBy(1 / 1.2)} aria-label="Uzaklaştır"
        style={{ width: 26, height: 26, background: aiBg, color: ai, border: `1px solid ${ai}`, borderRadius: 6, cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
      <button onClick={() => zoomBy(1.2)} aria-label="Yakınlaştır"
        style={{ width: 26, height: 26, background: aiBg, color: ai, border: `1px solid ${ai}`, borderRadius: 6, cursor: "pointer", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
      <button onClick={resetView}
        style={{ height: 26, padding: "0 10px", background: "transparent", color: textSec, border: `1px solid ${border}`, borderRadius: 0, cursor: "pointer", fontSize: 10, fontFamily: "Inter, sans-serif" }}>Sıfırla</button>
      {!fullscreen && (
        <button onClick={() => setFullscreen(true)} aria-label="Tam ekran" title="Tam ekran"
          style={{ width: 26, height: 26, background: "transparent", color: textSec, border: `1px solid ${border}`, borderRadius: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      )}
    </div>
  );

  const tooltip = hoveredNode ? (
    <div style={{
      position: "absolute" as const, bottom: 12, left: 12,
      background: bgPrimary, border: `1px solid ${border}`,
      borderLeft: `3px solid ${ai}`, padding: "10px 14px", maxWidth: 300,
      borderRadius: 6, pointerEvents: "none" as const,
      boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
    }}>
      <p style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: ai, margin: 0, fontWeight: 500 }}>
        {hoveredNode.ref}
      </p>
      <p style={{ fontSize: 12, fontWeight: 500, color: textPrim, margin: "3px 0 0", fontFamily: "Inter, sans-serif" }}>
        {hoveredNode.subject}
      </p>
      <p style={{ fontSize: 10, color: textSec, margin: "4px 0 0", fontFamily: "Inter, sans-serif" }}>
        Durum: {hoveredNode.status}
        {hoveredNode.tier !== "center" && ` · ${hoveredNode.tier === "chain" ? "Zincir" : hoveredNode.tier === "content" ? "İçerik" : "Dolaylı"}`}
      </p>
    </div>
  ) : null;

  const header = (inFullscreen: boolean) => (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
      <div>
        <p style={{ fontFamily: "Playfair Display, Georgia, serif", fontSize: 18, color: textPrim, margin: 0, fontWeight: 500 }}>
          İlişki Haritası{inFullscreen ? ` — ${center.ref}` : ""}
        </p>
        <p style={{ fontSize: 11.5, color: textSec, margin: "4px 0 0", fontStyle: "italic", fontFamily: "Inter, sans-serif" }}>
          {center.ref} ile bağlantılı {nodes.length} kayıt · zincir ve içerik ilişkileri
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {controls}
        <button
          onClick={() => { setBridgeMode((m) => !m); setSelectedIds(new Set()); }}
          style={{
            background: bridgeMode ? "var(--color-accent)" : "none",
            color: bridgeMode ? "var(--color-bg-primary)" : textSec,
            border: `1px solid ${bridgeMode ? "var(--color-accent)" : border}`,
            padding: "5px 11px", fontSize: 11, fontWeight: 500,
            cursor: "pointer", fontFamily: "Inter, sans-serif",
          }}
        >
          {bridgeMode ? "İptal" : "Kronoloji'ye Aktar"}
        </button>
        {inFullscreen && (
          <button onClick={() => setFullscreen(false)} aria-label="Kapat"
            style={{ background: "none", border: "none", color: textSec, fontSize: 20, cursor: "pointer", padding: 0 }}>×</button>
        )}
      </div>
    </div>
  );

  const legend = (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {([
          { label: "Zincir",  w: 2.2, dash: undefined, op: 1 },
          { label: "İçerik",  w: 1.6, dash: undefined, op: 0.7 },
          { label: "Dolaylı", w: 1.1, dash: "4,3",     op: 0.5 },
          { label: "Çapraz",  w: 1.0, dash: "1,3",     op: 0.42 },
        ] as const).map((item) => (
          <span key={item.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="20" height="6" aria-hidden="true">
              <line
                x1="0" y1="3" x2="20" y2="3"
                stroke={ai} strokeWidth={item.w}
                strokeOpacity={item.op}
                strokeDasharray={item.dash}
                strokeLinecap="round"
              />
            </svg>
            <span style={{ fontSize: 10, color: textSec, fontFamily: "Inter, sans-serif" }}>
              {item.label}
            </span>
          </span>
        ))}
      </div>
      <span style={{ fontSize: 10, color: textSec, fontFamily: "Inter, sans-serif" }}>
        {nodes.length} kayıt · {edges.length} bağlantı
      </span>
    </div>
  );

  const graphBox = (heightVal: number | string, wrapRef: React.RefObject<HTMLDivElement>) => (
    <div
      ref={wrapRef}
      style={{
        position: "relative" as const,
        borderRadius: 12, overflow: "hidden",
        height: heightVal,
        background: `radial-gradient(ellipse at 42% 50%, ${aiBg} 0%, transparent 62%), linear-gradient(155deg, var(--color-bg-secondary), var(--color-bg-primary))`,
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${ai}`,
      }}
    >
      {renderSvg()}
      {tooltip}
    </div>
  );

  return (
    <div>
      {header(false)}
      {graphBox(500, svgWrapRef)}
      {legend}

      {bridgeMode && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          marginTop: 10, padding: "10px 14px",
          border: `1px solid ${border}`,
          borderLeft: "2px solid var(--color-accent)",
          background: "var(--color-bg-secondary)",
        }}>
          <div
            role="checkbox"
            aria-checked={bridgeAll}
            onClick={handleBridgeAll}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 }}
          >
            <div style={{
              width: 14, height: 14,
              border: `1.5px solid ${bridgeAll ? "var(--color-accent)" : "var(--color-text-secondary)"}`,
              background: bridgeAll ? "var(--color-accent)" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {bridgeAll && (
                <svg width="9" height="7" viewBox="0 0 9 7" aria-hidden="true">
                  <polyline points="1,3.5 3.5,6 8,1"
                    stroke="var(--color-bg-primary)" strokeWidth="1.5"
                    fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span style={{ fontSize: 11, color: textSec, fontFamily: "Inter, sans-serif" }}>
              Tümünü Seç
            </span>
          </div>
          <span style={{ flex: 1, fontSize: 11, color: textSec, fontFamily: "Inter, sans-serif" }}>
            {selectedIds.size > 0 ? `${selectedIds.size} kayıt seçildi` : "Grafikten kayıt seçin"}
          </span>
          <button
            onClick={handleBridgeNavigate}
            disabled={selectedIds.size === 0}
            style={{
              background: selectedIds.size > 0 ? "var(--color-accent)" : "transparent",
              color: selectedIds.size > 0 ? "var(--color-bg-primary)" : border,
              border: `1px solid ${selectedIds.size > 0 ? "var(--color-accent)" : border}`,
              padding: "7px 18px", fontSize: 12, fontWeight: 500,
              cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
              fontFamily: "Inter, sans-serif",
            }}
          >
            Kronoloji Oluştur →
          </button>
        </div>
      )}
      {truncated && (
        <p style={{ fontSize: 11, color: "var(--color-warning)", marginTop: 8, fontFamily: "Inter, sans-serif" }}>
          ⚠ {hidden_count} ilişkili kayıt daha zayıf bağlantı nedeniyle gösterilmiyor.
        </p>
      )}

      {fullscreen && (
        <div
          onClick={() => setFullscreen(false)}
          style={{
            position: "fixed" as const, inset: 0, backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: "var(--z-graph-fullscreen)" as unknown as number, padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: bgPrimary, border: `1px solid ${border}`,
              borderRadius: 12, width: "94vw", maxWidth: 1300, height: "90vh",
              display: "flex", flexDirection: "column" as const, padding: 20,
            }}
          >
            {header(true)}
            <div style={{ flex: 1, minHeight: 0 }}>
              {graphBox("100%", fsSvgWrapRef)}
            </div>
            {legend}
          </div>
        </div>
      )}
    </div>
  );
}
