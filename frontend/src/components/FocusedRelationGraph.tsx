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

const W = 680;
const H = 560;
const CX = 340;
const TOP_Y = 60;
const LEVEL_GAP = 110;
const TREE_HALF_WIDTH = 260;
const SATELLITE_OFFSET = 72;

const CENTER_R = 28;
const CHAIN_NODE_R = 22;
const SATELLITE_R = 16;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

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

function shortSubject(subject: string, max = 16): string {
  if (!subject) return "";
  return subject.length <= max ? subject : subject.slice(0, max - 1) + "…";
}

interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  kind: "chain" | "satellite";
}

/* ── Layout: top-down tidy tree + satellites ────────────────
   Chain relations (tier="chain") are real parent/child
   structure — they form a tree, and the center node can sit
   ANYWHERE in that tree (it may have both ancestors AND
   descendants, e.g. CORR-009 → CORR-010(center) → CORR-011).
   Drawing them as "equal-distance spokes from center" (the
   previous approach) hid this sequential relationship.

   Fix: find the true root of the chain tree (walk up from
   center via parent links), then lay out the WHOLE tree
   top-down (root at top, depth increases downward), using
   classic DFS leaf-slot spacing for horizontal position —
   this guarantees zero overlap and reads as one continuous
   line/branch structure, exactly matching the real hierarchy.

   Content/indirect nodes are not part of this structural tree
   — each is attached (per its edge) to whichever node it
   actually relates to, and drawn as a small satellite next to
   that anchor, fanned out if there are multiple per anchor.  */
