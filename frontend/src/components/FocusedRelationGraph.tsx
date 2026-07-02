import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

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
  tier: "chain" | "content" | "indirect";
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

const W = 900;
const H = 760;
const CX = 450;
const CY = 380;
const CENTER_R = 30;
const CHAIN_NODE_R = 22;
const SATELLITE_R = 18;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

const LEVEL_GAP_CHAIN = 120;
const BAND_BASE_RADIUS: Record<1 | 2, number> = { 1: 180, 2: 300 };
const LEVEL_GAP_SATELLITE = 110;

const TIER_OPACITY: Record<string, number> = {
  chain: 1,
  content: 0.65,
  indirect: 0.35,
};

function entityPath(projectId: string, entityType: string, id: string): string {
  if (entityType === "correspondence")
    return `/projects/${projectId}/workspace/correspondence/${id}`;
  return `/projects/${projectId}/workspace/rfis/${id}`;
}

interface LaidOutNode {
  x: number;
  y: number;
}

/* ── Layout: unified band-based BFS from center ─────────────
   A single tree is built from center outward using ALL edges,
   but with priority: chain edges first (band 0 — center's own
   structural chain, whether center is mid-chain or an endpoint),
   then content edges (band 1), then indirect edges (band 2) for
   anything not yet reached. Once an external node is reached via
   content/indirect, its OWN chain siblings are pulled in at the
   same band via further chain-edge BFS — this is what makes a
   secondary chain (e.g. CORR-009→010→011) render correctly as a
   connected sub-branch even when the graph's center (e.g. an RFI)
   sits outside that chain entirely.

   Angle: one global DFS leaf-slot pass across the whole tree,
   giving every branch a unique angular wedge (zero overlap,
   full circle used). Radius: band's base radius + local depth
   within that band × level gap. This generalizes correctly
   regardless of where center sits relative to any chain.        */
