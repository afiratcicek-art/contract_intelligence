/**
 * IntelligenceModule — SYSTEM tab: grounded project Q&A.
 *
 * UX aligned with AuthoringDraftPage intelligence rail:
 *   - brand title + tip copy
 *   - AI disclaimer (generic; no vendor name)
 *   - two-column split: chat (left) + source künye cards (right)
 *   - jump ribbon ticks sync chat scroll ↔ active exchange sources
 * Citations open identity cards in a new tab (chat state preserved).
 */
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
  type CSSProperties,
} from "react";
import AiActionButton from "./AiActionButton";
import StatusChip from "./StatusChip";
import {
  askProjectIntelligence,
  ApiError,
  type IntelligenceCitation,
} from "../services/api";
import { entityPath } from "../utils/entityPath";
import { useLanguage } from "../context/LanguageContext";

type Props = { projectId: string };

/** One Q&A exchange — ribbon + source pane key off this id. */
type Exchange = {
  id: string;
  question: string;
  answer: string;
  citations: IntelligenceCitation[];
  warnings: string[];
  error?: boolean;
};

const MAX_EXCHANGES = 24;

function citationHref(projectId: string, c: IntelligenceCitation): string {
  const t = c.entity_type;
  if (t === "correspondence" || t === "rfi" || t === "change") {
    return entityPath(projectId, t, c.entity_id);
  }
  if (t === "deliverable") {
    return `/projects/${projectId}/workspace/deliverables/${c.entity_id}`;
  }
  return `/projects/${projectId}/workspace`;
}

