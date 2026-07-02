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
const H = 520;
const CX = 340;
const CY = 260;
const CENTER_R = 26;
const NODE_R = 18;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const RING_GAP = 90;
const BASE_RADIUS = 95;

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

function shortSubject(subject: string, max = 14): string {
  if (!subject) return "";
  return subject.length <= max ? subject : subject.slice(0, max - 1) + "…";
}

/* ── Layout: DFS post-order tree slotting ──────────────────
   Standard collision-free radial tree technique. Each leaf
   gets one unique angular slot (0..leafCount-1); internal
   nodes take the average slot of their children. Distance
   from center (BFS hop count) sets the ring radius. This
   guarantees zero overlap regardless of graph shape, and
   naturally clusters a chain branch along one angular arc
   since all its members share the same leaf-descendant slots. */
function computeLayout(
  centerId: string,
  nodeIds: string[],
  edges: FocusEdge[]
): Map<string, { x: number; y: number }> {
  const adjacency = new Map<string, string[]>();
  const addAdj = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push(b);
  };
  edges.forEach((e) => {
    addAdj(e.source, e.target);
    addAdj(e.target, e.source);
  });

  // BFS: distance + parent (tree structure over the graph)
  const distance = new Map<string, number>();
  const parent = new Map<string, string | null>();
  distance.set(centerId, 0);
  parent.set(centerId, null);
  const bfsQueue: string[] = [centerId];
  while (bfsQueue.length) {
    const curr = bfsQueue.shift() as string;
    const d = distance.get(curr) as number;
    for (const nb of adjacency.get(curr) ?? []) {
      if (!distance.has(nb)) {
        distance.set(nb, d + 1);
        parent.set(nb, curr);
        bfsQueue.push(nb);
      }
    }
  }

  const children = new Map<string, string[]>();
  parent.forEach((p, id) => {
    if (p !== null && p !== undefined) {
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(id);
    }
  });

  // DFS post-order: assign leaf slots, propagate averages up.
  let nextSlot = 0;
  const slot = new Map<string, number>();

  const visit = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      const s = nextSlot;
      nextSlot += 1;
      slot.set(id, s);
      return s;
    }
    const kidSlots = kids.map((k) => visit(k));
    const avg = kidSlots.reduce((a, b) => a + b, 0) / kidSlots.length;
    slot.set(id, avg);
    return avg;
  };
  visit(centerId);

  const totalLeaves = Math.max(nextSlot, 1);
  const posMap = new Map<string, { x: number; y: number }>();
  posMap.set(centerId, { x: CX, y: CY });

  nodeIds.forEach((id) => {
    if (id === centerId) return;
    const dist = distance.get(id);
    if (dist === undefined) return; // unreachable — should not happen
    const s = slot.get(id) ?? 0;
    const angle = (s / totalLeaves) * 2 * Math.PI - Math.PI / 2;
    const radius = BASE_RADIUS + (dist - 1) * RING_GAP;
    posMap.set(id, {
      x: CX + radius * Math.cos(angle),
      y: CY + radius * Math.sin(angle),
    });
  });

  return posMap;
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
    if (!data) return new Map<string, { x: number; y: number }>();
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

  /* ── Native wheel listener ────────────────────────────────
     React's synthetic onWheel is registered as a passive
     listener by the browser, so calling preventDefault()
     inside it does NOT stop page scroll. A native listener
     with { passive: false } is required to actually own the
     wheel gesture for zoom instead of the page. */
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
      <g transform={`translate(${CX},${CY}) scale(${scale}) translate(${-CX + pan.x},${-CY + pan.y})`}>
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
          const r = isHov ? NODE_R + 3 : NODE_R;
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
                x={pos.x} y={pos.y - 3}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={9} fontWeight={500}
                fill={isHov ? "#F5F2ED" : ai}
                fontFamily="Inter, sans-serif"
              >
                {n.entity_type === "correspondence" ? "C" : "R"}
              </text>
              <text
                x={pos.x} y={pos.y + r + 11}
                textAnchor="middle" fontSize={9} fill={textSec}
                fontFamily="Inter, sans-serif"
              >
                {shortSubject(n.subject)}
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
          <circle cx={CX} cy={CY} r={CENTER_R} fill={ai} stroke={ai} strokeWidth={2} />
          <text
            x={CX} y={CY - 4} textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontWeight={500} fill="#F5F2ED" fontFamily="Inter, sans-serif"
          >
            {center.ref}
          </text>
          <text
            x={CX} y={CY + CENTER_R + 13} textAnchor="middle" fontSize={10}
            fontWeight={500} fill={textPrim} fontFamily="Inter, sans-serif"
          >
            {shortSubject(center.subject, 20)}
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
          height: 420,
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