function computeLayout(
  centerId: string,
  allNodeIds: string[],
  edges: FocusEdge[]
): Map<string, LaidOutNode> {
  const chainEdges = edges.filter((e) => e.tier === "chain");
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  chainEdges.forEach((e) => {
    parentOf.set(e.target, e.source);
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source)!.push(e.target);
  });

  // Find true root of the chain tree containing center.
  let root = centerId;
  const seenUp = new Set<string>();
  while (parentOf.has(root) && !seenUp.has(root)) {
    seenUp.add(root);
    root = parentOf.get(root)!;
  }

  const depthMap = new Map<string, number>();
  const slotMap = new Map<string, number>();
  let nextLeaf = 0;

  const visit = (id: string, depth: number): number => {
    depthMap.set(id, depth);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      const s = nextLeaf;
      nextLeaf += 1;
      slotMap.set(id, s);
      return s;
    }
    const kidSlots = kids.map((k) => visit(k, depth + 1));
    const avg = kidSlots.reduce((a, b) => a + b, 0) / kidSlots.length;
    slotMap.set(id, avg);
    return avg;
  };
  visit(root, 0);

  const totalLeaves = Math.max(nextLeaf, 1);
  const result = new Map<string, LaidOutNode>();
  const chainTreeIds = new Set<string>(depthMap.keys());

  chainTreeIds.forEach((id) => {
    const depth = depthMap.get(id) ?? 0;
    const slot = slotMap.get(id) ?? 0;
    const x =
      CX + ((slot + 0.5) / totalLeaves) * (2 * TREE_HALF_WIDTH) - TREE_HALF_WIDTH;
    const y = TOP_Y + depth * LEVEL_GAP;
    result.set(id, { id, x, y, kind: "chain" });
  });

  // Satellites: content/indirect nodes attach to their real
  // connecting node (the other endpoint of their edge), not
  // forced to center.
  const satelliteEdges = edges.filter((e) => e.tier !== "chain");
  const byAnchor = new Map<string, string[]>();
  satelliteEdges.forEach((e) => {
    const isSourceKnown = result.has(e.source) || e.source === centerId;
    const anchorId = isSourceKnown ? e.source : e.target;
    const satelliteId = isSourceKnown ? e.target : e.source;
    if (result.has(satelliteId)) return; // already placed as chain node
    if (!byAnchor.has(anchorId)) byAnchor.set(anchorId, []);
    if (!byAnchor.get(anchorId)!.includes(satelliteId)) {
      byAnchor.get(anchorId)!.push(satelliteId);
    }
  });

  byAnchor.forEach((satelliteIds, anchorId) => {
    const anchorPos = result.get(anchorId) ?? { x: CX, y: TOP_Y, kind: "chain" as const, id: anchorId };
    const count = satelliteIds.length;
    satelliteIds.forEach((sid, idx) => {
      const spread = Math.PI / 2.6;
      const t = count > 1 ? idx / (count - 1) - 0.5 : 0;
      const angle = t * spread; // fans out to the right of the anchor
      result.set(sid, {
        id: sid,
        x: anchorPos.x + SATELLITE_OFFSET * Math.cos(angle),
        y: anchorPos.y + SATELLITE_OFFSET * Math.sin(angle),
        kind: "satellite",
      });
    });
  });

  // Fallback for any node not placed (should not normally happen).
  allNodeIds.forEach((id) => {
    if (!result.has(id)) {
      result.set(id, { id, x: CX, y: TOP_Y, kind: "satellite" });
    }
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
    if (!data) return new Map();
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
      <g transform={`translate(${CX},${TOP_Y}) scale(${scale}) translate(${-CX + pan.x},${-TOP_Y + pan.y})`}>
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
              strokeOpacity={TIER_OPACITY[e.tier] * (isHov ? 1 : 0.7)}
              strokeDasharray={e.tier === "indirect" ? "3,3" : undefined}
            />
          );
        })}

        {nodes.map((n) => {
          const pos = posMap.get(n.id);
          if (!pos) return null;
          const isHov = hovered === n.id;
          const baseR = pos.kind === "chain" ? CHAIN_NODE_R : SATELLITE_R;
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
              />
              <text
                x={pos.x} y={pos.y - 1}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={7.5} fontWeight={600}
                fill={isHov ? "#F5F2ED" : ai}
                fontFamily="JetBrains Mono, monospace"
              >
                {n.ref}
              </text>
              <text
                x={pos.x} y={pos.y + r + 13}
                textAnchor="middle" fontSize={9} fill={textSec}
                fontFamily="Inter, sans-serif"
              >
                {shortSubject(n.subject)}
              </text>
            </g>
          );
        })}

        {(() => {
          const cpos = posMap.get(center.id) ?? { x: CX, y: TOP_Y };
          return (
            <g
              style={{ cursor: "pointer" }}
              onClick={() => goTo(center.id)}
              onMouseEnter={() => setHovered(center.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <circle cx={cpos.x} cy={cpos.y} r={CENTER_R} fill={ai} stroke={ai} strokeWidth={2} />
              <text
                x={cpos.x} y={cpos.y - 3} textAnchor="middle" dominantBaseline="middle"
                fontSize={9.5} fontWeight={600} fill="#F5F2ED" fontFamily="JetBrains Mono, monospace"
              >
                {center.ref}
              </text>
              <text
                x={cpos.x} y={cpos.y + CENTER_R + 13} textAnchor="middle" fontSize={10}
                fontWeight={500} fill={textPrim} fontFamily="Inter, sans-serif"
              >
                {shortSubject(center.subject, 20)}
              </text>
            </g>
          );
        })()}
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

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
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

      <div
        ref={svgWrapRef}
        style={{
          background: cardBg, border: `1px solid ${border}`,
          borderLeft: `3px solid ${ai}`, borderRadius: 6,
          overflow: "hidden", position: "relative" as const,
          height: 500,
        }}
      >
        {renderSvg()}
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
              background: cardBg, border: `1px solid ${border}`,
              borderLeft: `3px solid ${ai}`, borderRadius: 6,
              width: "92vw", maxWidth: 1100, height: "86vh",
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
            <div ref={fsSvgWrapRef} style={{ flex: 1, overflow: "hidden" }}>
              {renderSvg()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
