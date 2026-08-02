import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import AiActionButton from "../components/AiActionButton";
import RichTextEditor from "../components/editor/RichTextEditor";
import { DOCUMENT_TYPE_LABELS } from "../constants/documentTypes";
import { useLanguage } from "../context/LanguageContext";
import { api, ApiError, type LinkableDoc } from "../services/api";
import {
  aiDraft,
  approveAuthoringDraft,
  createAuthoringDraft,
  fetchAuthoringBundleUrl,
  fetchAuthoringDocxUrl,
  fetchAuthoringDraft,
  fetchAuthoringLinkable,
  generateAuthoringDocx,
  fetchDocumentPageCount,
  getDocumentSignedUrl,
  patchAuthoringDraft,
  uploadAuthoringReferenceFile,
  type DocumentDraft,
} from "../services/authoringApi";
import { syncReferencesBlock } from "../utils/syncReferencesBlock";

type PageRange = { from: number; to: number | null };

type RefItem = {
  ref_type: string;
  rfi_id?: string;
  ref_corr_id?: string;
  document_id?: string;
  external_doc_number?: string;
  external_doc_title?: string;
  external_doc_date?: string;
  note?: string;
  /** Optional citation ranges on the primary PDF; absent = whole document. */
  page_ranges?: PageRange[];
  /** Known pdf_document.page_count (linkable seed or /page-count endpoint). */
  page_count?: number | null;
  _display?: string;
  _ref_number?: string;
  _subject?: string;
  _date?: string;
  _file_name?: string;
};

function knownPageCount(ref: RefItem, linkable: LinkableDoc[]): number | null {
  if (ref.page_count != null && ref.page_count > 0) return ref.page_count;
  if (!ref.document_id) return null;
  const doc = linkable.find((d) => d.id === ref.document_id);
  if (doc?.page_count != null && doc.page_count > 0) return doc.page_count;
  return null;
}

function pageRangeRowBad(pr: PageRange, pc: number): boolean {
  if (pr.from < 1 || pr.from > pc) return true;
  if (pr.to != null && (pr.to < pr.from || pr.to > pc)) return true;
  return false;
}

/** True when any ref has a range exceeding its known page_count (no clamp). */
function hasInvalidPageRanges(
  refs: RefItem[],
  linkable: LinkableDoc[]
): boolean {
  for (const r of refs) {
    const pc = knownPageCount(r, linkable);
    if (pc == null || !r.page_ranges?.length) continue;
    if (r.page_ranges.some((pr) => pageRangeRowBad(pr, pc))) return true;
  }
  return false;
}

/** Session-local chat turns — feedback only; draft body lives in the letter (no LLM content store). */
type AiChatTurn = {
  id: string;
  at: number;
  userText: string;
  outcome: "ok" | "blocked" | "conflict" | "error";
  assistantText: string;
};

type ChainFields = {
  parent_id?: string;
  parent_number?: string;
  relation?: string;
};

function chainFromFieldValues(fv: Record<string, unknown> | undefined | null): ChainFields {
  if (!fv) return {};
  const chain: ChainFields = {};
  if (typeof fv.parent_id === "string" && fv.parent_id) chain.parent_id = fv.parent_id;
  if (typeof fv.parent_number === "string" && fv.parent_number) {
    chain.parent_number = fv.parent_number;
  }
  if (
    fv.relation === "response" ||
    fv.relation === "followup" ||
    fv.relation === "revision"
  ) {
    chain.relation = fv.relation;
  }
  return chain;
}

function payloadKey(
  subject: string,
  bodyHtml: string,
  projectName: string,
  attentionTo: string,
  references: RefItem[],
  discipline: string,
  chain: ChainFields,
  includeReferenceCopies: boolean
): string {
  return JSON.stringify({
    subject,
    body_html: bodyHtml,
    field_values: {
      project: projectName,
      attention_to: attentionTo,
      references,
      discipline,
      include_reference_copies: includeReferenceCopies,
      ...chain,
    },
  });
}

const RFI_DISCIPLINES = [
  "",
  "Civil",
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Other",
];

function enrichRefMeta(ref: RefItem, linkable: LinkableDoc[]): RefItem {
  const id = ref.rfi_id || ref.ref_corr_id || ref.document_id;
  if (!id) return ref;
  const doc = linkable.find((d) => d.id === id);
  if (!doc) {
    // Last resort: parse "_display" ("NUM — Subject")
    if (!ref._ref_number && ref._display?.includes(" — ")) {
      const [num, ...rest] = ref._display.split(" — ");
      return {
        ...ref,
        _ref_number: num.trim(),
        _subject: ref._subject || rest.join(" — ").trim() || undefined,
      };
    }
    return ref;
  }
  const _ref_number = ref._ref_number || doc.ref_number || undefined;
  const _subject = ref._subject || doc.subject || undefined;
  const _date = ref._date || doc.date || undefined;
  const page_count =
    ref.page_count != null && ref.page_count > 0
      ? ref.page_count
      : doc.page_count != null && doc.page_count > 0
        ? doc.page_count
        : ref.page_count;
  const _display =
    ref._display ||
    (doc.type === "contract_document"
      ? doc.subject || undefined
      : doc.ref_number
        ? `${doc.ref_number} — ${doc.subject || ""}`.trim()
        : doc.subject || undefined);
  if (
    _ref_number === ref._ref_number &&
    _subject === ref._subject &&
    _date === ref._date &&
    _display === ref._display &&
    page_count === ref.page_count
  ) {
    return ref;
  }
  return { ...ref, _ref_number, _subject, _date, _display, page_count };
}

function pageSuffix(ranges?: PageRange[]): string {
  if (!ranges || ranges.length === 0) return "";
  const parts = ranges.map((r) =>
    r.to === null
      ? `${r.from} to end`
      : r.from === r.to
        ? `${r.from}`
        : `${r.from}-${r.to}`
  );
  const label =
    parts.length === 1 &&
    !parts[0].includes("-") &&
    !parts[0].includes("to")
      ? `page ${parts[0]}`
      : `pages ${parts.join(", ")}`;
  return `, ${label}`;
}

function formatRefLine(ref: RefItem, linkable: LinkableDoc[] = []): string {
  const enriched = enrichRefMeta(ref, linkable);
  const num = enriched._ref_number || enriched.external_doc_number || "—";
  const subject = enriched._subject || enriched.external_doc_title || "—";
  const date = enriched._date || enriched.external_doc_date || "—";
  const pages = pageSuffix(enriched.page_ranges);
  if (enriched.rfi_id || enriched.ref_type === "rfi") {
    return `Request for Information (RFI) Ref# ${num}, Subject ${subject}, Date ${date}${pages}`;
  }
  if (enriched.ref_corr_id || enriched.ref_type === "correspondence") {
    return `Correspondence (Letter) Ref# ${num}, Subject ${subject}, Date ${date}${pages}`;
  }
  if (enriched.ref_type === "contract_document") {
    const label = enriched._display || enriched._subject || "—";
    return `Contract Document — ${label}, Date ${date}${pages}`;
  }
  if (enriched.ref_type === "amendment") {
    return `Amendment — ${num} ${subject}, Date ${date}${pages}`;
  }
  const typeLabel =
    DOCUMENT_TYPE_LABELS[enriched.ref_type]?.en ||
    enriched.ref_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${typeLabel} Ref# ${num}, Subject ${subject}, Date ${date}${pages}`;
}