function computeLayout(
  centerId: string,
  allNodeIds: string[],
  edges: FocusEdge[]
): Map<string, LaidOutNode> {
  const chainAdj = new Map<string, string[]>();
  const pushAdj = (a: string, b: string) => {
    if (!chainAdj.has(a)) chainAdj.set(a, []);
    chainAdj.get(a)!.push(b);
  };
  edges
    .filter((e) => e.tier === "chain")
    .forEach((e) => {
      pushAdj(e.source, e.target);
      pushAdj(e.target, e.source);
    });

  const parentOf = new Map<string, string | null>();
  const bandOf = new Map<string, 0 | 1 | 2>();
  const localDepth = new Map<string, number>();

  // Band 0: center's own chain component (undirected BFS).
  parentOf.set(centerId, null);
  bandOf.set(centerId, 0);
  localDepth.set(centerId, 0);
  let queue: string[] = [centerId];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const nb of chainAdj.get(cur) ?? []) {
      if (!parentOf.has(nb)) {
        parentOf.set(nb, cur);
        bandOf.set(nb, 0);
        localDepth.set(nb, (localDepth.get(cur) ?? 0) + 1);
        queue.push(nb);
      }
    }
  }

  // Band 1/2 seeds: direct content/indirect edges FROM center to
  // not-yet-reached nodes. Prefer content over indirect per node.
  const bestTierFor = new Map<string, "content" | "indirect">();
  edges.forEach((e) => {
    if (e.tier === "chain") return;
    const isFromCenter = e.source === centerId;
    const isToCenter = e.target === centerId;
    if (!isFromCenter && !isToCenter) return;
    const other = isFromCenter ? e.target : e.source;
    if (parentOf.has(other)) return;
    const existing = bestTierFor.get(other);
    if (!existing || (existing === "indirect" && e.tier === "content")) {
      bestTierFor.set(other, e.tier as "content" | "indirect");
    }
  });

  let queue2: string[] = [];
  bestTierFor.forEach((tier, node) => {
    if (parentOf.has(node)) return;
    parentOf.set(node, centerId);
    bandOf.set(node, tier === "content" ? 1 : 2);
    localDepth.set(node, 0);
    queue2.push(node);
  });

  // Extend each band-1/2 anchor outward via its own chain edges,
  // inheriting the same band (surfaces secondary chain structure).
  while (queue2.length) {
    const cur = queue2.shift() as string;
    const band = bandOf.get(cur)!;
    for (const nb of chainAdj.get(cur) ?? []) {
      if (!parentOf.has(nb)) {
        parentOf.set(nb, cur);
        bandOf.set(nb, band);
        localDepth.set(nb, (localDepth.get(cur) ?? 0) + 1);
        queue2.push(nb);
      }
    }
  }

  // Safety fallback for any unreached node.
  allNodeIds.forEach((id) => {
    if (!parentOf.has(id)) {
      parentOf.set(id, centerId);
      bandOf.set(id, 2);
      localDepth.set(id, 0);
    }
  });

  // Global DFS leaf-slot pass for angle (whole tree, one pass).
  const childrenOf = new Map<string, string[]>();
  parentOf.forEach((p, id) => {
    if (p !== null) {
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p)!.push(id);
    }
  });
  let nextLeaf = 0;
  const slotMap = new Map<string, number>();
  const assign = (id: string): number => {
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      const s = nextLeaf;
      nextLeaf += 1;
      slotMap.set(id, s);
      return s;
    }
    const kidSlots = kids.map((k) => assign(k));
    const avg = kidSlots.reduce((a, b) => a + b, 0) / kidSlots.length;
    slotMap.set(id, avg);
    return avg;
  };
  assign(centerId);
  const totalLeaves = Math.max(nextLeaf, 1);

  const result = new Map<string, LaidOutNode>();
  result.set(centerId, { x: CX, y: CY });

  allNodeIds.forEach((id) => {
    if (id === centerId) return;
    const band = bandOf.get(id) ?? 2;
    const depth = localDepth.get(id) ?? 1;
    const slot = slotMap.get(id) ?? 0;
    const angle = (slot / totalLeaves) * 2 * Math.PI;
    const radius =
      band === 0
        ? depth * LEVEL_GAP_CHAIN
        : BAND_BASE_RADIUS[band] + (depth - 1) * LEVEL_GAP_SATELLITE;
    result.set(id, {
      x: CX + radius * Math.cos(angle),
      y: CY + radius * Math.sin(angle),
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

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const svgWrapRef = useRef<HTMLDivElement>(null);
  const fsSvgWrapRef = useRef<HTMLDivElement>(null);

  const cardBg = "var(--color-bg-secondary)";
  const bgPrimary = "var(--color-bg-primary)";
  const border = "var(--color-border-light)";
  const textPrim = "var(--color-text-primary)";
  const textSec = "var(--color-text-secondary)";
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
    const ids = [data.center.id, ...data.nodes.map((n) => n.id)];
    return computeLayout(data.center.id, ids, data.edges);
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
  const hoveredPos = hovered ? posMap.get(hovered) : null;

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
        <radialGradient id="focusBgGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={ai} stopOpacity="0.06" />
          <stop offset="100%" stopColor={ai} stopOpacity="0" />
        </radialGradient>
        <filter id="focusNodeShadow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor={ai} floodOpacity="0.35" />
        </filter>
      </defs>

      <g transform={`translate(${CX},${CY}) scale(${scale}) translate(${-CX + pan.x},${-CY + pan.y})`}>
        <circle cx={CX} cy={CY} r={340} fill="url(#focusBgGlow)" />

        {edges.map((e, i) => {
          const src = posMap.get(e.source);
          const tgt = posMap.get(e.target);
          if (!src || !tgt) return null;
          const isHov = hovered === e.source || hovered === e.target;
          return (
            <line
              key={i}
              x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
              stroke={ai}
              strokeWidth={isHov ? Math.max(1.5, e.score * 4) : Math.max(0.75, e.score * 2)}
              strokeOpacity={TIER_OPACITY[e.tier] * (isHov ? 1 : 0.65)}
              strokeDasharray={e.tier === "indirect" ? "3,3" : undefined}
              strokeLinecap="round"
              style={{ transition: "stroke-opacity 0.15s ease, stroke-width 0.15s ease" }}
            />
          );
        })}

        {nodes.map((n) => {
          const pos = posMap.get(n.id);
          if (!pos) return null;
          const isHov = hovered === n.id;
          const baseR = n.tier === "chain" ? CHAIN_NODE_R : SATELLITE_R;
          const r = isHov ? baseR + 3 : baseR;
          return (
            <g
              key={n.id}
              style={{ cursor: "pointer" }}
              onClick={() => goTo(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle
                cx={pos.x} cy={pos.y} r={r}
                fill={isHov ? ai : aiBg}
                stroke={ai}
                strokeWidth={1.5}
                fillOpacity={isHov ? 1 : TIER_OPACITY[n.tier]}
                strokeOpacity={TIER_OPACITY[n.tier]}
                filter={isHov ? "url(#focusNodeShadow)" : undefined}
                style={{ transition: "r 0.15s ease, fill-opacity 0.15s ease" }}
              />
              <text
                x={pos.x} y={pos.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={8} fontWeight={600}
                fill={isHov ? "#F5F2ED" : ai}
                fontFamily="JetBrains Mono, monospace"
              >
                {n.ref}
              </text>
            </g>
          );
        })}

        <g
          style={{ cursor: "pointer" }}
          onClick={() => goTo(center.id)}
          onMouseEnter={() => setHovered(center.id)}
          onMouseLeave={() => setHovered(null)}
        >
          <circle
            cx={CX} cy={CY} r={hovered === center.id ? CENTER_R + 3 : CENTER_R}
            fill={ai} stroke={ai} strokeWidth={2}
            filter={hovered === center.id ? "url(#focusNodeShadow)" : undefined}
            style={{ transition: "r 0.15s ease" }}
          />
          <text
            x={CX} y={CY} textAnchor="middle" dominantBaseline="middle"
            fontSize={9.5} fontWeight={600} fill="#F5F2ED" fontFamily="JetBrains Mono, monospace"
          >
            {center.ref}
          </text>
        </g>
      </g>
    </svg>
  );

  const controls = (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <button
        onClick={() => zoomBy(1 / 1.2)}
        aria-label="Uzaklaştır"
        style={{
          width: 24, height: 24, background: aiBg, color: ai,
          border: `1px solid ${ai}`, borderRadius: 4, cursor: "pointer",
          fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        −
      </button>
      <button
        onClick={() => zoomBy(1.2)}
        aria-label="Yakınlaştır"
        style={{
          width: 24, height: 24, background: aiBg, color: ai,
          border: `1px solid ${ai}`, borderRadius: 4, cursor: "pointer",
          fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        +
      </button>
      <button
        onClick={resetView}
        style={{
          height: 24, padding: "0 8px", background: "transparent", color: textSec,
          border: `1px solid ${border}`, borderRadius: 4, cursor: "pointer", fontSize: 10,
          fontFamily: "Inter, sans-serif",
        }}
      >
        Sıfırla
      </button>
      {!fullscreen && (
        <button
          onClick={() => setFullscreen(true)}
          aria-label="Tam ekran"
          title="Tam ekran"
          style={{
            width: 24, height: 24, background: "transparent", color: textSec,
            border: `1px solid ${border}`, borderRadius: 4, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      )}
    </div>
  );

  const tooltip = (hoveredNode && hoveredPos) ? (
    <div style={{
      position: "absolute" as const,
      bottom: 12, left: 12,
      background: bgPrimary, border: `1px solid ${border}`,
      borderLeft: `3px solid ${ai}`,
      padding: "10px 14px", maxWidth: 300, borderRadius: 6,
      pointerEvents: "none" as const,
      boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
    }}>
      <p style={{
        fontSize: 11, fontFamily: "JetBrains Mono, monospace",
        color: ai, margin: 0, fontWeight: 600,
      }}>
        {hoveredNode.ref}
      </p>
      <p style={{
        fontSize: 12, fontWeight: 500, color: textPrim,
        margin: "3px 0 0", fontFamily: "Inter, sans-serif",
      }}>
        {hoveredNode.subject}
      </p>
      <p style={{
        fontSize: 10, color: textSec, margin: "4px 0 0",
        fontFamily: "Inter, sans-serif",
      }}>
        Durum: {hoveredNode.status}
        {hoveredNode.tier !== "center" && ` · ${hoveredNode.tier === "chain" ? "Zincir" : hoveredNode.tier === "content" ? "İçerik" : "Dolaylı"}`}
      </p>
    </div>
  ) : null;

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 6,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 500, color: textSec,
          textTransform: "uppercase" as const, letterSpacing: "0.08em",
          fontFamily: "Inter, sans-serif",
        }}>
          İlişki Haritası
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, textTransform: "none" as const }}>
            {nodes.length} kayıt · {edges.length} bağlantı
          </span>
        </div>
        {controls}
      </div>

      <p style={{
        fontSize: 10.5, color: textSec, fontStyle: "italic",
        margin: "0 0 8px", fontFamily: "Inter, sans-serif",
      }}>
        Düğümlere fare ile gelin, detay için tıklayın.
      </p>

      <div
        ref={svgWrapRef}
        style={{
          background: `linear-gradient(160deg, ${cardBg}, ${bgPrimary})`,
          border: `1px solid ${border}`,
          borderLeft: `3px solid ${ai}`, borderRadius: 10,
          overflow: "hidden", position: "relative" as const,
          height: 560,
        }}
      >
        {renderSvg()}
        {tooltip}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" as const }}>
        <span style={{ fontSize: 10, color: ai, fontFamily: "Inter, sans-serif" }}>● Zincir</span>
        <span style={{ fontSize: 10, color: ai, opacity: 0.65, fontFamily: "Inter, sans-serif" }}>● İçerik</span>
        <span style={{ fontSize: 10, color: ai, opacity: 0.35, fontFamily: "Inter, sans-serif" }}>┄ Dolaylı</span>
      </div>

      {truncated && (
        <p style={{
          fontSize: 11, color: "var(--color-warning)", marginTop: 8,
          fontFamily: "Inter, sans-serif",
        }}>
          ⚠ {hidden_count} ilişkili kayıt daha zayıf bağlantı nedeniyle gösterilmiyor.
        </p>
      )}

      {fullscreen && (
        <div
          onClick={() => setFullscreen(false)}
          style={{
            position: "fixed" as const, inset: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1100, padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: `linear-gradient(160deg, ${cardBg}, ${bgPrimary})`,
              border: `1px solid ${border}`,
              borderLeft: `3px solid ${ai}`, borderRadius: 10,
              width: "94vw", maxWidth: 1300, height: "90vh",
              display: "flex", flexDirection: "column" as const,
              padding: 16,
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 10,
            }}>
              <div style={{
                fontSize: 12, fontWeight: 500, color: textPrim,
                fontFamily: "Inter, sans-serif",
              }}>
                İlişki Haritası — {center.ref}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {controls}
                <button
                  onClick={() => setFullscreen(false)}
                  aria-label="Kapat"
                  style={{
                    background: "none", border: "none", color: textSec,
                    fontSize: 20, cursor: "pointer", padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div ref={fsSvgWrapRef} style={{ flex: 1, overflow: "hidden", position: "relative" as const }}>
              {renderSvg()}
              {tooltip}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
