import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Chronology } from "../types/chronology";
import {
  addChronologyEvent,
  approveNarrative,
  createDisputeChronology,
  fetchChronology,
  fetchDisputeChronologySeed,
  forkDisputeChronology,
  inactivateChronologyEvent,
  updateChronology,
  updateChronologyEvent,
  type DisputeDossier,
} from "../services/api";
import { formatDate } from "../utils/format";
import { useLanguage } from "../context/LanguageContext";
import { useToastContext } from "../context/ToastContext";
import Button from "./Button";
import ConfirmModal from "./ConfirmModal";
import ChronologyDraftView from "./chronologies/ChronologyDraftView";
import HorizontalStrip from "./chronologies/HorizontalStrip";
import {
  buildEventPayload,
  chronologyEventsToPending,
  toSavedStripEvents,
} from "./chronologies/mappers";
import { usePendingEvents, type PendingEvent } from "./chronologies/usePendingEvents";

type Props = {
  projectId: string;
  dispute: DisputeDossier;
  onChanged: () => Promise<void>;
};

export default function DisputeChronologyPanel({ projectId, dispute, onChanged }: Props) {
  const { t, lang } = useLanguage();
  const { showToast } = useToastContext();
  const navigate = useNavigate();
  const pendingHook = usePendingEvents(projectId, showToast, {
    disputeId: dispute.id,
    chronologyId: dispute.chronology_id,
  });
  const {
    pendingEvents,
    setPendingEvents,
    removeFromTimeline,
    resetPendingEvents,
    loadLinkableDocs,
    prefillFromBridge,
    linkableDocs,
    loadingDocs,
  } = pendingHook;

  const [chrono, setChrono] = useState<Chronology | null>(null);
  const [loading, setLoading] = useState(!!dispute.chronology_id);
  const [mode, setMode] = useState<"view" | "create" | "edit">("view");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ message: string; label: string; run: () => void } | null>(null);
  const seededRef = useRef(false);
  const eventRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  const entityType = dispute.chronology_entity_type || chrono?.entity_type;
  const linked = !!(dispute.chronology_id && entityType && entityType !== "dispute");
  const ownedEmpty = !!(
    dispute.chronology_id &&
    entityType === "dispute" &&
    chrono &&
    chrono.events.filter((e) => e.is_active).length === 0
  );

  const loadChrono = useCallback(async () => {
    if (!dispute.chronology_id) {
      setChrono(null);
      return;
    }
    setLoading(true);
    try {
      setChrono(await fetchChronology(projectId, dispute.chronology_id));
    } catch {
      setChrono(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, dispute.chronology_id]);

  useEffect(() => {
    void loadChrono();
  }, [loadChrono]);

  useEffect(() => {
    if (mode !== "create") return;
    loadLinkableDocs();
  }, [mode, loadLinkableDocs]);

  useEffect(() => {
    if (mode !== "create" || seededRef.current || loadingDocs || linkableDocs.length === 0) return;
    seededRef.current = true;
    fetchDisputeChronologySeed(projectId, dispute.id)
      .then((res) => prefillFromBridge(res.ids))
      .catch(() => {});
  }, [mode, loadingDocs, linkableDocs.length, projectId, dispute.id, prefillFromBridge]);

  useEffect(() => {
    if (mode !== "view") return;
    if (!dispute.chronology_id || ownedEmpty) {
      seededRef.current = false;
      setTitle(`${dispute.dispute_number} — ${dispute.title}`);
      setMode("create");
    }
  }, [mode, dispute.chronology_id, dispute.dispute_number, dispute.title, ownedEmpty]);

  const exitDraft = () => {
    setMode("view");
    resetPendingEvents();
    seededRef.current = false;
  };

  const enterEdit = () => {
    if (!chrono) return;
    setTitle(chrono.title);
    setPendingEvents(chronologyEventsToPending(chrono.events));
    loadLinkableDocs();
    setMode("edit");
  };

  const handleRevise = () => {
    setConfirm({
      message: t("dispute.confirm.revisechrono"),
      label: t("dispute.chrono.revise"),
      run: async () => {
        setConfirm(null);
        setSaving(true);
        try {
          const next = await forkDisputeChronology(projectId, dispute.id);
          await onChanged();
          const id = next.chronology_id;
          if (id) {
            const fresh = await fetchChronology(projectId, id);
            setChrono(fresh);
            setTitle(fresh.title);
            setPendingEvents(chronologyEventsToPending(fresh.events));
            loadLinkableDocs();
            setMode("edit");
          }
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : t("common.savefailed"), "error");
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const handleSaveCreate = async () => {
    if (!title.trim()) {
      showToast(t("chrono.entertitle"), "warning");
      return;
    }
    setSaving(true);
    try {
      let chronoId = ownedEmpty ? dispute.chronology_id : null;
      if (!chronoId) {
        const next = await createDisputeChronology(projectId, dispute.id);
        chronoId = next.chronology_id;
      }
      if (chronoId && title.trim()) {
        await updateChronology(projectId, chronoId, title.trim());
      }
      for (const pe of pendingEvents) {
        await addChronologyEvent(projectId, chronoId as string, buildEventPayload(pe));
      }
      exitDraft();
      await onChanged();
      await loadChrono();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("common.savefailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!chrono || !dispute.chronology_id) return;
    setSaving(true);
    try {
      if (title.trim() && title.trim() !== chrono.title) {
        await updateChronology(projectId, dispute.chronology_id, title.trim());
      }
      for (const pe of pendingEvents.filter((p) => p._isExisting)) {
        const metaUpdate: {
          event_type?: string;
          is_key_event?: boolean;
          event_date?: string;
          subject?: string;
        } = {};
        if (pe.editEventType && pe.editEventType !== pe._originalEventType) {
          metaUpdate.event_type = pe.editEventType;
        }
        if (pe.editIsKey !== undefined && pe.editIsKey !== pe._originalIsKey) {
          metaUpdate.is_key_event = pe.editIsKey;
        }
        if (pe.doc.type === null) {
          if (pe.editDate && pe.editDate !== pe._originalDate) metaUpdate.event_date = pe.editDate;
          if (pe.editSubject !== undefined && pe.editSubject !== (pe._originalSubject ?? "")) {
            metaUpdate.subject = pe.editSubject;
          }
        }
        if (Object.keys(metaUpdate).length > 0) {
          await updateChronologyEvent(projectId, dispute.chronology_id, pe.doc.id, metaUpdate);
        }
        const narrativeChanged =
          pe.approved && pe.approvedText.trim() !== (pe._originalNarrative ?? "").trim();
        if (narrativeChanged) {
          await approveNarrative(projectId, dispute.chronology_id, pe.doc.id, pe.approvedText.trim());
        }
      }
      const existingIds = new Set(chrono.events.map((ev) => ev.id));
      for (const pe of pendingEvents.filter((p) => !p._isExisting && !existingIds.has(p.doc.id))) {
        await addChronologyEvent(projectId, dispute.chronology_id, buildEventPayload(pe));
      }
      exitDraft();
      await onChanged();
      await loadChrono();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : t("common.savefailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePending = (pe: PendingEvent) => {
    if (pe._isExisting && dispute.chronology_id) {
      setConfirm({
        message: t("chrono.removeevent"),
        label: t("action.remove"),
        run: () => {
          setConfirm(null);
          inactivateChronologyEvent(
            projectId,
            dispute.chronology_id as string,
            pe.doc.id,
            "Removed via dispute chronology editor",
          )
            .then(() => removeFromTimeline(pe.doc.id))
            .catch((err: unknown) => {
              showToast(err instanceof Error ? err.message : t("chrono.removefailed"), "error");
            });
        },
      });
    } else {
      removeFromTimeline(pe.doc.id);
    }
  };

  const scrollToEvent = (id: string) => {
    const el = eventRefs.current[id];
    if (el && timelineScrollRef.current) {
      timelineScrollRef.current.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
    }
  };

  const events = [...(chrono?.events || [])].filter((e) => e.is_active);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{
          fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em",
          color: "var(--color-text-secondary)",
        }}>
          {t("module.chronologies")}
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => navigate(`/projects/${projectId}/workspace?module=chronologies`)}
        >
          {t("dispute.openchrono")}
        </Button>
      </div>

      {entityType === "dispute" && (
        <p className="dispute-chrono-note">{t("chrono.notedispute")}</p>
      )}
      {linked && (
        <p className="dispute-chrono-note">{t("chrono.linkedsource")}</p>
      )}

      {loading && mode === "view" && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{t("state.loading")}</p>
      )}

      {(mode === "create" || mode === "edit") && (
        <div className="dispute-chrono-embed">
          <ChronologyDraftView
            mode={mode === "create" ? "create" : "edit"}
            title={title}
            onTitleChange={setTitle}
            saving={saving}
            onSave={mode === "create" ? handleSaveCreate : handleSaveEdit}
            onCancel={exitDraft}
            pending={pendingHook}
            scrollToEvent={scrollToEvent}
            timelineScrollRef={timelineScrollRef}
            eventRefs={eventRefs}
            onRemoveEvent={handleRemovePending}
          />
        </div>
      )}

      {mode === "view" && !loading && chrono && events.length > 0 && (
        <div style={{ background: "var(--color-bg-secondary)", padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
            <div>
              <p style={{
                fontFamily: "var(--font-brand)", fontSize: "var(--type-title-card)",
                color: "var(--color-text-primary)", margin: 0,
              }}>
                {chrono.title}
              </p>
            </div>
            {linked ? (
              <Button size="sm" type="button" loading={saving} onClick={handleRevise}>
                {t("dispute.chrono.revise")}
              </Button>
            ) : (
              <Button size="sm" type="button" onClick={enterEdit}>
                {t("chrono.editchronology")}
              </Button>
            )}
          </div>
          <HorizontalStrip events={toSavedStripEvents(events)} onClickEvent={scrollToEvent} />
          <div ref={timelineScrollRef} style={{ marginTop: 16 }}>
            {events.map((ev) => (
              <div
                key={ev.id}
                ref={(node) => { eventRefs.current[ev.id] = node; }}
                style={{ marginBottom: 14 }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span className="data-figure" style={{ color: "var(--color-text-secondary)" }}>{formatDate(ev.event_date, lang)}</span>
                  <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
                    {t(`chrono.evt.${ev.event_type}`) === `chrono.evt.${ev.event_type}` ? ev.event_type : t(`chrono.evt.${ev.event_type}`)}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "var(--color-text-primary)", margin: "4px 0 0" }}>
                  {ev.subject || ev.approved_narrative || ev.auto_narrative || "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        message={confirm?.message || ""}
        confirmLabel={confirm?.label || t("action.remove")}
        cancelLabel={t("action.cancel")}
        onConfirm={() => confirm?.run()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