function linkableTypeLabel(doc: LinkableDoc, lang: string): string {
  if (doc.type === "contract_document") {
    return lang === "tr" ? "Sözleşme belgesi" : "Contract Document";
  }
  if (doc.type === "amendment") {
    return lang === "tr" ? "Zeyilname" : "Amendment";
  }
  if (doc.type === "rfi") return "RFI";
  return lang === "tr" ? "Yazışma" : "Correspondence";
}

/** Full parent→children tree for the seed's chain (same type), minus already-added. */
function chainRelatedDocs(
  seed: LinkableDoc,
  linkable: LinkableDoc[],
  current: RefItem[]
): LinkableDoc[] {
  const taken = new Set<string>();
  for (const r of current) {
    if (r.rfi_id) taken.add(r.rfi_id);
    if (r.ref_corr_id) taken.add(r.ref_corr_id);
    if (r.document_id) taken.add(r.document_id);
  }

  const sameType = linkable.filter((d) => d.type === seed.type);
  const byId = new Map(sameType.map((d) => [d.id, d]));

  // Walk to root
  let root = seed;
  const guard = new Set<string>([seed.id]);
  while (root.parent_id) {
    const parent = byId.get(root.parent_id);
    if (!parent || guard.has(parent.id)) break;
    guard.add(parent.id);
    root = parent;
  }

  const childrenOf = new Map<string, LinkableDoc[]>();
  for (const d of sameType) {
    if (!d.parent_id) continue;
    const arr = childrenOf.get(d.parent_id) ?? [];
    arr.push(d);
    childrenOf.set(d.parent_id, arr);
  }

  const out: LinkableDoc[] = [];
  const queue = [root];
  const visited = new Set<string>();
  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    if (!taken.has(node.id)) out.push(node);
    for (const child of childrenOf.get(node.id) ?? []) {
      queue.push(child);
    }
  }
  return out;
}

function ancestorDepth(
  ancestorId: string,
  node: LinkableDoc,
  byId: Map<string, LinkableDoc>
): number | null {
  let depth = 0;
  let cur: LinkableDoc | undefined = node;
  while (cur) {
    if (cur.id === ancestorId) return depth;
    if (!cur.parent_id) return null;
    depth += 1;
    if (depth > 32) return null;
    cur = byId.get(cur.parent_id);
  }
  return null;
}

function chainRelationLabel(
  anchor: LinkableDoc,
  related: LinkableDoc,
  linkable: LinkableDoc[],
  lang: string
): string {
  const byId = new Map(
    linkable.filter((d) => d.type === anchor.type).map((d) => [d.id, d])
  );
  const down = ancestorDepth(anchor.id, related, byId);
  if (down === 1) {
    return lang === "tr" ? "yanıt / devam" : "response / follow-up";
  }
  if (down !== null && down > 1) {
    return lang === "tr" ? `yanıt (${down}. seviye)` : `response (level ${down})`;
  }
  const up = ancestorDepth(related.id, anchor, byId);
  if (up === 1) {
    return lang === "tr" ? "üst belge" : "parent";
  }
  if (up !== null && up > 1) {
    return lang === "tr" ? `üst belge (${up}. seviye)` : `ancestor (level ${up})`;
  }
  return lang === "tr" ? "zincir" : "chain";
}

