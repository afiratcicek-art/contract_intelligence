import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LanguageToggle from "../components/LanguageToggle";
import ThemeToggle from "../components/ThemeToggle";
import Button from "../components/Button";
import StatusChip from "../components/StatusChip";
import ConfirmModal from "../components/ConfirmModal";
import DocumentLink from "../components/DocumentLink";
import AiActionButton from "../components/AiActionButton";
import { getAuth, clearAuth } from "../store/auth";
import { useLanguage } from "../context/LanguageContext";
import { formatDateTime, formatMoney } from "../utils/format";
import {
  addDisputeImpact,
  addDisputeIssue,
  addDisputePosition,
  addDisputePositionRef,
  deleteDisputeImpact,
  deleteDisputeIssue,
  deleteDisputePosition,
  deleteDisputePositionRef,
  downloadDisputePack,
  fetchDispute,
  fetchLinkableDocuments,
  generateDisputePosition,
  prepareDisputePack,
  updateDispute,
  uploadDisputeDocument,
  type DisputeDossier,
  type DisputeImpact,
  type DisputeIssue,
  type DisputePosition,
  type LinkableDoc,
} from "../services/api";
import DisputeChronologyPanel from "../components/DisputeChronologyPanel";

const STATUSES = ["draft", "open", "prepared", "closed"] as const;

