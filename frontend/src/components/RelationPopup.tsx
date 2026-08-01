import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { entityPath } from "../utils/entityPath";

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

export default function RelationPopup({
  projectId,
  entityType,
  entityId,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const [data,    setData]    = useState<RelationsResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [bridgeMode, setBridgeMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const bg      = "var(--color-bg-primary)";
  const border  = "var(--color-border-light)";
  const textP   = "var(--color-text-primary)";
  const textS   = "var(--color-text-secondary)";
  const accent  = "var(--color-accent)";
  const accentText = "var(--color-accent-text)";

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

  const allItems: RelationItem[] = [
    ...(data?.chain   ?? []),
    ...(data?.content ?? []),
  ];
  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allSelected =
    allItems.length > 0 && allItems.every((i) => selectedIds.has(i.id));
  const handleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(allItems.map((i) => i.id)));
  const handleBridgeNavigate = () => {
    if (selectedIds.size === 0) return;
    onClose();
    navigate(
      `/projects/${projectId}/workspace?module=chronologies`,
      { state: { bridgeIds: [...selectedIds] } }
    );
  };

  const goTo = (item: RelationItem) => {
    onClose();
    navigate(entityPath(projectId, item.entity_type, item.id));
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

  const renderRow = (item: RelationItem, color: string, isChild = false) => {
    const pad     = isChild ? "8px 12px 8px 26px" : "10px 12px";
    const checked = selectedIds.has(item.id);
    if (bridgeMode) {
      return (
        <div
          key={item.id}
          role="checkbox"
          aria-checked={checked}
          onClick={() => toggleId(item.id)}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: pad, marginBottom: 8, cursor: "pointer",
            background: isChild ? bg : "var(--color-bg-secondary)",
            borderTop: `1px solid ${checked ? accent : border}`,
            borderRight: `1px solid ${checked ? accent : border}`,
            borderBottom: `1px solid ${checked ? accent : border}`,
            borderLeft: `2px solid ${checked ? accent : color}`,
            fontFamily: "var(--font-ui)",
          }}
        >
          <div style={{
            width: 14, height: 14, flexShrink: 0,
            border: `1.5px solid ${checked ? accent : "var(--color-text-secondary)"}`,
            background: checked ? accent : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {checked && (
              <svg width="9" height="7" viewBox="0 0 9 7" aria-hidden="true">
                <polyline points="1,3.5 3.5,6 8,1"
                  stroke="var(--color-bg-primary)" strokeWidth="1.5"
                  fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <span style={{
              fontFamily: "var(--font-meta)",
              fontSize: 11, color: textS,
              display: "flex", alignItems: "center", gap: 4,
            }}>
              {isChild && <span style={{ color, marginRight: 2 }}>└</span>}
              {item.ref}
            </span>
            <p style={{ fontSize: isChild ? 11 : 12, color: textP, margin: "2px 0 0" }}>
              {item.subject}
            </p>
          </div>
        </div>
      );
    }
    return (
      <button
        key={item.id}
        onClick={() => goTo(item)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", textAlign: "left" as const,
          padding: pad, marginBottom: 8,
          background: isChild ? bg : "var(--color-bg-secondary)",
          border: `1px solid ${border}`,
          borderLeft: `2px solid ${color}`,
          cursor: "pointer", fontFamily: "var(--font-ui)",
        }}
      >
        <div>
          <span style={{
            fontFamily: "var(--font-meta)",
            fontSize: 11, color: textS,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            {isChild && <span style={{ color, marginRight: 2 }}>└</span>}
            {item.ref}
          </span>
          <p style={{ fontSize: isChild ? 11 : 12, color: textP, margin: "2px 0 0" }}>
            {item.subject}
          </p>
        </div>
        <span style={{ fontSize: 11, color: textS }}>
          {item.score.toFixed(2)}
        </span>
      </button>
    );
  };

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
            letterSpacing: "0.06em", marginBottom: 8,
            fontFamily: "var(--font-ui)",
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
    // Recursive tree — supports unlimited depth (grandchildren, etc.)
    const renderTree = (item: RelationItem, depth: number) => (
      <div key={item.id}>
        {renderRow(item, color, depth > 0)}
        {(childMap.get(item.id) ?? []).map((child) =>
          renderTree(child, depth + 1)
        )}
      </div>
    );

    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, color: textS,
          textTransform: "uppercase" as const,
          letterSpacing: "0.06em", marginBottom: 8,
          fontFamily: "var(--font-ui)",
        }}>
          {title}
        </div>
        {roots.map((root) => renderTree(root, 0))}
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
        backgroundColor: "var(--color-overlay)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: "var(--z-modal)" as unknown as number, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: bg, border: `1px solid ${border}`,
          borderLeft: "3px solid var(--color-ai)",
          borderRadius: 0, padding: 20,
          width: "100%", maxWidth: 440,
          maxHeight: "70vh", overflowY: "auto" as const,
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 14,
        }}>
          <div style={{
            fontFamily: "var(--font-brand)",
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
          <p style={{ fontSize: 12, color: textS, fontFamily: "var(--font-ui)" }}>
            Yükleniyor…
          </p>
        )}

        {!loading && total === 0 && (
          <p style={{
            fontSize: 12, color: textS, fontStyle: "italic",
            fontFamily: "var(--font-ui)",
          }}>
            İlişkili kayıt bulunamadı.
          </p>
        )}

        {!loading && data && (
          <>
            {renderGroup("Zincir (Parent / Child)", data.chain, "var(--color-ai)", true)}
            {renderGroup("İçerik Benzerliği", data.content, textS, true)}
            {total > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>

                {/* Satır 1 — navigasyon + bridge toggle */}
                <div style={{ display: "flex", gap: 8 }}>
                  {!bridgeMode && (
                    <button
                      onClick={goToGraph}
                      style={{
                        flex: 1, display: "flex", alignItems: "center",
                        justifyContent: "center", gap: 6,
                        background: "var(--color-ai-bg)", color: "var(--color-ai)",
                        border: "1px solid var(--color-ai)",
                        padding: "8px 14px", fontSize: 12, fontWeight: 500,
                        cursor: "pointer", fontFamily: "var(--font-ui)",
                      }}
                    >
                      İlişki Haritasını Gör
                    </button>
                  )}
                  <button
                    onClick={() => { setBridgeMode((m) => !m); setSelectedIds(new Set()); }}
                    style={{
                      flex: bridgeMode ? 1 : "0 0 auto",
                      display: "flex", alignItems: "center",
                      justifyContent: "center",
                      background: bridgeMode ? accent : "var(--color-bg-secondary)",
                      color: bridgeMode ? "var(--color-bg-primary)" : accentText,
                      border: `1px solid ${accent}`,
                      padding: "8px 14px", fontSize: 12, fontWeight: 500,
                      cursor: "pointer", fontFamily: "var(--font-ui)",
                    }}
                  >
                    {bridgeMode ? "Seçimi İptal" : "Kronoloji'ye Aktar"}
                  </button>
                </div>

                {/* Satır 2 — tümünü seç + aktar (yalnız bridge modda) */}
                {bridgeMode && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 12px",
                    borderTop: `1px solid ${accent}`,
                    borderRight: `1px solid ${accent}`,
                    borderBottom: `1px solid ${accent}`,
                    borderLeft: `2px solid ${accent}`,
                    background: "var(--color-bg-secondary)",
                  }}>
                    <div
                      role="checkbox"
                      aria-checked={allSelected}
                      onClick={handleSelectAll}
                      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexShrink: 0 }}
                    >
                      <div style={{
                      width: 14, height: 14,
                      border: `1.5px solid ${allSelected ? accent : "var(--color-text-secondary)"}`,
                      background: allSelected ? accent : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {allSelected && (
                          <svg width="9" height="7" viewBox="0 0 9 7" aria-hidden="true">
                            <polyline points="1,3.5 3.5,6 8,1"
                              stroke="var(--color-bg-primary)" strokeWidth="1.5"
                              fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: textS, fontFamily: "var(--font-ui)" }}>
                        Tümünü Seç
                      </span>
                    </div>
                    <span style={{ flex: 1, fontSize: 11, color: textS, fontFamily: "var(--font-ui)" }}>
                      {selectedIds.size > 0 ? `${selectedIds.size} kayıt seçildi` : ""}
                    </span>
                    <button
                      onClick={handleBridgeNavigate}
                      disabled={selectedIds.size === 0}
                      style={{
                        background: selectedIds.size > 0 ? accent : "transparent",
                        color: selectedIds.size > 0 ? "var(--color-bg-primary)" : border,
                        border: `1px solid ${selectedIds.size > 0 ? accent : border}`,
                        padding: "6px 14px", fontSize: 12, fontWeight: 500,
                        cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      Aktar →
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