export default function AuthoringDraftPage() {
  const { projectId, draftId: routeDraftId } = useParams<{
    projectId: string;
    draftId?: string;
  }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { lang } = useLanguage();

  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [attentionTo, setAttentionTo] = useState("");
  const [projectName, setProjectName] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [references, setReferences] = useState<RefItem[]>([]);
  /** Opt-in: append reference PDF copies to e-bundle (default true = legacy). */
  const [includeReferenceCopies, setIncludeReferenceCopies] = useState(true);
  const [version, setVersion] = useState(1);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "conflict">("idle");
  const [error, setError] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [refSearch, setRefSearch] = useState("");
  const [showRefDropdown, setShowRefDropdown] = useState(false);
  const [showManualRef, setShowManualRef] = useState(false);
  const [manualRef, setManualRef] = useState({
    type: "",
    number: "",
    title: "",
    date: "",
    note: "",
  });
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [linkable, setLinkable] = useState<LinkableDoc[]>([]);
  /** Per document_id: loading|/page-count in flight, unavailable = null from endpoint. */
  const [pageCountStatus, setPageCountStatus] = useState<
    Record<string, "loading" | "unavailable">
  >({});
  const pageCountInflightRef = useRef<Set<string>>(new Set());
  const [chainPrompt, setChainPrompt] = useState<{
    anchor: LinkableDoc;
    related: LinkableDoc[];
  } | null>(null);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiTurns, setAiTurns] = useState<AiChatTurn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  const versionRef = useRef(version);
  versionRef.current = version;
  const draftIdRef = useRef<string | null>(routeDraftId ?? null);
  const draftStatusRef = useRef<string | null>(null);
  const skipNextAutosave = useRef(true);
  const lastSavedPayloadRef = useRef<string>("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const refPickerRef = useRef<HTMLDivElement | null>(null);

  const tpl = draft?.document_templates;

  // Bootstrap: create or load
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        if (routeDraftId) {
          const d = await fetchAuthoringDraft(projectId, routeDraftId);
          if (cancelled) return;
          applyDraft(d);
          draftIdRef.current = d.id;
        } else {
          const docType = (search.get("doc_type") === "rfi" ? "rfi" : "letter") as
            | "letter"
            | "rfi";
          const parentId = search.get("parent_id");
          const parentNumber = search.get("parent_number") ?? "";
          const relationRaw = search.get("relation");
          const relation =
            relationRaw === "response" ||
            relationRaw === "followup" ||
            relationRaw === "revision"
              ? relationRaw
              : null;

          const field_values: Record<string, unknown> = {};
          let subjectPrefill: string | undefined;
          let disciplinePrefill: string | undefined;

          if (parentId && relation) {
            field_values.parent_id = parentId;
            field_values.parent_number = parentNumber;
            field_values.relation = relation;
            try {
              if (docType === "rfi") {
                const parent = await api.get<{
                  subject: string;
                  discipline: string | null;
                }>(`/projects/${projectId}/rfis/${parentId}`);
                const prefix =
                  relation === "revision" ? "Revision 1 - " : "Response to: ";
                subjectPrefill = prefix + (parent.subject ?? parentNumber);
                if (parent.discipline) {
                  disciplinePrefill = parent.discipline;
                  field_values.discipline = parent.discipline;
                }
              } else {
                const parent = await api.get<{ subject: string }>(
                  `/projects/${projectId}/correspondences/${parentId}`
                );
                const prefix = relation === "followup" ? "Fw: " : "Re: ";
                subjectPrefill = prefix + (parent.subject ?? parentNumber);
              }
            } catch {
              subjectPrefill =
                docType === "rfi"
                  ? relation === "revision"
                    ? `Revision 1 - ${parentNumber}`
                    : `Response to: ${parentNumber}`
                  : relation === "followup"
                    ? `Fw: ${parentNumber}`
                    : `Re: ${parentNumber}`;
            }
          }

          const d = await createAuthoringDraft(projectId, {
            doc_type: docType,
            subject: subjectPrefill,
            field_values: Object.keys(field_values).length ? field_values : undefined,
          });
          if (cancelled) return;
          applyDraft(d);
          if (disciplinePrefill) setDiscipline(disciplinePrefill);
          draftIdRef.current = d.id;
          navigate(`/projects/${projectId}/workspace/authoring/${d.id}`, { replace: true });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : "Failed to open draft");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, routeDraftId]);

  function applyDraft(d: DocumentDraft) {
    skipNextAutosave.current = true;
    draftStatusRef.current = d.status;
    setDraft(d);
    setSubject(d.subject || "");
    setBodyHtml(d.body_html || "");
    setAttentionTo(String(d.field_values?.attention_to || ""));
    setProjectName(String(d.field_values?.project || ""));
    setDiscipline(String(d.field_values?.discipline || ""));
    const refs = (d.field_values?.references as RefItem[]) || [];
    setReferences(refs);
    const copies =
      d.field_values?.include_reference_copies === false ? false : true;
    setIncludeReferenceCopies(copies);
    setVersion(d.version);
    lastSavedPayloadRef.current = payloadKey(
      d.subject || "",
      d.body_html || "",
      String(d.field_values?.project || ""),
      String(d.field_values?.attention_to || ""),
      refs,
      String(d.field_values?.discipline || ""),
      chainFromFieldValues(d.field_values),
      copies
    );
  }

  // Debounced autosave — draft object NOT in deps (avoids save→setDraft→save loop).
  useEffect(() => {
    if (!projectId || !draftIdRef.current) return;
    if (draftStatusRef.current !== "drafting") return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    // Invalid page ranges: keep local values for user fix; do not POST (server would 400).
    if (hasInvalidPageRanges(references, linkable)) {
      setSaveState("idle");
      return;
    }
    const chain = chainFromFieldValues(draft?.field_values);
    const nextKey = payloadKey(
      subject,
      bodyHtml,
      projectName,
      attentionTo,
      references,
      discipline,
      chain,
      includeReferenceCopies
    );
    if (nextKey === lastSavedPayloadRef.current) return;

    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const updated = await patchAuthoringDraft(projectId, draftIdRef.current!, {
          version: versionRef.current,
          subject,
          body_html: bodyHtml,
          field_values: {
            project: projectName,
            attention_to: attentionTo,
            references,
            discipline,
            include_reference_copies: includeReferenceCopies,
            ...chain,
          },
        });
        setVersion(updated.version);
        draftStatusRef.current = updated.status;
        setDraft((prev) => (prev ? { ...prev, ...updated } : updated));
        lastSavedPayloadRef.current = nextKey;
        setSaveState("saved");
        setError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setSaveState("conflict");
          setError(
            lang === "tr"
              ? "Çakışma: başka biri bu taslağı güncelledi. Sayfayı yenileyin."
              : "Conflict: another editor updated this draft. Reload the page."
          );
        } else {
          setSaveState("idle");
          setError(e instanceof ApiError ? e.message : "Autosave failed");
        }
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [subject, bodyHtml, attentionTo, projectName, references, discipline, includeReferenceCopies, draft?.field_values, projectId, lang, linkable]);

  useEffect(() => {
    if (!projectId) return;
    fetchAuthoringLinkable(projectId)
      .then(setLinkable)
      .catch(() => setLinkable([]));
  }, [projectId]);

  // Fill missing Ref#/Subject/Date/page_count from linkable (first guess; endpoint is authority).
  useEffect(() => {
    if (!linkable.length) return;
    setReferences((prev) => {
      const next = prev.map((r) => enrichRefMeta(r, linkable));
      return next.some((r, i) => r !== prev[i]) ? next : prev;
    });
  }, [linkable]);

  // Resolve page_count via /page-count when linkable seed is null (docx / unparsed).
  useEffect(() => {
    if (!projectId || draftStatusRef.current !== "drafting") return;
    const need: string[] = [];
    for (const r of references) {
      if (!r.document_id) continue;
      if (knownPageCount(r, linkable) != null) continue;
      if (pageCountInflightRef.current.has(r.document_id)) continue;
      need.push(r.document_id);
    }
    const unique = [...new Set(need)];
    if (unique.length === 0) return;

    for (const docId of unique) {
      pageCountInflightRef.current.add(docId);
      setPageCountStatus((prev) =>
        prev[docId] ? prev : { ...prev, [docId]: "loading" }
      );
      fetchDocumentPageCount(projectId, docId)
        .then((res) => {
          const n = res.page_count;
          if (n != null && n > 0) {
            setReferences((prev) =>
              prev.map((r) =>
                r.document_id === docId ? { ...r, page_count: n } : r
              )
            );
            setLinkable((prev) =>
              prev.map((d) => (d.id === docId ? { ...d, page_count: n } : d))
            );
            setPageCountStatus((prev) => {
              const { [docId]: _drop, ...rest } = prev;
              return rest;
            });
          } else {
            setPageCountStatus((prev) => ({ ...prev, [docId]: "unavailable" }));
            setReferences((prev) =>
              prev.map((r) => {
                if (r.document_id !== docId || !r.page_ranges?.length) return r;
                const { page_ranges: _drop, ...rest } = r;
                return rest;
              })
            );
          }
        })
        .catch(() => {
          setPageCountStatus((prev) => ({ ...prev, [docId]: "unavailable" }));
        });
    }
  }, [references, linkable, projectId]);

  useEffect(() => {
    if (!showRefDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (refPickerRef.current && !refPickerRef.current.contains(e.target as Node)) {
        setShowRefDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showRefDropdown]);

  // Keep managed References block in letter body in sync with picker list.
  useEffect(() => {
    if (draftStatusRef.current !== "drafting") return;
    const lines = references.map((r) => formatRefLine(r, linkable));
    setBodyHtml((prev) => {
      const next = syncReferencesBlock(prev, lines);
      return next === prev ? prev : next;
    });
  }, [references, linkable]);

  const filteredLinkable = linkable.filter((d) => {
    const q = refSearch.toLowerCase();
    return (
      !references.some(
        (r) =>
          (d.type === "rfi" && r.rfi_id === d.id) ||
          (d.type === "correspondence" && r.ref_corr_id === d.id) ||
          ((d.type === "contract_document" || d.type === "amendment") &&
            r.document_id === d.id)
      ) &&
      ((d.ref_number || "").toLowerCase().includes(q) ||
        (d.subject || "").toLowerCase().includes(q) ||
        linkableTypeLabel(d, lang).toLowerCase().includes(q))
    );
  }).slice(0, 12);

  const addRef = useCallback(
    (doc: LinkableDoc, opts?: { fromChain?: boolean }) => {
      const already = references.some(
        (r) =>
          (doc.type === "rfi" && r.rfi_id === doc.id) ||
          (doc.type === "correspondence" && r.ref_corr_id === doc.id) ||
          ((doc.type === "contract_document" || doc.type === "amendment") &&
            r.document_id === doc.id)
      );
      if (already) {
        if (opts?.fromChain) {
          setChainPrompt((prompt) => {
            if (!prompt) return null;
            const left = prompt.related.filter((d) => d.id !== doc.id);
            return left.length ? { ...prompt, related: left } : null;
          });
        }
        return;
      }

      const item: RefItem = {
        ref_type: doc.type,
        _display:
          doc.type === "contract_document"
            ? doc.subject || doc.id
            : `${doc.ref_number || ""} — ${doc.subject || ""}`
                .replace(/^\s*—\s*|\s*—\s*$/g, "")
                .trim() ||
              doc.ref_number ||
              doc.subject ||
              doc.id,
        _ref_number: doc.ref_number || undefined,
        _subject: doc.subject || undefined,
        _date: doc.date || undefined,
        page_count:
          doc.page_count != null && doc.page_count > 0 ? doc.page_count : null,
      };
      if (doc.type === "rfi") item.rfi_id = doc.id;
      else if (doc.type === "correspondence") item.ref_corr_id = doc.id;
      else item.document_id = doc.id;

      const next = [...references, item];
      setReferences(next);

      // Recompute full remaining chain (incl. deeper responses) after every add.
      // Contract/amendment rows have no parent_id — related stays empty.
      setChainPrompt((prompt) => {
        if (doc.type === "contract_document" || doc.type === "amendment") {
          return opts?.fromChain ? prompt : null;
        }
        const seed = opts?.fromChain ? (prompt?.anchor ?? doc) : doc;
        const related = chainRelatedDocs(seed, linkable, next);
        return related.length ? { anchor: seed, related } : null;
      });

      setRefSearch("");
      setShowRefDropdown(false);
    },
    [linkable, references]
  );

  function setRefPageRanges(index: number, ranges: PageRange[] | undefined) {
    setReferences((prev) =>
      prev.map((r, j) => {
        if (j !== index) return r;
        if (!r.document_id) {
          const { page_ranges: _drop, ...rest } = r;
          return rest;
        }
        if (!ranges || ranges.length === 0) {
          const { page_ranges: _drop, ...rest } = r;
          return rest;
        }
        return { ...r, page_ranges: ranges };
      })
    );
  }

  function addPageRangeRow(index: number) {
    setReferences((prev) =>
      prev.map((r, j) => {
        if (j !== index || !r.document_id) return r;
        if (knownPageCount(r, linkable) == null) return r;
        const next = [...(r.page_ranges || []), { from: 1, to: null as number | null }];
        return { ...r, page_ranges: next };
      })
    );
  }

  function updatePageRangeRow(
    refIndex: number,
    rangeIndex: number,
    patch: Partial<PageRange>
  ) {
    setReferences((prev) =>
      prev.map((r, j) => {
        if (j !== refIndex || !r.page_ranges) return r;
        const next = r.page_ranges.map((pr, k) =>
          k === rangeIndex ? { ...pr, ...patch } : pr
        );
        return { ...r, page_ranges: next };
      })
    );
  }

  function removePageRangeRow(refIndex: number, rangeIndex: number) {
    setReferences((prev) =>
      prev.map((r, j) => {
        if (j !== refIndex || !r.page_ranges) return r;
        const next = r.page_ranges.filter((_, k) => k !== rangeIndex);
        if (next.length === 0) {
          const { page_ranges: _drop, ...rest } = r;
          return rest;
        }
        return { ...r, page_ranges: next };
      })
    );
  }

  async function addManualRef() {
    if (!projectId || !draftIdRef.current) return;
    if (!manualRef.number.trim() || !manualRef.type || !manualFile) return;
    setBusy(true);
    try {
      const uploaded = await uploadAuthoringReferenceFile(
        projectId,
        draftIdRef.current,
        manualFile
      );
      const item: RefItem = {
        ref_type: manualRef.type,
        document_id: uploaded.doc_id,
        external_doc_number: manualRef.number.trim(),
        external_doc_title: manualRef.title.trim() || undefined,
        external_doc_date: manualRef.date || undefined,
        note: manualRef.note.trim() || undefined,
        _display: manualRef.title.trim()
          ? `${manualRef.number.trim()} — ${manualRef.title.trim()}`
          : manualRef.number.trim(),
        _ref_number: manualRef.number.trim(),
        _subject: manualRef.title.trim() || undefined,
        _date: manualRef.date || undefined,
        _file_name: uploaded.original_filename,
      };
      setReferences((prev) => [...prev, item]);
      setManualRef({ type: "", number: "", title: "", date: "", note: "" });
      setManualFile(null);
      setShowManualRef(false);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "File upload failed");
    } finally {
      setBusy(false);
    }
  }

  const canAddManual =
    manualRef.number.trim() !== "" &&
    manualRef.type !== "" &&
    manualFile !== null;

  function appendAiTurn(
    outcome: AiChatTurn["outcome"],
    assistantText: string
  ) {
    const raw = aiInstructions.trim();
    const userText = raw
      ? raw
      : lang === "tr"
        ? "(talimat yok)"
        : "(no instructions)";
    const turn: AiChatTurn = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      userText,
      outcome,
      assistantText,
    };
    setAiTurns((prev) => [...prev, turn].slice(-24));
    setActiveTurnId(turn.id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`ai-turn-${turn.id}`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function jumpToTurn(id: string) {
    setActiveTurnId(id);
    document.getElementById(`ai-turn-${id}`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }

  // Reference preview: open the reference's underlying document in a new tab.
  // Only meaningful when the reference has a physical file (document_id).
  async function handlePreviewReference(ref: RefItem) {
    const docId = ref.document_id;
    if (!projectId || !docId) return;
    try {
      const { signed_url } = await getDocumentSignedUrl(projectId, docId);
      // rel=noopener equivalent: third arg strips window.opener (reverse-tabnabbing).
      window.open(signed_url, "_blank", "noopener,noreferrer");
    } catch {
      // swallow — button only shown when document_id present; transient failures are non-fatal
    }
  }

  async function handleGenerate() {
    if (!projectId || !draftIdRef.current) return;
    setBusy(true);
    try {
      const res = await generateAuthoringDocx(
        projectId,
        draftIdRef.current,
        includeReferenceCopies
      );
      setDraft((prev) => (prev ? { ...prev, ...res.draft } : res.draft));
      if (res.draft.version) setVersion(res.draft.version);
      if (res.draft.status) draftStatusRef.current = res.draft.status;
      const url = await fetchAuthoringDocxUrl(projectId, draftIdRef.current);
      window.open(url.signed_url, "_blank");
      if (res.bundle_available) {
        try {
          const bundle = await fetchAuthoringBundleUrl(
            projectId,
            draftIdRef.current
          );
          window.open(bundle.signed_url, "_blank");
        } catch {
          /* bundle optional beside letter.docx */
        }
      }
      if (!res.pdf_preview_available) {
        setError(
          lang === "tr"
            ? res.bundle_available
              ? "PDF önizleme yok — DOCX ve referans e-bundle indirildi."
              : "PDF önizleme yok — DOCX indirildi."
            : res.bundle_available
              ? "PDF preview unavailable — DOCX and reference bundle downloaded."
              : "PDF preview unavailable — DOCX downloaded."
        );
      } else {
        setError(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAiDraft() {
    if (!projectId || !draftIdRef.current) return;
    setBusy(true);
    try {
      const language = lang === "tr" ? "tr" : "en";
      const res = await aiDraft(projectId, draftIdRef.current, {
        user_instructions: aiInstructions.trim() || undefined,
        language,
        version: versionRef.current,
      });
      skipNextAutosave.current = true;
      const syncedBody = syncReferencesBlock(
        res.body_html,
        references.map((r) => formatRefLine(r, linkable))
      );
      setBodyHtml(syncedBody);
      setVersion(res.version);
      setDraft((prev) =>
        prev ? { ...prev, body_html: syncedBody, version: res.version } : prev
      );
      lastSavedPayloadRef.current = payloadKey(
        subject,
        syncedBody,
        projectName,
        attentionTo,
        references,
        discipline,
        chainFromFieldValues(draft?.field_values),
        includeReferenceCopies
      );
      setError(null);
      const hints: string[] = [];
      if (res.review_required) {
        hints.push(lang === "tr" ? "İnceleme gerekli" : "Review required");
      }
      if (res.objectivity_flag) {
        hints.push(lang === "tr" ? "Nesnellik uyarısı" : "Objectivity flag");
      }
      if (res.warnings?.length) {
        hints.push(...res.warnings);
      }
      const okMsg = lang === "tr" ? "Gövde güncellendi." : "Body updated.";
      appendAiTurn("ok", hints.length ? `${okMsg} ${hints.join(" · ")}` : okMsg);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const msg = typeof e.message === "string" ? e.message : String(e.message);
        setError(msg);
        appendAiTurn("blocked", msg);
      } else if (e instanceof ApiError && e.status === 409) {
        setSaveState("conflict");
        const msg =
          lang === "tr"
            ? "Taslak değişti, yenile"
            : "Draft changed — please reload";
        setError(msg);
        appendAiTurn("conflict", msg);
      } else {
        const msg = e instanceof ApiError ? e.message : "AI draft failed";
        setError(msg);
        appendAiTurn("error", msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!projectId || !draftIdRef.current || !docNumber.trim()) return;
    if (hasInvalidPageRanges(references, linkable)) {
      setError(
        lang === "tr"
          ? "Sayfa aralığı belgeyi aşıyor — onaylamadan önce düzeltin."
          : "A page range exceeds the document — fix it before approving."
      );
      return;
    }
    setBusy(true);
    try {
      const fv = draft?.field_values || {};
      const parentId =
        typeof fv.parent_id === "string" && fv.parent_id ? fv.parent_id : undefined;
      const relation =
        fv.relation === "response" ||
        fv.relation === "followup" ||
        fv.relation === "revision"
          ? fv.relation
          : undefined;

      const res = await approveAuthoringDraft(
        projectId,
        draftIdRef.current,
        draft?.doc_type === "rfi"
          ? {
              version: versionRef.current,
              document_number: docNumber.trim(),
              discipline: discipline.trim() || undefined,
              parent_id: parentId,
              relation:
                relation === "response" || relation === "revision"
                  ? relation
                  : undefined,
            }
          : {
              version: versionRef.current,
              document_number: docNumber.trim(),
              direction: "outgoing",
              corr_type: "letter",
              parent_id: parentId,
              relation:
                relation === "response" || relation === "followup"
                  ? relation
                  : undefined,
            },
      );
      setDraft(res.draft);
      draftStatusRef.current = res.draft.status;
      const path =
        res.entity_type === "rfi"
          ? `/projects/${projectId}/workspace/rfis/${res.materialized.id}`
          : `/projects/${projectId}/workspace/correspondence/${res.materialized.id}`;
      navigate(path);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSaveState("conflict");
      }
      setError(e instanceof ApiError ? e.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  }

  const pageRangesInvalid = hasInvalidPageRanges(references, linkable);

  const saveLabel =
    pageRangesInvalid
      ? lang === "tr"
        ? "aralık geçersiz"
        : "invalid range"
      : saveState === "saving"
        ? "…"
        : saveState === "saved"
          ? lang === "tr"
            ? "kaydedildi"
            : "saved"
          : saveState === "conflict"
            ? "409"
            : "";

  if (!draft && !error) {
    return (
      <div style={{ padding: 24, color: "var(--color-text-secondary)", fontSize: 12 }}>
        {lang === "tr" ? "Taslak açılıyor…" : "Opening draft…"}
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "16px 16px 20px",
        minHeight: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
          gap: 12,
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-brand)",
            fontSize: "var(--type-h1-module)",
            color: "var(--color-text-primary)",
            fontWeight: 500,
            margin: 0,
          }}
        >
          {draft?.doc_type === "rfi"
            ? lang === "tr"
              ? "RFI Yaz"
              : "Write RFI"
            : lang === "tr"
              ? "Yazışma Yaz"
              : "Write Letter"}
        </h1>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            fontFamily: "var(--font-meta)",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: pageRangesInvalid
                ? "var(--color-alert-red)"
                : "var(--color-text-primary)",
            }}
          >
            {saveLabel}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-secondary)",
              opacity: 0.7,
            }}
            title={
              lang === "tr"
                ? "Eşzamanlılık revizyonu (belge geçmişi değil)"
                : "Concurrency revision (not document history)"
            }
          >
            rev {version}
          </span>
        </div>
      </div>

      {error && aiTurns.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--color-alert-red)", marginBottom: 12 }}>{error}</p>
      )}

      {/* Hierarchical split: letter island (primary) | sticky intelligence rail */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.65fr) minmax(260px, 1fr)",
          gap: 20,
          alignItems: "start",
          flex: 1,
        }}
        className="authoring-split"
      >
        {/* Letter island — paper surface only; page chrome stays --color-bg-primary */}
        <div
          className="surface-paper"
          style={{
            position: "relative",
            background: "var(--color-surface-paper)",
            border: "1px solid var(--color-border-medium)",
            padding: "28px 32px",
            display: "flex",
            flexDirection: "column",
            minHeight: "calc(100vh - 120px)",
            borderRadius: 0,
          }}
        >
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              flex: 1,
            }}
          >
            <div
              style={{
                textAlign: "center",
                marginBottom: 20,
                paddingBottom: 12,
                borderBottom: "1px solid var(--color-border-light)",
                color: "var(--color-text-secondary)",
                fontSize: 12,
                fontFamily: "var(--font-ui)",
              }}
            >
              {tpl?.header_text || (lang === "tr" ? "(üst bilgi)" : "(header)")}
            </div>

            <label style={fieldLabel}>{lang === "tr" ? "Konu" : "Subject"}</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={draft?.status !== "drafting"}
              style={fieldInput}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={fieldLabel}>
                  {lang === "tr" ? "İlgi / Attention" : "Attention to"}
                </label>
                <input
                  value={attentionTo}
                  onChange={(e) => setAttentionTo(e.target.value)}
                  disabled={draft?.status !== "drafting"}
                  style={fieldInput}
                />
              </div>
              <div>
                <label style={fieldLabel}>
                  {lang === "tr" ? "Proje" : "Project"}
                </label>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={draft?.status !== "drafting"}
                  style={fieldInput}
                />
              </div>
            </div>

            {draft?.doc_type === "rfi" && (
              <div style={{ marginBottom: 12, maxWidth: 280 }}>
                <label style={fieldLabel}>
                  {lang === "tr" ? "Disiplin" : "Discipline"}
                </label>
                <select
                  value={discipline}
                  onChange={(e) => setDiscipline(e.target.value)}
                  disabled={draft?.status !== "drafting"}
                  style={fieldInput}
                >
                  {RFI_DISCIPLINES.map((d) => (
                    <option key={d || "none"} value={d}>
                      {d || "—"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label style={fieldLabel}>{lang === "tr" ? "Referanslar" : "References"}</label>
            {references.length === 0 && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  fontStyle: "italic",
                  margin: "0 0 8px",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {lang === "tr" ? "Henüz referans yok." : "No references yet."}
              </p>
            )}
            {references.map((r, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  padding: "6px 8px",
                  marginBottom: 4,
                  borderLeft: "2px solid var(--color-accent)",
                  background: "var(--color-bg-secondary)",
                  color: "var(--color-text-primary)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-meta)", fontSize: 11 }}>
                      {r._display ||
                        r.external_doc_number ||
                        r.rfi_id ||
                        r.ref_corr_id}
                    </span>
                    {DOCUMENT_TYPE_LABELS[r.ref_type] && (
                      <span
                        style={{
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {DOCUMENT_TYPE_LABELS[r.ref_type][lang === "tr" ? "tr" : "en"]}
                      </span>
                    )}
                  </div>
                  {r._file_name && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-secondary)",
                        marginTop: 2,
                      }}
                    >
                      {r._file_name}
                    </div>
                  )}
                  {r.document_id && draft?.status === "drafting" && (
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: "1px solid var(--color-border-light)",
                      }}
                    >
                      {(() => {
                        const pc = knownPageCount(r, linkable);
                        const st = r.document_id
                          ? pageCountStatus[r.document_id]
                          : undefined;
                        if (pc == null) {
                          const msg =
                            st === "unavailable"
                              ? lang === "tr"
                                ? "Bu belgenin sayfa sayısı belirlenemedi (render servisi gerekli olabilir); tüm belge eklenecek."
                                : "Page count could not be determined (a render service may be required); the whole document will be included."
                              : lang === "tr"
                                ? "Sayfa sayısı belirleniyor…"
                                : "Determining page count…";
                          return (
                            <p
                              style={{
                                margin: 0,
                                fontSize: 11,
                                color: "var(--color-text-secondary)",
                                fontFamily: "var(--font-ui)",
                              }}
                            >
                              {msg}
                            </p>
                          );
                        }
                        return (
                          <>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "baseline",
                                justifyContent: "space-between",
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 10,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                  color: "var(--color-text-secondary)",
                                  fontFamily: "var(--font-ui)",
                                }}
                              >
                                {lang === "tr"
                                  ? `Sayfa aralığı (opsiyonel, max ${pc})`
                                  : `Page ranges (optional, max ${pc})`}
                              </span>
                              <button
                                type="button"
                                onClick={() => addPageRangeRow(i)}
                                style={{
                                  fontSize: 11,
                                  border: "1px solid var(--color-border-medium)",
                                  background: "var(--color-bg-primary)",
                                  color: "var(--color-text-primary)",
                                  cursor: "pointer",
                                  padding: "2px 8px",
                                  fontFamily: "var(--font-ui)",
                                }}
                              >
                                {lang === "tr" ? "+ Aralık" : "+ Range"}
                              </button>
                            </div>
                            {(r.page_ranges || []).length === 0 && (
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: 11,
                                  color: "var(--color-text-secondary)",
                                  fontFamily: "var(--font-ui)",
                                }}
                              >
                                {lang === "tr"
                                  ? "Boş = tüm belge."
                                  : "Empty = whole document."}
                              </p>
                            )}
                            {(r.page_ranges || []).map((pr, ri) => {
                              const fromBad = pr.from < 1 || pr.from > pc;
                              const toBad =
                                pr.to != null &&
                                (pr.to < pr.from || pr.to > pc);
                              return (
                                <div
                                  key={ri}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    gap: 6,
                                    marginTop: 4,
                                  }}
                                >
                                  <input
                                    type="number"
                                    min={1}
                                    max={pc}
                                    value={pr.from}
                                    onChange={(e) => {
                                      const n = parseInt(e.target.value, 10);
                                      updatePageRangeRow(i, ri, {
                                        from:
                                          Number.isFinite(n) && n >= 1 ? n : 1,
                                      });
                                    }}
                                    aria-invalid={fromBad}
                                    aria-label={
                                      lang === "tr"
                                        ? "Başlangıç sayfası"
                                        : "From page"
                                    }
                                    style={{
                                      width: 64,
                                      fontSize: 11,
                                      padding: "4px 6px",
                                      borderStyle: "solid",
                                      borderColor: fromBad
                                        ? "var(--color-alert-red)"
                                        : "var(--color-border-medium)",
                                      borderWidth: fromBad ? 2 : 1,
                                      backgroundColor: fromBad
                                        ? "var(--color-alert-red-bg)"
                                        : "var(--color-bg-primary)",
                                      color: "var(--color-text-primary)",
                                      fontFamily: "var(--font-meta)",
                                    }}
                                  />
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: "var(--color-text-secondary)",
                                    }}
                                  >
                                    –
                                  </span>
                                  <input
                                    type="number"
                                    min={pr.from}
                                    max={pc}
                                    value={pr.to ?? ""}
                                    placeholder={lang === "tr" ? "son" : "end"}
                                    onChange={(e) => {
                                      const raw = e.target.value.trim();
                                      if (raw === "") {
                                        updatePageRangeRow(i, ri, { to: null });
                                        return;
                                      }
                                      const n = parseInt(raw, 10);
                                      updatePageRangeRow(i, ri, {
                                        to: Number.isFinite(n) ? n : null,
                                      });
                                    }}
                                    aria-invalid={toBad}
                                    aria-label={
                                      lang === "tr"
                                        ? "Bitiş sayfası (boş = sona kadar)"
                                        : "To page (empty = to end)"
                                    }
                                    style={{
                                      width: 64,
                                      fontSize: 11,
                                      padding: "4px 6px",
                                      borderStyle: "solid",
                                      borderColor: toBad
                                        ? "var(--color-alert-red)"
                                        : "var(--color-border-medium)",
                                      borderWidth: toBad ? 2 : 1,
                                      backgroundColor: toBad
                                        ? "var(--color-alert-red-bg)"
                                        : "var(--color-bg-primary)",
                                      color: "var(--color-text-primary)",
                                      fontFamily: "var(--font-meta)",
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removePageRangeRow(i, ri)}
                                    style={{
                                      border: "none",
                                      background: "none",
                                      cursor: "pointer",
                                      color: "var(--color-text-secondary)",
                                      fontSize: 14,
                                      lineHeight: 1,
                                    }}
                                    aria-label={
                                      lang === "tr"
                                        ? "Aralığı sil"
                                        : "Remove range"
                                    }
                                  >
                                    ×
                                  </button>
                                  {(fromBad || toBad) && (
                                    <span
                                      style={{
                                        fontSize: 11,
                                        color: "var(--color-alert-red)",
                                        fontFamily: "var(--font-ui)",
                                        marginLeft: 8,
                                      }}
                                    >
                                      {lang === "tr"
                                        ? `Bu belge ${pc} sayfa — aralık ${pc}'yi aşamaz`
                                        : `Document has ${pc} pages — range cannot exceed ${pc}`}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                            {(r.page_ranges || []).length > 0 && (
                              <button
                                type="button"
                                onClick={() => setRefPageRanges(i, undefined)}
                                style={{
                                  marginTop: 6,
                                  fontSize: 11,
                                  border: "none",
                                  background: "none",
                                  color: "var(--color-text-secondary)",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontFamily: "var(--font-ui)",
                                  textDecoration: "underline",
                                }}
                              >
                                {lang === "tr"
                                  ? "Tüm belgeye dön"
                                  : "Use whole document"}
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
                {r.document_id && (
                  <button
                    type="button"
                    onClick={() => void handlePreviewReference(r)}
                    title={
                      lang === "tr" ? "Referansı önizle" : "Preview reference"
                    }
                    aria-label={
                      lang === "tr" ? "Referansı önizle" : "Preview reference"
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      color: "var(--color-text-secondary)",
                      padding: 2,
                      marginTop: 2,
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                )}
                {draft?.status === "drafting" && (
                  <button
                    type="button"
                    onClick={() => {
                      setReferences((prev) => prev.filter((_, j) => j !== i));
                      setChainPrompt(null);
                    }}
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      color: "var(--color-text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {draft?.status === "drafting" && chainPrompt && chainPrompt.related.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  border: "1px solid var(--color-border-medium)",
                  background: "var(--color-bg-secondary)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      fontFamily: "var(--font-ui)",
                      color: "var(--color-text-primary)",
                      lineHeight: 1.4,
                    }}
                  >
                    {lang === "tr"
                      ? `${chainPrompt.anchor.ref_number} zincirinde başka belgeler var. Eklemek ister misiniz?`
                      : `${chainPrompt.anchor.ref_number} has related chain documents. Add any?`}
                  </p>
                  <button
                    type="button"
                    onClick={() => setChainPrompt(null)}
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                      fontFamily: "var(--font-ui)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {lang === "tr" ? "Yoksay" : "Dismiss"}
                  </button>
                </div>
                {chainPrompt.related.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 0",
                      borderTop: "1px solid var(--color-border-light)",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-meta)",
                          fontSize: 11,
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {d.ref_number}{" "}
                        <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          ({chainRelationLabel(chainPrompt.anchor, d, linkable, lang)})
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-primary)",
                          fontFamily: "var(--font-ui)",
                        }}
                      >
                        {d.subject}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addRef(d, { fromChain: true })}
                      style={{
                        fontSize: 11,
                        padding: "4px 10px",
                        border: "1px solid var(--color-border-medium)",
                        background: "var(--color-bg-primary)",
                        color: "var(--color-text-primary)",
                        cursor: "pointer",
                        fontFamily: "var(--font-ui)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {lang === "tr" ? "Ekle" : "Add"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {draft?.status === "drafting" && (
              <div style={{ marginBottom: 16 }}>
                <div ref={refPickerRef} style={{ position: "relative" }}>
                  <input
                    value={refSearch}
                    onChange={(e) => {
                      setRefSearch(e.target.value);
                      setShowRefDropdown(true);
                    }}
                    onFocus={() => setShowRefDropdown(true)}
                    placeholder={
                      lang === "tr"
                        ? "RFI, yazışma, sözleşme belgesi veya zeyil ara…"
                        : "Search RFI, letter, contract document, or amendment…"
                    }
                    style={fieldInput}
                  />
                  {showRefDropdown && filteredLinkable.length > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: "100%",
                        zIndex: 5,
                        background: "var(--color-bg-primary)",
                        border: "1px solid var(--color-border-medium)",
                        maxHeight: 220,
                        overflowY: "auto",
                      }}
                    >
                      {filteredLinkable.map((doc) => (
                        <button
                          key={`${doc.type}-${doc.id}`}
                          type="button"
                          onClick={() => addRef(doc)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderBottom: "1px solid var(--color-border-light)",
                            background: "none",
                            cursor: "pointer",
                            fontSize: 12,
                            color: "var(--color-text-primary)",
                            fontFamily: "var(--font-ui)",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "var(--font-meta)",
                              fontSize: 11,
                              color: "var(--color-text-secondary)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            {linkableTypeLabel(doc, lang)}
                            {doc.ref_number ? ` ${doc.ref_number}` : ""}
                          </span>{" "}
                          {doc.subject}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualRef((v) => !v)}
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    background: "none",
                    border: "1px solid var(--color-border-medium)",
                    color: "var(--color-text-secondary)",
                    cursor: "pointer",
                    padding: "4px 12px",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {showManualRef
                    ? lang === "tr"
                      ? "Manuel girişi iptal"
                      : "Cancel manual entry"
                    : lang === "tr"
                      ? "+ Sistemde olmayan referans ekle"
                      : "+ Add reference not in system"}
                </button>
                {showManualRef && (
                  <div
                    style={{
                      padding: 12,
                      marginTop: 8,
                      border: "1px solid var(--color-border-medium)",
                      background: "var(--color-bg-primary)",
                    }}
                  >
                    <label style={fieldLabel}>
                      {lang === "tr" ? "Tür *" : "Type *"}
                    </label>
                    <select
                      value={manualRef.type}
                      onChange={(e) =>
                        setManualRef({ ...manualRef, type: e.target.value })
                      }
                      style={{ ...fieldInput, marginBottom: 8 }}
                    >
                      <option value="" disabled>
                        {lang === "tr" ? "— Seçiniz —" : "— Select —"}
                      </option>
                      {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v[lang === "tr" ? "tr" : "en"]}
                        </option>
                      ))}
                    </select>
                    <label style={fieldLabel}>
                      {lang === "tr" ? "Numara *" : "Number *"}
                    </label>
                    <input
                      value={manualRef.number}
                      onChange={(e) =>
                        setManualRef({ ...manualRef, number: e.target.value })
                      }
                      style={{ ...fieldInput, marginBottom: 8 }}
                    />
                    <label style={fieldLabel}>
                      {lang === "tr" ? "Başlık" : "Title"}
                    </label>
                    <input
                      value={manualRef.title}
                      onChange={(e) =>
                        setManualRef({ ...manualRef, title: e.target.value })
                      }
                      style={{ ...fieldInput, marginBottom: 8 }}
                    />
                    <label style={fieldLabel}>
                      {lang === "tr" ? "Tarih" : "Date"}
                    </label>
                    <input
                      type="date"
                      value={manualRef.date}
                      onChange={(e) =>
                        setManualRef({ ...manualRef, date: e.target.value })
                      }
                      style={{ ...fieldInput, marginBottom: 8 }}
                    />
                    {manualRef.type === "other" && (
                      <>
                        <label style={fieldLabel}>
                          {lang === "tr" ? "Tür künyesi" : "Type description"}
                        </label>
                        <input
                          value={manualRef.note}
                          onChange={(e) =>
                            setManualRef({ ...manualRef, note: e.target.value })
                          }
                          style={{ ...fieldInput, marginBottom: 8 }}
                        />
                      </>
                    )}
                    <label style={fieldLabel}>
                      {lang === "tr" ? "Dosya * (zorunlu)" : "File * (required)"}
                    </label>
                    <input
                      type="file"
                      accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.jpg,.jpeg,.png,.dwg,.dxf,.txt,.csv"
                      onChange={(e) =>
                        setManualFile(e.target.files?.[0] ?? null)
                      }
                      style={{ marginBottom: 8, fontSize: 12 }}
                    />
                    {manualFile && (
                      <p
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-secondary)",
                          margin: "0 0 8px",
                        }}
                      >
                        {manualFile.name}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void addManualRef()}
                      disabled={!canAddManual || busy}
                      style={{
                        fontSize: 11,
                        padding: "6px 14px",
                        background: canAddManual
                          ? "var(--color-accent)"
                          : "var(--color-border-medium)",
                        color: canAddManual
                          ? "var(--color-bg-primary)"
                          : "var(--color-text-secondary)",
                        border: "none",
                        cursor: !canAddManual || busy ? "not-allowed" : "pointer",
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      {lang === "tr" ? "Referans Ekle" : "Add Reference"}
                    </button>
                  </div>
                )}
              </div>
            )}

            <label style={fieldLabel}>{lang === "tr" ? "Gövde" : "Body"}</label>
            <div
              style={{
                border: "1px solid var(--color-border-medium)",
                padding: 12,
                background: "var(--color-surface-paper)",
                marginBottom: 16,
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: "min(62vh, 720px)",
              }}
            >
              <RichTextEditor
                value={bodyHtml}
                onChange={setBodyHtml}
                readOnly={draft?.status !== "drafting"}
                minHeight="min(58vh, 680px)"
              />
            </div>

            <div
              style={{
                textAlign: "center",
                marginTop: "auto",
                paddingTop: 12,
                borderTop: "1px solid var(--color-border-light)",
                color: "var(--color-text-secondary)",
                fontSize: 12,
                fontFamily: "var(--font-ui)",
                flexShrink: 0,
              }}
            >
              {tpl?.footer_text || (lang === "tr" ? "(alt bilgi)" : "(footer)")}
            </div>
          </div>
        </div>

        {/* Intelligence rail — sticky while letter scrolls */}
        <aside
          style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-medium)",
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            position: "sticky",
            top: 16,
            alignSelf: "start",
            height: "calc(100vh - 32px)",
            maxHeight: "calc(100vh - 32px)",
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
            {lang === "tr" ? "Zeka katmanı" : "Intelligence"}
          </h2>

          {/* B: first-prompt tip only — disappears after first turn */}
          {aiTurns.length === 0 && (
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-ui)",
                lineHeight: 1.4,
              }}
            >
              {lang === "tr"
                ? "Ne istediğinizi yazın; taslak gövdeyi günceller."
                : "Write what you need; it updates the draft body."}
            </p>
          )}

          {/* Thread + jump ribbon — takes remaining rail height */}
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
                gap: 10,
                paddingRight: 4,
              }}
            >
              {aiTurns.map((turn) => (
                <div
                  key={turn.id}
                  id={`ai-turn-${turn.id}`}
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
                    {turn.userText}
                  </div>
                  <div
                    style={{
                      alignSelf: "flex-start",
                      maxWidth: "92%",
                      padding: "8px 10px",
                      fontSize: 12,
                      fontFamily: "var(--font-ui)",
                      lineHeight: 1.45,
                      color:
                        turn.outcome === "ok"
                          ? "var(--color-text-secondary)"
                          : "var(--color-alert-red)",
                      background: "var(--color-bg-primary)",
                      borderLeft: `2px solid ${
                        turn.outcome === "ok"
                          ? "var(--color-ai)"
                          : "var(--color-alert-red)"
                      }`,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {turn.assistantText}
                  </div>
                </div>
              ))}
            </div>

            {/* Jump ribbon — ticks for each user turn (ChatGPT-style navigator) */}
            {aiTurns.length > 0 && (
              <nav
                aria-label={lang === "tr" ? "Talimat atlama" : "Jump to instruction"}
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
                {aiTurns.map((turn) => {
                  const active = turn.id === activeTurnId;
                  const label =
                    turn.userText.length > 40
                      ? `${turn.userText.slice(0, 40)}…`
                      : turn.userText;
                  return (
                    <button
                      key={turn.id}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-current={active ? "true" : undefined}
                      onClick={() => jumpToTurn(turn.id)}
                      style={{
                        display: "block",
                        width: active ? 12 : 8,
                        height: active ? 3 : 2,
                        marginLeft: "auto",
                        padding: 0,
                        border: "none",
                        borderRadius: 0,
                        cursor: "pointer",
                        background: active
                          ? "var(--color-text-primary)"
                          : "var(--color-border-medium)",
                      }}
                    />
                  );
                })}
              </nav>
            )}
          </div>

          {/* Composer at bottom of sticky rail */}
          {draft?.status === "drafting" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <textarea
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                disabled={busy}
                rows={6}
                placeholder={
                  lang === "tr"
                    ? "Örn. gecikme bildirimi, nazik ton, 2 paragraf…"
                    : "e.g. delay notice, polite tone, 2 paragraphs…"
                }
                style={{
                  ...fieldInput,
                  marginBottom: 0,
                  resize: "vertical",
                  minHeight: 160,
                  maxHeight: 280,
                  lineHeight: 1.45,
                }}
              />
              <AiActionButton
                disabled={busy || saveState === "conflict"}
                onClick={() => void handleAiDraft()}
                style={{ alignSelf: "flex-start" }}
              >
                {lang === "tr" ? "AI ile taslak oluştur" : "Generate with AI"}
              </AiActionButton>
            </div>
          )}
        </aside>
      </div>

      {/* Operational footer — no AI controls here */}
      {draft?.status === "drafting" && (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "flex-end",
            flexShrink: 0,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              fontFamily: "var(--font-ui)",
              color: "var(--color-text-primary)",
              cursor: busy ? "not-allowed" : "pointer",
              marginBottom: 2,
            }}
          >
            <input
              type="checkbox"
              checked={includeReferenceCopies}
              disabled={busy}
              onChange={(e) => setIncludeReferenceCopies(e.target.checked)}
            />
            {lang === "tr"
              ? "Referansların kopyasını mektuba ekle"
              : "Attach copies of references to the letter"}
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleGenerate()}
            style={btnSecondary}
          >
            {lang === "tr" ? "DOCX Üret" : "Generate DOCX"}
          </button>
          <div>
            <label style={fieldLabel}>
              {draft.doc_type === "rfi"
                ? lang === "tr"
                  ? "RFI numarası"
                  : "RFI number"
                : lang === "tr"
                  ? "Yazışma numarası"
                  : "Corr. number"}
            </label>
            <input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              style={{ ...fieldInput, width: 160, marginBottom: 0 }}
            />
          </div>
          <button
            type="button"
            disabled={
              busy ||
              !docNumber.trim() ||
              saveState === "conflict" ||
              pageRangesInvalid
            }
            onClick={() => void handleApprove()}
            style={btnPrimary}
            title={
              pageRangesInvalid
                ? lang === "tr"
                  ? "Geçersiz sayfa aralığını düzeltin"
                  : "Fix invalid page ranges first"
                : undefined
            }
          >
            {lang === "tr" ? "Onayla & Materyalize" : "Approve & Materialize"}
          </button>
          {pageRangesInvalid && (
            <span
              style={{
                fontSize: 11,
                color: "var(--color-alert-red)",
                fontFamily: "var(--font-ui)",
                alignSelf: "center",
              }}
            >
              {lang === "tr"
                ? "Geçersiz sayfa aralığı — kaydetme ve onay durduruldu."
                : "Invalid page range — save and approve paused."}
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              navigate(
                draft.doc_type === "rfi"
                  ? `/projects/${projectId}/workspace?module=rfis`
                  : `/projects/${projectId}/workspace?module=correspondence`
              )
            }
            style={btnSecondary}
          >
            {lang === "tr" ? "Geri" : "Back"}
          </button>
        </div>
      )}

      <style>{`
        @media (max-width: 900px) {
          .authoring-split {
            grid-template-columns: 1fr !important;
          }
          .authoring-split > aside {
            position: relative !important;
            top: auto !important;
            height: auto !important;
            max-height: none !important;
            min-height: 420px;
          }
        }
      `}</style>
    </div>
  );
}

const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--color-text-secondary)",
  marginBottom: 4,
  fontFamily: "var(--font-ui)",
};

const fieldInput: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--color-border-medium)",
  background: "var(--color-surface-paper)",
  color: "var(--color-text-primary)",
  fontSize: 12,
  fontFamily: "var(--font-ui)",
  boxSizing: "border-box",
  marginBottom: 12,
};

const btnPrimary: CSSProperties = {
  background: "var(--color-accent)",
  color: "var(--color-bg-primary)",
  border: "none",
  borderRadius: 0,
  padding: "8px 16px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
};

const btnSecondary: CSSProperties = {
  background: "var(--color-bg-secondary)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-medium)",
  borderRadius: 0,
  padding: "8px 16px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
};