export default function DisputeDetail() {
  const { projectId, disputeId } = useParams<{ projectId: string; disputeId: string }>();
  const navigate = useNavigate();
  const auth = getAuth();
  const { t, lang } = useLanguage();

  const [dossier, setDossier] = useState<DisputeDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null);

  const bg = "var(--color-bg-primary)";
  const cardBg = "var(--color-bg-secondary)";
  const border = "var(--color-border-light)";
  const textPrimary = "var(--color-text-primary)";
  const textSecond = "var(--color-text-secondary)";

  const inputStyle = {
    width: "100%",
    backgroundColor: cardBg,
    border: `1px solid ${border}`,
    color: textPrimary,
    fontSize: 12,
    fontFamily: "var(--font-ui)",
    padding: "8px 10px",
    borderRadius: 0,
    outline: "none",
  } as const;

  const sectionLabel = {
    fontSize: 11,
    fontWeight: 500 as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: textSecond,
    marginBottom: 12,
  };

  const reload = useCallback(async () => {
    if (!projectId || !disputeId) return;
    const row = await fetchDispute(projectId, disputeId);
    setDossier(row);
  }, [projectId, disputeId]);

  useEffect(() => {
    if (!projectId || !disputeId) return;
    setLoading(true);
    reload()
      .catch(() => setError(t("dispute.err.load")))
      .finally(() => setLoading(false));
  }, [projectId, disputeId, reload, t]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("dispute.err.save"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 13, color: textSecond }}>{t("state.loading")}</p>
      </div>
    );
  }

  if (error && !dossier) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 13, color: "var(--color-alert-red)" }}>{error}</p>
      </div>
    );
  }

  if (!dossier || !projectId || !disputeId) return null;

  const impacts = [...(dossier.dispute_impacts || [])].sort((a, b) => a.sort_order - b.sort_order);
  const issues = [...(dossier.dispute_issues || [])].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: bg }}>
      <nav className="app-chrome-nav">
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: textSecond }}>
          <div className="gold-line gold-line-compact" />
          <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>{t("nav.projects")}</span>
          <span>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}`)}>{t("nav.overview")}</span>
          <span>/</span>
          <span style={{ cursor: "pointer" }} onClick={() => navigate(`/projects/${projectId}/workspace?module=disputes`)}>{t("module.disputes")}</span>
          <span>/</span>
          <span className="ref-number" style={{ color: textPrimary, fontWeight: 500 }}>{dossier.dispute_number}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: textSecond }}>
          <span>{auth?.full_name}</span>
          <LanguageToggle />
          <ThemeToggle />
          <button type="button" onClick={() => { clearAuth(); navigate("/login"); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: textSecond }}>
            {t("nav.signout")}
          </button>
        </div>
      </nav>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        {error && <p style={{ fontSize: 12, color: "var(--color-alert-red)", marginBottom: 12 }}>{error}</p>}

        <div className="detail-header">
          <div style={{ minWidth: 0 }}>
            <p className="ref-number" style={{ marginBottom: 6 }}>{dossier.dispute_number}</p>
            <h1 style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-h1)", fontWeight: 500, color: textPrimary, margin: 0, lineHeight: 1.3 }}>
              {dossier.title}
            </h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
            <StatusChip status={dossier.status} />
            <select
              style={{ ...inputStyle, width: "auto" }}
              value={dossier.status}
              disabled={busy}
              onChange={(e) => run(() => updateDispute(projectId, disputeId, { status: e.target.value }))}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </select>
            <Button size="sm" type="button" loading={busy} onClick={() => run(() => prepareDisputePack(projectId, disputeId))}>
              {t("dispute.preparepack")}
            </Button>
            {dossier.pack_storage_path && (
              <Button size="sm" variant="secondary" type="button" onClick={() => downloadDisputePack(projectId, disputeId, dossier.dispute_number)}>
                {t("dispute.downloadpack")}
              </Button>
            )}
          </div>
        </div>

        {/* 1. Künye */}
        <div style={sectionLabel}>{t("dispute.kunye")}</div>
        <div className="meta-grid-3" style={{ marginBottom: 28 }}>
          <div style={{ background: cardBg, padding: 16 }}>
            <Field label={t("col.origin")} value={t(`dispute.origin.${dossier.origin}`)} />
            {dossier.source_change_id && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: textSecond, marginBottom: 4 }}>{t("entity.change")}</div>
                <button type="button" className="ref-number" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-accent-text)" }}
                  onClick={() => navigate(`/projects/${projectId}/workspace/changes/${dossier.source_change_id}`)}>
                  {t("dispute.opensource")}
                </button>
              </div>
            )}
            {dossier.source_correspondence_id && (
              <div>
                <div style={{ fontSize: 11, color: textSecond, marginBottom: 4 }}>{t("entity.correspondence")}</div>
                <button type="button" className="ref-number" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-accent-text)" }}
                  onClick={() => navigate(`/projects/${projectId}/workspace/correspondence/${dossier.source_correspondence_id}`)}>
                  {t("dispute.opensource")}
                </button>
              </div>
            )}
          </div>
          <div style={{ background: cardBg, padding: 16 }}>
            <Field label={t("dispute.field.venue")} value={dossier.venue} />
            <Field label={t("dispute.packat")} value={dossier.pack_generated_at ? formatDateTime(dossier.pack_generated_at, lang) : null} />
          </div>
          <div style={{ background: cardBg, padding: 16 }}>
            <Field label={t("dispute.field.summary")} value={dossier.summary} />
          </div>
        </div>

        {/* 2. Impacts */}
        <div style={sectionLabel}>{t("dispute.impacts")}</div>
        <div style={{ background: cardBg, padding: 16, marginBottom: 28 }}>
          {impacts.length === 0 && <p style={{ fontSize: 12, color: textSecond, fontStyle: "italic" }}>{t("dispute.noimpacts")}</p>}
          {impacts.map((row) => (
            <ImpactRow key={row.id} row={row} lang={lang} t={t} onDelete={() => setConfirm({
              message: t("dispute.confirm.removeimpact"),
              run: () => { setConfirm(null); run(() => deleteDisputeImpact(projectId, disputeId, row.id)); },
            })} />
          ))}
          <ImpactForm disabled={busy} t={t} inputStyle={inputStyle} onAdd={(body) => run(() => addDisputeImpact(projectId, disputeId, body))} />
        </div>

        {/* 3. Chronology */}
        <div style={{ marginBottom: 28 }}>
          <DisputeChronologyPanel projectId={projectId} dispute={dossier} onChanged={reload} />
        </div>

        {/* 4. Issue board */}
        <div style={sectionLabel}>{t("dispute.board")}</div>
        <IssueForm disabled={busy} t={t} inputStyle={inputStyle} onAdd={(title) => run(() => addDisputeIssue(projectId, disputeId, { title }))} />
        <div className="dispute-issue-board">
          {issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              projectId={projectId}
              disputeId={disputeId}
              t={t}
              busy={busy}
              inputStyle={inputStyle}
              onAddPosition={(side, title, summary) => run(() => addDisputePosition(projectId, disputeId, issue.id, { side, title, summary }))}
              onDeleteIssue={() => setConfirm({
                message: t("dispute.confirm.removeissue"),
                run: () => { setConfirm(null); run(() => deleteDisputeIssue(projectId, disputeId, issue.id)); },
              })}
              onDeletePosition={(pid) => setConfirm({
                message: t("dispute.confirm.removeposition"),
                run: () => { setConfirm(null); run(() => deleteDisputePosition(projectId, disputeId, issue.id, pid)); },
              })}
              onAddRef={(pid, body) => run(() => addDisputePositionRef(projectId, disputeId, issue.id, pid, body))}
              onDeleteRef={(pid, rid) => run(() => deleteDisputePositionRef(projectId, disputeId, issue.id, pid, rid))}
              onUpload={(pid, file) => run(async () => {
                const docId = await uploadDisputeDocument(projectId, disputeId, file);
                await addDisputePositionRef(projectId, disputeId, issue.id, pid, { ref_type: "document", document_id: docId });
              })}
            />
          ))}
        </div>
      </main>

      <ConfirmModal
        open={!!confirm}
        message={confirm?.message || ""}
        confirmLabel={t("action.delete")}
        cancelLabel={t("action.cancel")}
        variant="destructive"
        onConfirm={() => confirm?.run()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontStyle: value ? "normal" : "italic" }}>
        {value || "—"}
      </div>
    </div>
  );
}

function ImpactRow({
  row, lang, t, onDelete,
}: {
  row: DisputeImpact;
  lang: "tr" | "en" | "ar";
  t: (k: string) => string;
  onDelete: () => void;
}) {
  const amount = row.type === "cost"
    ? formatMoney(row.amount, row.unit, lang)
    : row.amount != null ? `${row.amount} ${row.unit || ""}`.trim() : "—";
  return (
    <div className="list-row" style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px auto", gap: 8, padding: "8px 0", borderBottom: "0.5px solid var(--color-border-light)" }}>
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{t(`dispute.impact.${row.type}`)}</span>
      <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{row.label}</span>
      <span className="data-figure" style={{ color: "var(--color-text-primary)" }}>{amount}</span>
      <Button size="sm" variant="destructive" type="button" onClick={onDelete}>{t("action.remove")}</Button>
    </div>
  );
}

function ImpactForm({
  disabled, t, inputStyle, onAdd,
}: {
  disabled: boolean;
  t: (k: string) => string;
  inputStyle: CSSProperties;
  onAdd: (body: { type: "cost" | "time" | "other"; label: string; amount?: number; unit?: string; notes?: string }) => void;
}) {
  const [type, setType] = useState<"cost" | "time" | "other">("cost");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 100px 80px auto", gap: 8, marginTop: 12, alignItems: "center" }}>
      <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
        <option value="cost">{t("dispute.impact.cost")}</option>
        <option value="time">{t("dispute.impact.time")}</option>
        <option value="other">{t("dispute.impact.other")}</option>
      </select>
      <input style={inputStyle} placeholder={t("dispute.ph.impactlabel")} value={label} onChange={(e) => setLabel(e.target.value)} />
      <input style={inputStyle} placeholder={t("dispute.ph.amount")} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input style={inputStyle} placeholder={t("dispute.ph.unit")} value={unit} onChange={(e) => setUnit(e.target.value)} />
      <Button size="sm" type="button" disabled={disabled || !label.trim()} onClick={() => {
        onAdd({
          type,
          label: label.trim(),
          amount: amount ? Number(amount) : undefined,
          unit: unit.trim() || undefined,
        });
        setLabel(""); setAmount(""); setUnit("");
      }}>{t("action.add")}</Button>
    </div>
  );
}

function IssueForm({
  disabled, t, inputStyle, onAdd,
}: {
  disabled: boolean;
  t: (k: string) => string;
  inputStyle: CSSProperties;
  onAdd: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
      <input style={{ ...inputStyle, flex: 1 }} placeholder={t("dispute.ph.issuetitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
      <Button size="sm" type="button" disabled={disabled || !title.trim()} onClick={() => { onAdd(title.trim()); setTitle(""); }}>
        {t("dispute.addissue")}
      </Button>
    </div>
  );
}

function IssueRow({
  issue, projectId, disputeId, t, busy, inputStyle, onAddPosition, onDeleteIssue, onDeletePosition, onAddRef, onDeleteRef, onUpload,
}: {
  issue: DisputeIssue;
  projectId: string;
  disputeId: string;
  t: (k: string) => string;
  busy: boolean;
  inputStyle: CSSProperties;
  onAddPosition: (side: "claim" | "response", title: string, summary?: string) => void;
  onDeleteIssue: () => void;
  onDeletePosition: (id: string) => void;
  onAddRef: (positionId: string, body: { ref_type: string; entity_id?: string; document_id?: string; manual_title?: string; manual_date?: string; manual_note?: string }) => void;
  onDeleteRef: (positionId: string, refId: string) => void;
  onUpload: (positionId: string, file: File) => void;
}) {
  const claims = (issue.dispute_positions || []).filter((p) => p.side === "claim").sort((a, b) => a.sort_order - b.sort_order);
  const responses = (issue.dispute_positions || []).filter((p) => p.side === "response").sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div className="dispute-issue-row">
      <PositionColumn
        title={t("dispute.claims")}
        positions={claims}
        side="claim"
        projectId={projectId}
        disputeId={disputeId}
        issueId={issue.id}
        t={t}
        busy={busy}
        inputStyle={inputStyle}
        onAdd={(title, summary) => onAddPosition("claim", title, summary)}
        onDeletePosition={onDeletePosition}
        onAddRef={onAddRef}
        onDeleteRef={onDeleteRef}
        onUpload={onUpload}
      />
      <div className="dispute-issue-col dispute-issue-center">
        <span className="dispute-issue-arrow dispute-issue-arrow-west" aria-hidden="true" />
        <p style={{ fontFamily: "var(--font-brand)", fontSize: "var(--type-title-card)", color: "var(--color-text-primary)", margin: "0 0 10px" }}>{issue.title}</p>
        <Button size="sm" variant="destructive" type="button" onClick={onDeleteIssue}>{t("action.remove")}</Button>
        <span className="dispute-issue-arrow dispute-issue-arrow-east" aria-hidden="true" />
      </div>
      <PositionColumn
        title={t("dispute.responses")}
        positions={responses}
        side="response"
        projectId={projectId}
        disputeId={disputeId}
        issueId={issue.id}
        t={t}
        busy={busy}
        inputStyle={inputStyle}
        onAdd={(title, summary) => onAddPosition("response", title, summary)}
        onDeletePosition={onDeletePosition}
        onAddRef={onAddRef}
        onDeleteRef={onDeleteRef}
        onUpload={onUpload}
      />
    </div>
  );
}

function PositionColumn({
  title, positions, side, projectId, disputeId, issueId, t, busy, inputStyle, onAdd, onDeletePosition, onAddRef, onDeleteRef, onUpload,
}: {
  title: string;
  positions: DisputePosition[];
  side: "claim" | "response";
  projectId: string;
  disputeId: string;
  issueId: string;
  t: (k: string) => string;
  busy: boolean;
  inputStyle: CSSProperties;
  onAdd: (title: string, summary?: string) => void;
  onDeletePosition: (id: string) => void;
  onAddRef: (positionId: string, body: { ref_type: string; entity_id?: string; document_id?: string; manual_title?: string; manual_date?: string; manual_note?: string }) => void;
  onDeleteRef: (positionId: string, refId: string) => void;
  onUpload: (positionId: string, file: File) => void;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [expandedId, setExpandedId] = useState<string | "draft" | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    setExpandedId("draft");
    try {
      const result = await generateDisputePosition(projectId, disputeId, issueId, side);
      setNewTitle(result.title);
      setNewSummary(result.summary);
    } catch {
      /* toast lives on the page error strip via parent run() — keep local quiet */
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className={`dispute-issue-col${expandedId ? " is-expanded" : ""}`}>
      <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 8 }}>{title}</div>
      {positions.map((p) => {
        const open = expandedId === p.id;
        return (
          <div key={p.id} className={`dispute-position${open ? " is-open" : ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <button
                type="button"
                className="dispute-position-toggle"
                onClick={() => setExpandedId(open ? null : p.id)}
              >
                {p.title}
              </button>
              <Button size="sm" variant="destructive" type="button" onClick={() => onDeletePosition(p.id)}>{t("action.remove")}</Button>
            </div>
            {open && (
              <>
                {p.summary && <p style={{ fontSize: 11, color: "var(--color-text-secondary)", margin: "6px 0" }}>{p.summary}</p>}
                {(p.dispute_position_refs || []).map((ref) => (
                  <div key={ref.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: "var(--color-text-primary)", minWidth: 0 }}>
                      {ref.ref_type === "manual"
                        ? ref.manual_title
                        : ref.document_id
                          ? <DocumentLink projectId={projectId} docId={ref.document_id}>{t("entity.document")}</DocumentLink>
                          : t(`entity.${ref.ref_type === "document" ? "document" : ref.ref_type}`)}
                    </span>
                    <Button size="sm" variant="secondary" type="button" onClick={() => onDeleteRef(p.id, ref.id)}>{t("action.remove")}</Button>
                  </div>
                ))}
                <AttachForm
                  projectId={projectId}
                  t={t}
                  busy={busy}
                  inputStyle={inputStyle}
                  onSystem={(type, id) => onAddRef(p.id, { ref_type: type, entity_id: id })}
                  onManual={(manual_title, manual_date) => onAddRef(p.id, { ref_type: "manual", manual_title, manual_date })}
                  onUpload={(file) => onUpload(p.id, file)}
                />
              </>
            )}
          </div>
        );
      })}
      <div className={`dispute-position-draft${expandedId === "draft" ? " is-open" : ""}`}>
        <AiActionButton disabled={busy || generating} onClick={() => void handleGenerate()}>
          {generating ? t("state.generating") : (side === "claim" ? t("dispute.llm.claim") : t("dispute.llm.response"))}
        </AiActionButton>
        <input
          style={{ ...inputStyle, marginTop: 8 }}
          placeholder={t("dispute.ph.positiontitle")}
          value={newTitle}
          onFocus={() => setExpandedId("draft")}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        {expandedId === "draft" && (
          <textarea
            style={{ ...inputStyle, marginTop: 8, minHeight: 72 }}
            placeholder={t("dispute.ph.positionsummary")}
            value={newSummary}
            onChange={(e) => setNewSummary(e.target.value)}
          />
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <Button size="sm" type="button" disabled={busy || !newTitle.trim()} onClick={() => {
            onAdd(newTitle.trim(), newSummary.trim() || undefined);
            setNewTitle(""); setNewSummary(""); setExpandedId(null);
          }}>{t("action.add")}</Button>
          {expandedId === "draft" && (
            <Button size="sm" variant="secondary" type="button" onClick={() => setExpandedId(null)}>{t("dispute.collapse")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachForm({
  projectId, t, busy, inputStyle, onSystem, onManual, onUpload,
}: {
  projectId: string;
  t: (k: string) => string;
  busy: boolean;
  inputStyle: CSSProperties;
  onSystem: (type: "correspondence" | "rfi" | "change", id: string) => void;
  onManual: (title: string, date?: string) => void;
  onUpload: (file: File) => void;
}) {
  const [mode, setMode] = useState<"system" | "manual" | "file">("system");
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<LinkableDoc[] | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDate, setManualDate] = useState("");

  const loadDocs = async () => {
    if (docs) return;
    try {
      setDocs(await fetchLinkableDocuments(projectId));
    } catch {
      setDocs([]);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {(["system", "manual", "file"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); if (m === "system") void loadDocs(); }}
            style={{
              fontSize: 11, fontFamily: "var(--font-ui)", padding: "2px 8px", borderRadius: 0, cursor: "pointer",
              border: `0.5px solid ${mode === m ? "var(--color-accent)" : "var(--color-border-light)"}`,
              background: mode === m ? "var(--color-accent)" : "transparent",
              color: mode === m ? "var(--color-bg-primary)" : "var(--color-text-secondary)",
            }}
          >
            {t(`dispute.attach.${m}`)}
          </button>
        ))}
      </div>
      {mode === "system" && (
        <div>
          <input style={inputStyle} placeholder={t("chrono.ph.search")} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => void loadDocs()} />
          {docs && (
            <div style={{ maxHeight: 140, overflow: "auto", marginTop: 4, border: "0.5px solid var(--color-border-light)" }}>
              {docs.filter((d) => {
                const hay = `${d.ref_number} ${d.subject}`.toLowerCase();
                return !q || hay.includes(q.toLowerCase());
              }).slice(0, 12).map((d) => (
                <button
                  key={`${d.type}-${d.id}`}
                  type="button"
                  disabled={busy || (d.type !== "correspondence" && d.type !== "rfi")}
                  onClick={() => onSystem(d.type as "correspondence" | "rfi", d.id)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "var(--color-bg-primary)", border: "none", borderBottom: "0.5px solid var(--color-border-light)", padding: "6px 8px", cursor: "pointer" }}
                >
                  <span className="ref-number">{d.ref_number}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-primary)", marginInlineStart: 8 }}>{d.subject}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {mode === "manual" && (
        <div style={{ display: "flex", gap: 6 }}>
          <input style={{ ...inputStyle, flex: 1 }} placeholder={t("dispute.ph.manualtitle")} value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
          <input type="date" style={inputStyle} value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
          <Button size="sm" type="button" disabled={busy || !manualTitle.trim()} onClick={() => { onManual(manualTitle.trim(), manualDate || undefined); setManualTitle(""); }}>
            {t("action.add")}
          </Button>
        </div>
      )}
      {mode === "file" && (
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
      )}
    </div>
  );
}