export default function IntelligenceModule({ projectId }: Props) {
  const { lang } = useLanguage();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const active =
    exchanges.find((e) => e.id === activeId) ??
    exchanges[exchanges.length - 1] ??
    null;

  const jumpToExchange = useCallback((id: string) => {
    setActiveId(id);
    document.getElementById(`intel-ex-${id}`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, []);

  // Scroll sync: which exchange is most visible → update source pane + ribbon.
  useEffect(() => {
    const root = chatScrollRef.current;
    if (!root || exchanges.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (!top?.target.id.startsWith("intel-ex-")) return;
        const id = top.target.id.slice("intel-ex-".length);
        setActiveId((prev) => (prev === id ? prev : id));
      },
      { root, threshold: [0.35, 0.55, 0.75] },
    );

    for (const ex of exchanges) {
      const el = document.getElementById(`intel-ex-${ex.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [exchanges]);

  async function onSubmit(e?: FormEvent) {
    e?.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;

    setDraft("");
    setBusy(true);

    const history = exchanges
      .filter((ex) => !ex.error)
      .flatMap((ex) => [
        { role: "user" as const, content: ex.question },
        { role: "assistant" as const, content: ex.answer },
      ]);

    try {
      const res = await askProjectIntelligence(projectId, {
        question,
        messages: history,
        language: lang === "tr" ? "tr" : "en",
      });
      const id = `ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const next: Exchange = {
        id,
        question,
        answer: res.answer_text,
        citations: res.citations ?? [],
        warnings: res.warnings ?? [],
      };
      setExchanges((prev) => [...prev, next].slice(-MAX_EXCHANGES));
      setActiveId(id);
      requestAnimationFrame(() => {
        document.getElementById(`intel-ex-${id}`)?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      });
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? String(err.message)
          : lang === "tr"
            ? "Yanıt alınamadı. Lütfen tekrar deneyin."
            : "Could not get an answer. Please try again.";
      const id = `ex-${Date.now()}-err`;
      const next: Exchange = {
        id,
        question,
        answer: detail,
        citations: [],
        warnings: [],
        error: true,
      };
      setExchanges((prev) => [...prev, next].slice(-MAX_EXCHANGES));
      setActiveId(id);
    } finally {
      setBusy(false);
    }
  }

  const title = lang === "tr" ? "Zeka katmanı" : "Intelligence";
  const tip =
    lang === "tr"
      ? "Proje kayıtları hakkında sorun; yanıtlar anahtar kelimeyle bulunan kaynaklara dayanır."
      : "Ask about project records; answers are grounded in keyword-matched sources.";
  const disclaimer =
    lang === "tr"
      ? "Bu araç yapay zekâ kullanır ve hata yapabilir. Önemli yanıtları kaynaklardan doğrulayın."
      : "This tool uses AI and can make mistakes. Please double-check important responses against the sources.";
  const placeholder =
    lang === "tr"
      ? "Örn. notice to correct, son yazışma…"
      : "e.g. notice to correct, latest correspondence…";
  const emptyHint =
    lang === "tr"
      ? "Bir soru yazın. Kaynak künyeleri sağda görünür; ribbon ile eski yanıtlara dönün."
      : "Ask a question. Source cards appear on the right; use the ribbon to revisit older answers.";
  const sourcesTitle = lang === "tr" ? "Kaynaklar" : "Sources";
  const sourcesEmpty =
    lang === "tr"
      ? "Bu yanıt için kaynak yok."
      : "No sources for this answer.";
  const sendLabel = lang === "tr" ? "Gönder" : "Send";

  return (
    <div className="intel-split-root" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Generic AI disclaimer — vendor-neutral */}
      <div
        role="note"
        style={{
          padding: "8px 12px",
          fontSize: 11,
          fontFamily: "var(--font-ui)",
          lineHeight: 1.4,
          color: "var(--color-text-secondary)",
          background: "var(--color-bg-secondary)",
          borderLeft: "2px solid var(--color-border-medium)",
        }}
      >
        {disclaimer}
      </div>

      <div
        className="intel-split"
        style={{
          display: "grid",
          gridTemplateColumns: "1.65fr 1fr",
          gap: 16,
          alignItems: "start",
          minHeight: "calc(100vh - 180px)",
        }}
      >
        {/* ── Chat rail (authoring-aligned) ── */}
        <aside
          style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-medium)",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            height: "calc(100vh - 180px)",
            maxHeight: "calc(100vh - 180px)",
            boxSizing: "border-box",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-brand)",
              fontSize: "var(--type-title-card)",
              fontWeight: 500,
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            {title}
          </h2>

          {exchanges.length === 0 && (
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-ui)",
                lineHeight: 1.4,
              }}
            >
              {tip}
            </p>
          )}

          {/* Thread + jump ribbon */}
          <div
            style={{
              flex: 1,
              minHeight: 160,
              display: "flex",
              gap: 6,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              ref={chatScrollRef}
              style={{
                flex: 1,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                paddingRight: 4,
              }}
            >
              {exchanges.length === 0 && !busy && (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-tertiary)",
                    fontStyle: "italic",
                    fontFamily: "var(--font-ui)",
                    padding: "16px 4px",
                    margin: 0,
                  }}
                >
                  {emptyHint}
                </p>
              )}

              {exchanges.map((ex) => (
                <div
                  key={ex.id}
                  id={`intel-ex-${ex.id}`}
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div
                    style={{
                      alignSelf: "flex-end",
                      maxWidth: "92%",
                      padding: "8px 10px",
                      fontSize: 12,
                      fontFamily: "var(--font-ui)",
                      lineHeight: 1.45,
                      color: "var(--color-text-primary)",
                      background: "var(--color-bg-primary)",
                      border: "1px solid var(--color-border-medium)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {ex.question}
                  </div>
                  <div
                    style={{
                      alignSelf: "flex-start",
                      maxWidth: "92%",
                      padding: "8px 10px",
                      fontSize: 12,
                      fontFamily: "var(--font-ui)",
                      lineHeight: 1.45,
                      color: ex.error
                        ? "var(--color-alert-red)"
                        : "var(--color-text-secondary)",
                      background: "var(--color-bg-primary)",
                      borderLeft: `2px solid ${
                        ex.error ? "var(--color-alert-red)" : "var(--color-ai)"
                      }`,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {ex.answer}
                    {ex.warnings.length > 0 && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 11,
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {ex.warnings.map((w, i) => (
                          <div key={i}>{w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {busy && (
                <div
                  style={{
                    alignSelf: "flex-start",
                    fontSize: 12,
                    color: "var(--color-ai)",
                    fontFamily: "var(--font-meta)",
                    borderLeft: "2px solid var(--color-ai)",
                    padding: "8px 10px",
                    background: "var(--color-bg-primary)",
                  }}
                >
                  {lang === "tr" ? "Düşünülüyor…" : "Thinking…"}
                </div>
              )}
            </div>

            {exchanges.length > 0 && (
              <nav
                aria-label={lang === "tr" ? "Yanıta atla" : "Jump to answer"}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  gap: 5,
                  padding: "4px 0",
                  width: 14,
                  flexShrink: 0,
                }}
              >
                {exchanges.map((ex) => {
                  const isActive = ex.id === active?.id;
                  const label =
                    ex.question.length > 40
                      ? `${ex.question.slice(0, 40)}…`
                      : ex.question;
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => jumpToExchange(ex.id)}
                      style={{
                        display: "block",
                        width: isActive ? 12 : 8,
                        height: isActive ? 3 : 2,
                        marginLeft: "auto",
                        padding: 0,
                        border: "none",
                        borderRadius: 0,
                        cursor: "pointer",
                        background: isActive
                          ? "var(--color-text-primary)"
                          : "var(--color-border-medium)",
                      }}
                    />
                  );
                })}
              </nav>
            )}
          </div>

          {/* Composer — Send below textarea like authoring */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              rows={4}
              placeholder={placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSubmit();
                }
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 10px",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                lineHeight: 1.45,
                border: "1px solid var(--color-border-medium)",
                borderRadius: 0,
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                resize: "vertical",
                minHeight: 88,
                maxHeight: 200,
              }}
            />
            <AiActionButton
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => void onSubmit()}
              style={{ alignSelf: "flex-start" }}
            >
              {sendLabel}
            </AiActionButton>
          </div>
        </aside>

        {/* ── Source künye pane (active exchange) ── */}
        <aside
          style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-medium)",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            position: "sticky",
            top: 16,
            zIndex: "var(--z-sticky)" as unknown as number,
            alignSelf: "start",
            height: "calc(100vh - 180px)",
            maxHeight: "calc(100vh - 180px)",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-brand)",
              fontSize: "var(--type-title-card)",
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {sourcesTitle}
          </div>
          {active && (
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                fontFamily: "var(--font-meta)",
                lineHeight: 1.35,
              }}
            >
              {active.question.length > 72
                ? `${active.question.slice(0, 72)}…`
                : active.question}
            </p>
          )}

          <div
            style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {!active || active.citations.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: "var(--color-text-tertiary)",
                  fontStyle: "italic",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {sourcesEmpty}
              </p>
            ) : (
              active.citations.map((c) => (
                <a
                  key={`${c.entity_type}-${c.entity_id}`}
                  href={citationHref(projectId, c)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={c.subject}
                  style={kunyeStyle}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "baseline",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-meta)",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {c.entity_type}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-meta)",
                        fontSize: 12,
                        fontWeight: 500,
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {c.ref}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12,
                      color: "var(--color-text-primary)",
                      lineHeight: 1.35,
                      marginTop: 4,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {c.subject || "—"}
                  </div>
                  {(c.date || c.status) && (
                    <div
                      style={{
                        marginTop: 4,
                        fontFamily: "var(--font-meta)",
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      {c.date && <span className="data-figure">{String(c.date).slice(0, 10)}</span>}
                      {c.status && <StatusChip status={String(c.status)} />}
                    </div>
                  )}
                </a>
              ))
            )}
          </div>
        </aside>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .intel-split {
            grid-template-columns: 1fr !important;
          }
          .intel-split > aside {
            position: relative !important;
            top: auto !important;
            height: auto !important;
            max-height: none !important;
            min-height: 320px;
          }
        }
      `}</style>
    </div>
  );
}

const kunyeStyle: CSSProperties = {
  display: "block",
  padding: "8px 10px",
  borderLeft: "2px solid var(--color-accent)",
  background: "var(--color-bg-primary)",
  color: "var(--color-text-primary)",
  textDecoration: "none",
  flexShrink: 0,
};
