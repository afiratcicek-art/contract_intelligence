import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

/* ── Types ─────────────────────────────────────────────────
   Shape mirrors GET /all-relations response.
   Kept local — component-scoped.                          */
interface GraphNode {
  id: string;
  original_filename: string;
  entity_type: string;
  entity_id: string;
  keywords: string[];
  location?: string | null;
  doc_type?: string | null;
}

interface GraphEdge {
  source_doc_id: string;
  target_doc_id: string;
  score: number;
  score_breakdown?: { keyword?: number; semantic?: number } | null;
  relation_type: string;
}

interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface Props {
  projectId: string;
  /** Called when user clicks a node — parent can use for
   *  checkbox / chronology bridge (future). Optional.    */
  onSelect?: (node: GraphNode) => void;
}

/* ── Layout constants ───────────────────────────────────── */
const CX      = 340;   // SVG centre-x
const CY      = 260;   // SVG centre-y
const RADIUS  = 190;   // node orbit radius
const NODE_R  = 22;    // node circle radius
const W       = 680;
const H       = 520;

/* ── Helpers ────────────────────────────────────────────── */
/** Distribute N nodes evenly on a circle. */
function circleLayout(
  count: number
): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: CX + RADIUS * Math.cos(angle),
      y: CY + RADIUS * Math.sin(angle),
    };
  });
}

/** Entity type → short label for node badge. */
function entityLabel(type: string): string {
  const map: Record<string, string> = {
    correspondence: "C",
    rfi:            "R",
    change:         "CH",
    deliverable:    "D",
    contract_document: "CT",
  };
  return map[type] ?? "?";
}

/** Truncate filename for node label. */
function shortName(name: string, max = 14): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + "…";
}

/** Navigate path from entity_type + entity_id. */
function entityPath(
  projectId: string,
  entityType: string,
  entityId: string
): string {
  if (entityType === "correspondence")
    return `/projects/${projectId}/workspace/correspondence/${entityId}`;
  if (entityType === "rfi")
    return `/projects/${projectId}/workspace/rfis/${entityId}`;
  if (entityType === "change")
    return `/projects/${projectId}/workspace/changes/${entityId}`;
  if (entityType === "deliverable")
    return `/projects/${projectId}/workspace/deliverables/${entityId}`;
  return `/projects/${projectId}/workspace`;
}

