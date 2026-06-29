import { useState, useCallback } from "react";
import type { CSSProperties } from "react";
import {
  searchDocuments,
  listDocuments,
  type ProjectDocument,
} from "../services/api";

interface DocumentsModuleProps {
  projectId: string;
}

const SECTION_LABEL: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--color-text-secondary)",
  fontWeight: 500,
  fontFamily: "Inter, sans-serif",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

const ENTITY_LABELS: Record<string, string> = {
  rfi: "RFI",
  correspondence: "Correspondence",
  change: "Change",
  deliverable: "Deliverable",
  chronology: "Chronology",
  contract_document: "Contract",
  internal_alert: "Alert",
};

export default function DocumentsModule({ projectId }: DocumentsModuleProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const data = await searchDocuments(projectId, q);
      setResults(data);
      setSearched(true);
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [projectId, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 20px",
        borderBottom: "0.5px solid var(--color-border-medium)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <p style={{
          fontFamily: "Playfair Display, Georgia, serif",
          fontSize: 16,
          fontWeight: 500,
          color: "var(--color-text-primary)",
          margin: 0,
          flexShrink: 0,
        }}>
          Documents
        </p>
        {/* Search bar */}
        <div style={{ flex: 1, display: "flex", gap: 8 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by keyword, location, filename..."
            style={{
              flex: 1,
              fontSize: 13,
              padding: "7px 12px",
              border: "1px solid var(--color-border-medium)",
              borderRadius: 0,
              background: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              fontFamily: "Inter, sans-serif",
              outline: "none",
            }}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            style={{
              fontSize: 12,
              padding: "7px 16px",
              background: query.trim()
                ? "var(--color-accent)"
                : "var(--color-border-medium)",
              color: "#F5F2ED",
              border: "none",
              borderRadius: 0,
              cursor: loading || !query.trim()
                ? "not-allowed" : "pointer",
              fontFamily: "Inter, sans-serif",
              flexShrink: 0,
            }}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {error && (
          <p style={{
            fontSize: 13,
            color: "var(--color-alert-red)",
            fontFamily: "Inter, sans-serif",
          }}>
            {error}
          </p>
        )}

        {!searched && !loading && (
          <p style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            fontStyle: "italic",
            fontFamily: "Inter, sans-serif",
          }}>
            Search across all project documents by keyword,
            location, or filename.
          </p>
        )}

        {searched && results.length === 0 && (
          <p style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            fontStyle: "italic",
            fontFamily: "Inter, sans-serif",
          }}>
            No documents found for "{query}".
          </p>
        )}

        {results.length > 0 && (
          <div>
            <p style={{ ...SECTION_LABEL, marginBottom: 12 }}>
              {results.length} result{results.length !== 1 ? "s" : ""}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {results.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    padding: "12px 16px",
                    border: "1px solid var(--color-border-light)",
                    background: "var(--color-bg-secondary)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {/* Row 1: filename + entity type */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}>
                    <p style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      fontFamily: "Inter, sans-serif",
                      margin: 0,
                      wordBreak: "break-all",
                    }}>
                      {doc.original_filename}
                    </p>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--color-text-secondary)",
                      fontFamily: "Inter, sans-serif",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}>
                      {ENTITY_LABELS[doc.entity_type] ?? doc.entity_type}
                    </span>
                  </div>

                  {/* Row 2: metadata */}
                  <div style={{
                    display: "flex",
                    gap: 16,
                    fontSize: 11,
                    color: "var(--color-text-secondary)",
                    fontFamily: "Inter, sans-serif",
                    flexWrap: "wrap",
                  }}>
                    {doc.doc_date && (
                      <span>{formatDate(doc.doc_date)}</span>
                    )}
                    {doc.doc_type && (
                      <span style={{ textTransform: "capitalize" }}>
                        {doc.doc_type}
                      </span>
                    )}
                    {doc.location && (
                      <span>📍 {doc.location}</span>
                    )}
                    <span>{formatBytes(doc.file_size_bytes)}</span>
                    <span style={{
                      color: doc.parse_status === "completed"
                        ? "var(--color-success)"
                        : "var(--color-text-secondary)",
                    }}>
                      {doc.parse_status}
                    </span>
                  </div>

                  {/* Row 3: keywords */}
                  {doc.keywords && doc.keywords.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {doc.keywords.map((kw, i) => (
                        <span
                          key={i}
                          style={{
                            fontSize: 10,
                            padding: "2px 7px",
                            background: "var(--color-bg-primary)",
                            border: "0.5px solid var(--color-border-medium)",
                            color: "var(--color-text-secondary)",
                            fontFamily: "JetBrains Mono, monospace",
                          }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
