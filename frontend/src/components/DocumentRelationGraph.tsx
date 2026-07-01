import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

/* ── Types ─────────────────────────────────────────────────
   Shape mirrors GET /all-relations response
   (correspondence + rfi cards, chain/sibling/content edges). */
interface GraphNode {
  id: string;
  ref: string;
  subject: string;
  status: string;
  entity_type: "correspondence" | "rfi";
  rfi_type?: string;
  date?: string | null;
  keywords: string[];
}

interface GraphEdge {
  source: string;
  target: string;
  score: number;
  layer: "chain" | "sibling" | "content";
}

interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface Props {
  projectId: string;
  onSelect?: (node: GraphNode) => void;
}

/* ── Layout constants ───────────────────────────────────── */
const CX      = 340;
const CY      = 260;
const RADIUS  = 190;
const NODE_R  = 22;
const W       = 680;
const H       = 520;

/* ── Helpers ────────────────────────────────────────────── */
function circleLayout(count: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: CX + RADIUS * Math.cos(angle),
      y: CY + RADIUS * Math.sin(angle),
    };
  });
}

function entityLabel(type: string): string {
  return type === "correspondence" ? "C" : type === "rfi" ? "R" : "?";
}

function shortSubject(subject: string, max = 16): string {
  if (!subject) return "";
  if (subject.length <= max) return subject;
  return subject.slice(0, max - 1) + "…";
}

function entityPath(
  projectId: string,
  entityType: string,
  id: string
): string {
  if (entityType === "correspondence")
    return `/projects/${projectId}/workspace/correspondence/${id}`;
  if (entityType === "rfi")
    return `/projects/${projectId}/workspace/rfis/${id}`;
  return `/projects/${projectId}/workspace`;
}

/** Edge layer → stroke color + label. */
function layerStyle(layer: string, accent: string): { color: string; label: string } {
  if (layer === "chain")    return { color: accent,               label: "Zincir" };
  if (layer === "sibling")  return { color: "var(--color-success)", label: "Kardeş" };
  return                          { color: "var(--color-border-light)", label: "İçerik" };
}

/* ── Component ──────────────────────────────────────────── */
export default function DocumentRelationGraph({
  projectId,
  onSelect,
}: Props) {
  const navigate = useNavigate();

  const [graph,    setGraph]    = useState<GraphPayload | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [hovered,  setHovered]  = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const cardBg   = "var(--color-bg-secondary)";
  const border   = "var(--color-border-light)";
  const textPrim = "var(--color-text-primary)";
  const textSec  = "var(--color-text-secondary)";
  const accent   = "var(--color-accent)";

  useEffect(() => {
    setLoading(true);
    api
      .get<GraphPayload>(`/projects/${projectId}/documents/all-relations`)
      .then((data) => setGraph(data))
      .catch(() => setGraph({ nodes: [], edges: [] }))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div style={{ padding: "14px 0" }}>
        <p style={{ fontSize: 11, color: textSec, fontFamily: "Inter, sans-serif" }}>
          Belge ilişki grafiği yükleniyor…
        </p>
      </div>
    );
  }

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
          Henüz ilişkili kayıt bulunamadı.
        </p>
      </div>
    );
  }

  const { nodes, edges } = graph;
  const positions = circleLayout(nodes.length);
  const posMap = new Map(nodes.map((n, i) => [n.id, positions[i]]));
  const hoveredNode = nodes.find((n) => n.id === hovered) ?? null;

  return (
    <div>
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
          {nodes.length} kayıt · {edges.length} ilişki
        </span>
      </div>

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
          {edges.map((e, i) => {
            const src = posMap.get(e.source);
            const tgt = posMap.get(e.target);
            if (!src || !tgt) return null;
            const isHovered = hovered === e.source || hovered === e.target;
            const style = layerStyle(e.layer, accent);
            return (
              <line
                key={i}
                x1={src.x} y1={src.y}
                x2={tgt.x} y2={tgt.y}
                stroke={style.color}
                strokeWidth={isHovered
                  ? Math.max(1.5, e.score * 4)
                  : Math.max(0.5, e.score * 2)}
                strokeOpacity={isHovered ? 0.9 : 0.45}
              />
            );
          })}

          {hovered && edges
            .filter((e) => e.source === hovered || e.target === hovered)
            .map((e, i) => {
              const src = posMap.get(e.source);
              const tgt = posMap.get(e.target);
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
                  {layerStyle(e.layer, accent).label} {e.score.toFixed(2)}
                </text>
              );
            })}

          {nodes.map((node) => {
            const pos  = posMap.get(node.id);
            if (!pos) return null;
            const isHov = hovered  === node.id;
            const isSel = selected === node.id;
            const r     = isHov ? NODE_R + 4 : NODE_R;
            return (
              <g
                key={node.id}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setSelected(node.id);
                  onSelect?.(node);
                  navigate(entityPath(projectId, node.entity_type, node.id));
                }}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {isSel && (
                  <circle
                    cx={pos.x} cy={pos.y} r={r + 4}
                    fill="none" stroke={accent}
                    strokeWidth={1.5} strokeOpacity={0.5}
                  />
                )}
                <circle
                  cx={pos.x} cy={pos.y} r={r}
                  fill={isHov ? accent : cardBg}
                  stroke={accent}
                  strokeWidth={isHov ? 0 : 1.5}
                />
                <text
                  x={pos.x} y={pos.y - 4}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10} fontWeight={500}
                  fill={isHov ? "#F5F2ED" : accent}
                  fontFamily="Inter, sans-serif"
                >
                  {entityLabel(node.entity_type)}
                </text>
                <text
                  x={pos.x} y={pos.y - 4}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  dy={12}
                  fontSize={8}
                  fill={isHov ? "#F5F2ED" : textSec}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {node.ref}
                </text>
                <text
                  x={pos.x} y={pos.y + r + 11}
                  textAnchor="middle"
                  fontSize={9}
                  fill={textSec}
                  fontFamily="Inter, sans-serif"
                >
                  {shortSubject(node.subject)}
                </text>
              </g>
            );
          })}
        </svg>

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
              {hoveredNode.ref} — {hoveredNode.subject}
            </p>
            <p style={{
              fontSize: 10, color: textSec,
              margin: "3px 0 0", fontFamily: "Inter, sans-serif",
            }}>
              Durum: {hoveredNode.status}
            </p>
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

      <div style={{
        display: "flex", gap: 16, marginTop: 8,
        alignItems: "center", flexWrap: "wrap" as const,
      }}>
        <span style={{ fontSize: 10, color: textSec, fontFamily: "Inter, sans-serif" }}>
          C = Yazışma · R = RFI
        </span>
        <span style={{ fontSize: 10, color: accent, fontFamily: "Inter, sans-serif" }}>
          ── Zincir
        </span>
        <span style={{ fontSize: 10, color: "var(--color-success)", fontFamily: "Inter, sans-serif" }}>
          ── Kardeş
        </span>
        <span style={{ fontSize: 10, color: textSec, fontFamily: "Inter, sans-serif" }}>
          ── İçerik
        </span>
      </div>
    </div>
  );
}