/* ── Component ──────────────────────────────────────────── */
export default function DocumentRelationGraph({
  projectId,
  onSelect,
}: Props) {
  const navigate = useNavigate();

  const [graph,     setGraph]     = useState<GraphPayload | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [hovered,   setHovered]   = useState<string | null>(null);
  const [selected,  setSelected]  = useState<string | null>(null);

  /* Design tokens */
  const cardBg     = "var(--color-bg-secondary)";
  const border     = "var(--color-border-light)";
  const textPrim   = "var(--color-text-primary)";
  const textSec    = "var(--color-text-secondary)";
  const accent     = "var(--color-accent)";

  useEffect(() => {
    setLoading(true);
    api
      .get<GraphPayload>(`/projects/${projectId}/documents/all-relations`)
      .then((data) => setGraph(data))
      .catch(() => setGraph({ nodes: [], edges: [] }))
      .finally(() => setLoading(false));
  }, [projectId]);

  /* ── Loading ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ padding: "14px 0" }}>
        <p style={{
          fontSize: 11, color: textSec,
          fontFamily: "Inter, sans-serif",
        }}>
          Belge ilişki grafiği yükleniyor…
        </p>
      </div>
    );
  }

  /* ── Empty ───────────────────────────────────────────── */
  if (!graph || graph.nodes.length === 0) {
    return (
      <div style={{
        padding: "14px 16px", background: cardBg,
        borderLeft: `2px solid ${border}`,
      }}>
        <p style={{
          fontSize: 11, fontWeight: 500, color: textSec,
          textTransform: "uppercase" as const,
          letterSpacing: "0.08em", fontFamily: "Inter, sans-serif",
          margin: 0,
        }}>
          Belge İlişki Grafiği
        </p>
        <p style={{
          fontSize: 11, color: textSec, fontStyle: "italic",
          fontFamily: "Inter, sans-serif",
          marginTop: 6, marginBottom: 0,
        }}>
          Henüz ilişkili belge bulunamadı. Belgeler yüklendikçe
          ilişkiler otomatik olarak tespit edilecektir.
        </p>
      </div>
    );
  }

  /* ── Layout ──────────────────────────────────────────── */
  const { nodes, edges } = graph;
  const positions = circleLayout(nodes.length);
  const posMap = new Map(
    nodes.map((n, i) => [n.id, positions[i]])
  );

  /* ── Tooltip node ────────────────────────────────────── */
  const hoveredNode = nodes.find((n) => n.id === hovered) ?? null;

  /* ── Render ──────────────────────────────────────────── */
  return (
    <div>
      {/* Header */}
      <div style={{
        fontSize: 11, fontWeight: 500,
        textTransform: "uppercase" as const,
        letterSpacing: "0.08em", color: textSec,
        fontFamily: "Inter, sans-serif", marginBottom: 10,
      }}>
        Belge İlişki Grafiği
        <span style={{
          marginLeft: 8, fontSize: 10,
          color: textSec, fontWeight: 400,
          textTransform: "none" as const,
        }}>
          {nodes.length} belge · {edges.length} ilişki
        </span>
      </div>

      {/* SVG graph */}
      <div style={{
        background: cardBg, border: `1px solid ${border}`,
        borderRadius: 0, overflow: "hidden",
        position: "relative" as const,
      }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", display: "block" }}
          aria-label="Belge ilişki grafiği"
        >
          {/* Edges */}
          {edges.map((e, i) => {
            const src = posMap.get(e.source_doc_id);
            const tgt = posMap.get(e.target_doc_id);
            if (!src || !tgt) return null;
            const isHovered =
              hovered === e.source_doc_id ||
              hovered === e.target_doc_id;
            return (
              <line
                key={i}
                x1={src.x} y1={src.y}
                x2={tgt.x} y2={tgt.y}
                stroke={isHovered ? accent : "var(--color-border-light)"}
                strokeWidth={isHovered
                  ? Math.max(1.5, e.score * 4)
                  : Math.max(0.5, e.score * 2)}
                strokeOpacity={isHovered ? 0.9 : 0.4}
              />
            );
          })}

          {/* Score labels on hovered edges */}
          {hovered && edges
            .filter(
              (e) =>
                e.source_doc_id === hovered ||
                e.target_doc_id === hovered
            )
            .map((e, i) => {
              const src = posMap.get(e.source_doc_id);
              const tgt = posMap.get(e.target_doc_id);
              if (!src || !tgt) return null;
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2;
              return (
                <text
                  key={`score-${i}`}
                  x={mx} y={my}
                  textAnchor="middle"
                  fontSize={9}
                  fill={textSec}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {e.score.toFixed(2)}
                </text>
              );
            })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos  = posMap.get(node.id);
            if (!pos) return null;
            const isHov = hovered  === node.id;
            const isSel = selected === node.id;
            const r    = isHov ? NODE_R + 4 : NODE_R;
            return (
              <g
                key={node.id}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setSelected(node.id);
                  onSelect?.(node);
                  navigate(
                    entityPath(projectId, node.entity_type, node.entity_id)
                  );
                }}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Outer ring — selection indicator */}
                {isSel && (
                  <circle
                    cx={pos.x} cy={pos.y} r={r + 4}
                    fill="none"
                    stroke={accent}
                    strokeWidth={1.5}
                    strokeOpacity={0.5}
                  />
                )}
                {/* Node body */}
                <circle
                  cx={pos.x} cy={pos.y} r={r}
                  fill={isHov ? accent : cardBg}
                  stroke={accent}
                  strokeWidth={isHov ? 0 : 1.5}
                />
                {/* Entity badge */}
                <text
                  x={pos.x} y={pos.y - 4}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fontWeight={500}
                  fill={isHov ? "#F5F2ED" : accent}
                  fontFamily="Inter, sans-serif"
                >
                  {entityLabel(node.entity_type)}
                </text>
                {/* Filename label below node */}
                <text
                  x={pos.x} y={pos.y + r + 11}
                  textAnchor="middle"
                  fontSize={9}
                  fill={textSec}
                  fontFamily="Inter, sans-serif"
                >
                  {shortName(node.original_filename)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hoveredNode && (
          <div style={{
            position: "absolute" as const,
            bottom: 10, left: 10,
            background: "var(--color-bg-primary)",
            border: `1px solid ${border}`,
            padding: "8px 12px", maxWidth: 280,
            pointerEvents: "none" as const,
          }}>
            <p style={{
              fontSize: 11, fontWeight: 500,
              color: textPrim, margin: 0,
              fontFamily: "Inter, sans-serif",
            }}>
              {hoveredNode.original_filename}
            </p>
            {hoveredNode.location && (
              <p style={{
                fontSize: 10, color: textSec,
                margin: "3px 0 0", fontFamily: "Inter, sans-serif",
              }}>
                📍 {hoveredNode.location}
              </p>
            )}
            {(hoveredNode.keywords ?? []).length > 0 && (
              <p style={{
                fontSize: 10, color: textSec,
                margin: "3px 0 0", fontFamily: "Inter, sans-serif",
              }}>
                🏷 {hoveredNode.keywords.slice(0, 4).join(", ")}
              </p>
            )}
            <p style={{
              fontSize: 10, color: accent,
              margin: "3px 0 0", fontFamily: "Inter, sans-serif",
            }}>
              Tıkla → detaya git
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        display: "flex", gap: 16, marginTop: 8,
        alignItems: "center",
      }}>
        <span style={{
          fontSize: 10, color: textSec,
          fontFamily: "Inter, sans-serif",
        }}>
          C = Yazışma · R = RFI · CH = Değişiklik · D = Teslim
        </span>
        <span style={{
          fontSize: 10, color: textSec,
          fontFamily: "Inter, sans-serif",
        }}>
          Kenar kalınlığı = ilişki skoru
        </span>
      </div>
    </div>
  );
}
