import { useState, useEffect } from "react";
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

const TIER_RADIUS: Record<string, number> = {
  chain: 130,
  content: 200,
  indirect: 245,
};

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

export default function FocusedRelationGraph({
  projectId,
  entityType,
  entityId,
}: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<FocusedGraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  const cardBg = "var(--color-bg-secondary)";
  const border = "var(--color-border-light)";
  const textPrim = "var(--color-text-primary)";
  const textSec = "var(--color-text-secondary)";
  const ai = "var(--color-ai)";
  const aiBg = "var(--color-ai-bg)";

  useEffect(() => {
    setLoading(true);
    api
      .get<FocusedGraphResponse>(
        `/projects/${projectId}/documents/focused-graph/${entityType}/${entityId}`
      )
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [projectId, entityType, entityId]);

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

  // Group nodes by tier, place each tier on its own ring
  const byTier: Record<string, FocusNode[]> = { chain: [], content: [], indirect: [] };
  nodes.forEach((n) => byTier[n.tier]?.push(n));

  const posMap = new Map<string, { x: number; y: number }>();
  posMap.set(center.id, { x: CX, y: CY });

  (["chain", "content", "indirect"] as const).forEach((tier) => {
    const group = byTier[tier];
    const radius = TIER_RADIUS[tier];
    group.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(group.length, 1) - Math.PI / 2;
      posMap.set(n.id, {
        x: CX + radius * Math.cos(angle),
        y: CY + radius * Math.sin(angle),
      });
    });
  });

  const allNodesForLookup: Array<FocusNode | CenterNode> = [center, ...nodes];
  const nodeById = new Map(allNodesForLookup.map((n) => [n.id, n]));

  const goTo = (id: string) => {
    const n = nodeById.get(id);
    if (!n) return;
    navigate(entityPath(projectId, n.entity_type, n.id));
  };

  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 500, color: textSec,
        textTransform: "uppercase" as const, letterSpacing: "0.08em",
        marginBottom: 10, fontFamily: "Inter, sans-serif",
      }}>
        İlişki Haritası
        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, textTransform: "none" as const }}>
          {nodes.length} kayıt · {edges.length} bağlantı
        </span>
      </div>

      <div style={{
        background: cardBg, border: `1px solid ${border}`,
        borderLeft: `3px solid ${ai}`, borderRadius: 6,
        overflow: "hidden", position: "relative" as const,
      }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} aria-label="İlişki haritası">
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

          {/* Center node — drawn last, always on top */}
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
        </svg>
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
    </div>
  );
}
