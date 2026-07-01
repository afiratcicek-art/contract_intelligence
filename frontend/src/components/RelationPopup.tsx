import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";

interface RelationItem {
  id: string;
  ref: string;
  subject: string;
  status: string;
  entity_type: "correspondence" | "rfi";
  score: number;
  parent_id?: string | null;
}

interface RelationsResponse {
  chain:   RelationItem[];
  content: RelationItem[];
}

interface Props {
  projectId:  string;
  entityType: "correspondence" | "rfi";
  entityId:   string;
  onClose: () => void;
}

function entityPath(projectId: string, item: RelationItem): string {
  if (item.entity_type === "correspondence")
    return `/projects/${projectId}/workspace/correspondence/${item.id}`;
  return `/projects/${projectId}/workspace/rfis/${item.id}`;
}

export default function RelationPopup({
  projectId,
  entityType,
  entityId,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const [data,    setData]    = useState<RelationsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const bg      = "var(--color-bg-primary)";
  const border  = "var(--color-border-light)";
  const textP   = "var(--color-text-primary)";
  const textS   = "var(--color-text-secondary)";
  const accent  = "var(--color-accent)";

  useEffect(() => {
    setLoading(true);
    api
      .get<RelationsResponse>(
        `/projects/${projectId}/documents/card-relations/${entityType}/${entityId}`
      )
      .then(setData)
      .catch(() => setData({ chain: [], content: [] }))
      .finally(() => setLoading(false));
  }, [projectId, entityType, entityId]);

  const goTo = (item: RelationItem) => {
    onClose();
    navigate(entityPath(projectId, item));
  };

  const goToGraph = () => {
    onClose();
    const params = new URLSearchParams({
      module: "documents",
      focus_type: entityType,
      focus_id: entityId,
    });
    navigate(`/projects/${projectId}/workspace?${params.toString()}`);
  };

  const renderRow = (item: RelationItem, color: string, isChild = false) => (
    <button
      key={item.id}
      onClick={() => goTo(item)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", textAlign: "left" as const,
        padding: isChild ? "9px 12px 9px 26px" : "10px 12px",
        marginBottom: 6,
        background: isChild ? "var(--color-bg-primary)" : "var(--color-bg-secondary)",
        border: `1px solid ${border}`,
        borderLeft: `2px solid ${color}`,
        cursor: "pointer", fontFamily: "Inter, sans-serif",
      }}
    >
      <div>
        <span style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10, color: textS,
          display: "flex", alignItems: "center", gap: 3,
        }}>
          {isChild && <span style={{ color, marginRight: 2 }}>└</span>}
          {item.ref}
        </span>
        <p style={{ fontSize: isChild ? 11 : 12, color: textP, margin: "2px 0 0" }}>
          {item.subject}
        </p>
      </div>
      <span style={{ fontSize: 10, color: textS }}>
        {item.score.toFixed(2)}
      </span>
    </button>
  );

  const renderGroup = (
    title: string,
    items: RelationItem[],
    color: string,
    asTree = false
  ) => {
    if (items.length === 0) return null;

    if (!asTree) {
      return (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 500, color: textS,
            textTransform: "uppercase" as const,
            letterSpacing: "0.06em", marginBottom: 6,
            fontFamily: "Inter, sans-serif",
          }}>
            {title}
          </div>
          {items.map((item) => renderRow(item, color, false))}
        </div>
      );
    }

    // Tree render — group by parent_id, roots first.
    const byId = new Map(items.map((i) => [i.id, i]));
    const childMap = new Map<string, RelationItem[]>();
    items.forEach((i) => {
      if (i.parent_id && byId.has(i.parent_id)) {
        const arr = childMap.get(i.parent_id) ?? [];
        arr.push(i);
        childMap.set(i.parent_id, arr);
      }
    });
    const roots = items.filter(
      (i) => !i.parent_id || !byId.has(i.parent_id)
    );

    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, color: textS,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em", marginBottom: 6,
          fontFamily: "Inter, sans-serif",
        }}>
          {title}
        </div>
        {roots.map((root) => (
          <div key={root.id}>
            {renderRow(root, color, false)}
            {(childMap.get(root.id) ?? []).map((child) =>
              renderRow(child, color, true)
            )}
          </div>
        ))}
      </div>
    );
  };

  const total = data
    ? data.chain.length + data.content.length
    : 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed" as const, inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: bg, border: `1px solid ${border}`,
          borderLeft: "3px solid var(--color-ai)",
          borderRadius: 6, padding: 20,
          width: "100%", maxWidth: 440,
          maxHeight: "70vh", overflowY: "auto" as const,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 14,
        }}>
          <div style={{
            fontFamily: "Playfair Display, Georgia, serif",
            fontSize: 16, color: textP, fontWeight: 500,
          }}>
            Benzerlik Tespit Edilen Kayıtlar
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none",
              fontSize: 18, color: textS, cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        {loading && (
          <p style={{ fontSize: 12, color: textS, fontFamily: "Inter, sans-serif" }}>
            Yükleniyor…
          </p>
        )}

        {!loading && total === 0 && (
          <p style={{
            fontSize: 12, color: textS, fontStyle: "italic",
            fontFamily: "Inter, sans-serif",
          }}>
            İlişkili kayıt bulunamadı.
          </p>
        )}

        {!loading && data && (
          <>
            {renderGroup("Zincir (Parent / Child)", data.chain, "var(--color-ai)", true)}
            {renderGroup("İçerik Benzerliği", data.content, textS, false)}
            {total > 0 && (
              <button
                onClick={goToGraph}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 6, width: "100%", marginTop: 4,
                  background: "var(--color-ai-bg)", color: "var(--color-ai)",
                  border: "1px solid var(--color-ai)", borderRadius: 6,
                  padding: "9px 14px", fontSize: 12, fontWeight: 500,
                  cursor: "pointer", fontFamily: "Inter, sans-serif",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="2.5" />
                  <circle cx="5" cy="19" r="2.5" />
                  <circle cx="19" cy="19" r="2.5" />
                  <line x1="12" y1="7.5" x2="6.5" y2="17" />
                  <line x1="12" y1="7.5" x2="17.5" y2="17" />
                </svg>
                İlişki Haritasını Gör
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
