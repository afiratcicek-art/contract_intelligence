// EDITOR ADAPTER: TipTap is confined to this file by design. Swapping the editor
// (Lexical/ProseMirror/etc.) must require changing only this module.
import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { Fragment } from "@tiptap/pm/model";
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  ALIGNMENTS,
  FONT_SIZE_PRESETS,
  SPACE_AFTER_PRESETS,
  cleanPastedHtml,
  sanitizeClient,
} from "./editorHtml";

/** Preset sizes only — free-form values are rejected client + server. */
type FontSizePreset = (typeof FONT_SIZE_PRESETS)[number];
type SpaceAfterPreset = (typeof SPACE_AFTER_PRESETS)[number];
type Alignment = (typeof ALIGNMENTS)[number];
const FONT_SIZE_CLASS_RE = /^text-fs-(11|12|14|16|18)$/;
const SPACE_AFTER_CLASS_RE = /^space-after-(sm|md|lg)$/;
const MAX_INDENT = 4;
/** Rough A4 body capacity at document size — estimate only, shown as ≈. */
const WORDS_PER_PAGE = 350;

/** References-list HUD geometry / timing — behavior constants (not CSS design tokens). */
const HUD_HIDE_DELAY_MS = 600;
/** Marker column hit-target outside list text (list-style:outside). */
const HUD_MARKER_GUTTER_LEFT_PX = 6;
const HUD_MARKER_GUTTER_RIGHT_PX = 36;
const HUD_MARKER_GUTTER_Y_PX = 4;
/** Keep HUD from overflowing the editor shell's right edge. */
const HUD_SHELL_RIGHT_RESERVE_PX = 168;
/** Nudge HUD slightly above the heading text baseline. */
const HUD_ANCHOR_TOP_NUDGE_PX = 2;
/** Gap between heading text end and HUD left edge. */
const HUD_ANCHOR_LEFT_GAP_PX = 8;

/**
 * Class-based font size (no inline style).
 * Bleach 6 strips `style` without tinycss2; classes survive allow-list cleanly.
 */
const FontSizeClass = Mark.create({
  name: "fontSizeClass",
  priority: 101,
  addAttributes() {
    return {
      size: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) => {
          const cls = [...element.classList].find((c) => FONT_SIZE_CLASS_RE.test(c));
          return cls ? cls.replace("text-fs-", "") : null;
        },
        renderHTML: (attributes: { size?: string | null }) => {
          const size = attributes.size;
          if (!size || !FONT_SIZE_PRESETS.includes(size as FontSizePreset)) {
            return {};
          }
          return { class: `text-fs-${size}` };
        },
      },
    };
  },
  parseHTML() {
    return FONT_SIZE_PRESETS.map((size) => ({
      tag: `span.text-fs-${size}`,
      attrs: { size },
    }));
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setFontSizeClass:
        (size: string) =>
        ({ commands }) => {
          if (!FONT_SIZE_PRESETS.includes(size as FontSizePreset)) return false;
          return commands.setMark(this.name, { size });
        },
      unsetFontSizeClass:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** Class-based align — avoids bleach stripping inline text-align styles. */
const TextAlignClass = TextAlign.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element: HTMLElement) => {
              const fromClass = [...element.classList]
                .find((c) => /^text-align-(left|center|right|justify)$/.test(c))
                ?.replace("text-align-", "");
              const raw = fromClass || element.style.textAlign || this.options.defaultAlignment;
              return ALIGNMENTS.includes(raw as Alignment) ? raw : this.options.defaultAlignment;
            },
            renderHTML: (attributes: { textAlign?: string }) => {
              const align = attributes.textAlign;
              if (!align || align === this.options.defaultAlignment) return {};
              if (!ALIGNMENTS.includes(align as Alignment)) return {};
              return { class: `text-align-${align}` };
            },
          },
        },
      },
    ];
  },
}).configure({
  types: ["heading", "paragraph"],
  alignments: [...ALIGNMENTS],
  defaultAlignment: "left",
});

/** Paragraph/heading indent levels (lists use sink/lift instead). */
const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) => {
              const cls = [...element.classList].find((c) => /^indent-[1-4]$/.test(c));
              return cls ? Number(cls.replace("indent-", "")) : 0;
            },
            renderHTML: (attributes: { indent?: number }) => {
              const level = Number(attributes.indent) || 0;
              if (level < 1) return {};
              return { class: `indent-${Math.min(MAX_INDENT, level)}` };
            },
          },
        },
      },
    ];
  },
});

/** Paragraph spacing after the block — class-based so bleach keeps it. */
const SpaceAfter = Extension.create({
  name: "spaceAfter",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          spaceAfter: {
            default: null as string | null,
            parseHTML: (element: HTMLElement) => {
              const cls = [...element.classList].find((c) => SPACE_AFTER_CLASS_RE.test(c));
              return cls ? cls.replace("space-after-", "") : null;
            },
            renderHTML: (attributes: { spaceAfter?: string | null }) => {
              const v = attributes.spaceAfter;
              if (!v || !SPACE_AFTER_PRESETS.includes(v as SpaceAfterPreset)) return {};
              return { class: `space-after-${v}` };
            },
          },
        },
      },
    ];
  },
});

/** Persist managed References marker class through TipTap round-trips. */
const ManagedRefMarker = Extension.create({
  name: "managedRefMarker",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          managedRefs: {
            default: false,
            parseHTML: (element: HTMLElement) =>
              element.classList.contains("clauseiq-references"),
            renderHTML: (attributes: { managedRefs?: boolean }) => {
              if (!attributes.managedRefs) return {};
              return { class: "clauseiq-references" };
            },
          },
        },
      },
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSizeClass: {
      setFontSizeClass: (size: string) => ReturnType;
      unsetFontSizeClass: () => ReturnType;
    };
  }
}

/** Word-like: apply to selection; if caret only, apply to whole current block. */
function applyFontSize(editor: Editor, size: string | null) {
  const { empty, $from } = editor.state.selection;
  let chain = editor.chain().focus();
  if (empty) {
    chain = chain.setTextSelection({ from: $from.start(), to: $from.end() });
  }
  if (!size) return chain.unsetFontSizeClass().run();
  return chain.setFontSizeClass(size).run();
}

function bumpIndent(editor: Editor, delta: number): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") return;
        const cur = Number(node.attrs.indent) || 0;
        const next = Math.max(0, Math.min(MAX_INDENT, cur + delta));
        if (next === cur) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        changed = true;
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    })
    .run();
}

function indentBlock(editor: Editor) {
  if (editor.can().sinkListItem("listItem")) {
    return editor.chain().focus().sinkListItem("listItem").run();
  }
  return bumpIndent(editor, 1);
}

function outdentBlock(editor: Editor) {
  if (editor.can().liftListItem("listItem")) {
    return editor.chain().focus().liftListItem("listItem").run();
  }
  return bumpIndent(editor, -1);
}

function setSpaceAfter(editor: Editor, value: string | null) {
  const next = value && SPACE_AFTER_PRESETS.includes(value as SpaceAfterPreset) ? value : null;
  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") return;
        if ((node.attrs.spaceAfter || null) === next) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, spaceAfter: next });
        changed = true;
      });
      if (changed && dispatch) dispatch(tr);
      return true;
    })
    .run();
}

function wordCountFromEditor(editor: Editor): number {
  const raw = editor.state.doc.textBetween(0, editor.state.doc.content.size, " ");
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return 0;
  return trimmed.split(" ").length;
}

function clearFormatting(editor: Editor) {
  return editor
    .chain()
    .focus()
    .unsetAllMarks()
    .clearNodes()
    .setTextAlign("left")
    .command(({ tr, state, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") return;
        if (!node.attrs.indent && !node.attrs.spaceAfter) return;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0, spaceAfter: null });
        changed = true;
      });
      if (changed && dispatch) dispatch(tr);
      return true;
    })
    .run();
}

type ToolbarBtn = {
  key: string;
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
};

const toolbarBtnStyle = (
  key: string,
  active?: boolean,
  disabled?: boolean,
): CSSProperties => ({
  fontSize: 11,
  padding: "4px 8px",
  border: "1px solid var(--color-border-medium)",
  background: active ? "var(--color-bg-tertiary)" : "var(--color-bg-primary)",
  color: disabled ? "var(--color-text-secondary)" : "var(--color-text-primary)",
  cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: "var(--font-ui)",
  borderRadius: 0,
  opacity: disabled ? 0.45 : 1,
  fontWeight: key === "bold" ? 700 : key === "italic" ? 400 : 500,
  fontStyle: key === "italic" ? "italic" : "normal",
  textDecoration: key === "underline" ? "underline" : "none",
});

export type RichTextEditorHandle = {
  /** Plain text of the current selection; "" when caret-only / no selection. */
  getSelectionText: () => string;
  /** Replace the current selection with escaped plain text (selection-only revise). */
  applyToSelection: (text: string) => void;
  /** Replace the entire editor body with sanitized HTML. */
  replaceBody: (html: string) => void;
};

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  /** Min height for the editable surface (authoring uses a tall viewport-relative value). */
  minHeight?: number | string;
  /**
   * Imperative adapter handle (C2-B). TipTap stays inside this module — callers
   * must not touch editor.state / editor.chain (B1).
   */
  editorRef?: Ref<RichTextEditorHandle | null>;
}

export default function RichTextEditor({
  value,
  onChange,
  readOnly = false,
  minHeight = 240,
  editorRef,
}: RichTextEditorProps) {
  const minHeightCss =
    typeof minHeight === "number" ? `${minHeight}px` : minHeight;
  const { lang, t } = useLanguage();
  const [, setToolbarTick] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // StarterKit (TipTap 3) bundles underline; disable it here so the
        // explicit Underline import below is the single authority (no duplicate
        // extension registration / console warning).
        underline: false,
      }),
      Underline,
      FontSizeClass,
      TextAlignClass,
      Indent,
      SpaceAfter,
      ManagedRefMarker,
      TableKit.configure({
        table: { resizable: false },
      }),
    ],
    content: sanitizeClient(value || ""),
    editable: !readOnly,
    editorProps: {
      transformPastedHTML: (html: string) => cleanPastedHtml(html),
    },
    onUpdate: ({ editor: ed }) => {
      onChange(sanitizeClient(ed.getHTML()));
    },
    onSelectionUpdate: () => setToolbarTick((n) => n + 1),
    onTransaction: () => setToolbarTick((n) => n + 1),
  });

  const pendingSelectionRef = useRef<{ from: number; to: number } | null>(null);

  useImperativeHandle(
    editorRef,
    () => ({
      getSelectionText: () => {
        if (!editor) {
          pendingSelectionRef.current = null;
          return "";
        }
        const { from, to, empty } = editor.state.selection;
        if (empty) {
          pendingSelectionRef.current = null;
          return "";
        }
        // Snapshot range now — applyToSelection may run after await.
        pendingSelectionRef.current = { from, to };
        return editor.state.doc.textBetween(from, to, "\n");
      },
      applyToSelection: (text: string) => {
        if (!editor || !pendingSelectionRef.current) return;
        const { from, to } = pendingSelectionRef.current;
        pendingSelectionRef.current = null;
        const safe = (text || "").replace(/\u0000/g, "");
        editor
          .chain()
          .focus()
          .command(({ tr, state, dispatch }) => {
            if (from < 0 || to > state.doc.content.size || from >= to) {
              return false;
            }
            const $from = state.doc.resolve(from);
            const marks = $from.marks();
            const lines = safe.split("\n");
            const nodes = [];
            for (let i = 0; i < lines.length; i += 1) {
              if (i > 0 && state.schema.nodes.hardBreak) {
                nodes.push(state.schema.nodes.hardBreak.create());
              }
              if (lines[i]) {
                nodes.push(state.schema.text(lines[i], marks));
              }
            }
            const content = nodes.length
              ? Fragment.from(nodes)
              : state.schema.text("\u00a0", marks);
            tr.replaceWith(from, to, content);
            if (dispatch) dispatch(tr);
            return true;
          })
          .run();
        onChange(sanitizeClient(editor.getHTML()));
      },
      replaceBody: (html: string) => {
        if (!editor) return;
        pendingSelectionRef.current = null;
        const clean = sanitizeClient(html || "");
        editor.commands.setContent(clean, { emitUpdate: false });
        onChange(clean);
      },
    }),
    [editor, onChange]
  );

  useEffect(() => {
    if (!editor) return;
    const current = sanitizeClient(editor.getHTML());
    const next = sanitizeClient(value || "");
    if (current !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [readOnly, editor]);

  /**
   * One HUD for the whole References list (not per-item).
   * Anchored beside the "References" heading; shown while pointer is over
   * the heading, the list, or the HUD itself.
   */
  const [refListHud, setRefListHud] = useState<{
    top: number;
    left: number;
    isBullet: boolean;
  } | null>(null);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const refHudRef = useRef<HTMLLabelElement | null>(null);
  const hideHudTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!editor || readOnly) return;
    const root = editor.view.dom;

    const clearHide = () => {
      if (hideHudTimer.current != null) {
        window.clearTimeout(hideHudTimer.current);
        hideHudTimer.current = null;
      }
    };

    const scheduleHide = () => {
      clearHide();
      hideHudTimer.current = window.setTimeout(
        () => setRefListHud(null),
        HUD_HIDE_DELAY_MS
      );
    };

    const findReferencesBlock = (): {
      heading: HTMLElement;
      list: HTMLOListElement | HTMLUListElement;
    } | null => {
      const heading = root.querySelector(
        "p.clauseiq-references"
      ) as HTMLElement | null;
      const next = heading?.nextElementSibling;
      if (
        !heading ||
        !next ||
        (next.tagName !== "OL" && next.tagName !== "UL")
      ) {
        return null;
      }
      return {
        heading,
        list: next as HTMLOListElement | HTMLUListElement,
      };
    };

    const onMove = (e: MouseEvent) => {
      const shell = editorShellRef.current;
      if (!shell) return;

      const block = findReferencesBlock();
      if (!block) {
        scheduleHide();
        return;
      }

      const { heading, list } = block;
      const overHud = !!refHudRef.current?.contains(e.target as Node);
      const overHeading = heading.contains(e.target as Node);
      const overList = list.contains(e.target as Node);
      // Marker column (outside list text) — list-style outside sits in padding.
      const listRect = list.getBoundingClientRect();
      const inMarkerGutter =
        e.clientX >= listRect.left - HUD_MARKER_GUTTER_LEFT_PX &&
        e.clientX <= listRect.left + HUD_MARKER_GUTTER_RIGHT_PX &&
        e.clientY >= listRect.top - HUD_MARKER_GUTTER_Y_PX &&
        e.clientY <= listRect.bottom + HUD_MARKER_GUTTER_Y_PX;

      if (!overHud && !overHeading && !overList && !inMarkerGutter) {
        scheduleHide();
        return;
      }

      clearHide();
      const shellRect = shell.getBoundingClientRect();
      // Anchor to the heading *text* (block <p> is full-width — using p.right
      // shoved the HUD to the far edge of the editor).
      const range = document.createRange();
      range.selectNodeContents(heading);
      const textRect =
        range.getClientRects()[0] ?? heading.getBoundingClientRect();
      setRefListHud({
        top: textRect.top - shellRect.top - HUD_ANCHOR_TOP_NUDGE_PX,
        left: Math.min(
          textRect.right - shellRect.left + HUD_ANCHOR_LEFT_GAP_PX,
          shellRect.width - HUD_SHELL_RIGHT_RESERVE_PX
        ),
        isBullet: list.tagName === "UL",
      });
    };

    const shell = editorShellRef.current;
    if (!shell) return;
    shell.addEventListener("mousemove", onMove);
    shell.addEventListener("mouseleave", scheduleHide);
    return () => {
      clearHide();
      shell.removeEventListener("mousemove", onMove);
      shell.removeEventListener("mouseleave", scheduleHide);
    };
  }, [editor, readOnly]);

  if (!editor) return null;

  const switchReferencesListStyle = (wantBullet: boolean) => {
    const { state, view } = editor;
    let listPos: number | null = null;
    // Find the list node immediately after the managed References heading.
    state.doc.descendants((node, pos) => {
      if (listPos != null) return false;
      if (node.type.name !== "paragraph" || !node.attrs.managedRefs) return;
      const after = pos + node.nodeSize;
      const next = state.doc.nodeAt(after);
      if (
        next &&
        (next.type.name === "orderedList" || next.type.name === "bulletList")
      ) {
        listPos = after;
      }
      return false;
    });
    if (listPos == null) return;

    const node = state.doc.nodeAt(listPos);
    if (!node) return;
    const targetType = wantBullet
      ? state.schema.nodes.bulletList
      : state.schema.nodes.orderedList;
    if (!targetType) return;

    if (node.type === targetType) {
      setRefListHud((h) => (h ? { ...h, isBullet: wantBullet } : h));
      return;
    }

    // Direct node-type swap — toggleBulletList/toggleOrderedList is unreliable here.
    view.dispatch(
      state.tr.setNodeMarkup(listPos, targetType, node.attrs, node.marks)
    );
    setRefListHud((h) => (h ? { ...h, isBullet: wantBullet } : h));
  };

  const buttons: ToolbarBtn[] = [
    {
      key: "bold",
      label: "B",
      title: t("editor.bold"),
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      label: "I",
      title: t("editor.italic"),
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: "underline",
      label: "U",
      title: t("editor.underline"),
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      key: "strike",
      label: "S",
      title: t("editor.strike"),
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      key: "h2",
      label: "H2",
      title: t("editor.h2"),
      active: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: "h3",
      label: "H3",
      title: t("editor.h3"),
      active: editor.isActive("heading", { level: 3 }),
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: "bullet",
      label: "•",
      title: t("editor.bullet"),
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: "ordered",
      label: "1.",
      title: t("editor.ordered"),
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: "align-left",
      label: "L",
      title: t("editor.alignleft"),
      active: editor.isActive({ textAlign: "left" }),
      run: () => editor.chain().focus().setTextAlign("left").run(),
    },
    {
      key: "align-center",
      label: "C",
      title: t("editor.aligncenter"),
      active: editor.isActive({ textAlign: "center" }),
      run: () => editor.chain().focus().setTextAlign("center").run(),
    },
    {
      key: "align-right",
      label: "R",
      title: t("editor.alignright"),
      active: editor.isActive({ textAlign: "right" }),
      run: () => editor.chain().focus().setTextAlign("right").run(),
    },
    {
      key: "align-justify",
      label: "J",
      title: t("editor.justify"),
      active: editor.isActive({ textAlign: "justify" }),
      run: () => editor.chain().focus().setTextAlign("justify").run(),
    },
    {
      key: "indent",
      label: "⇥",
      title: t("editor.indent"),
      run: () => indentBlock(editor),
    },
    {
      key: "outdent",
      label: "⇤",
      title: t("editor.outdent"),
      run: () => outdentBlock(editor),
    },
    {
      key: "table",
      label: t("editor.table"),
      title: t("editor.tableinsert"),
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      key: "clear",
      label: t("editor.clear"),
      title: t("editor.clearfmt"),
      run: () => clearFormatting(editor),
    },
    {
      key: "undo",
      label: "↶",
      title: t("editor.undo"),
      run: () => editor.chain().focus().undo().run(),
    },
    {
      key: "redo",
      label: "↷",
      title: t("editor.redo"),
      run: () => editor.chain().focus().redo().run(),
    },
  ];

  const inTable = editor.isActive("table");
  const tableButtons: ToolbarBtn[] = inTable
    ? [
        {
          key: "col-before",
          label: "+Col←",
          title: "Add column before",
          disabled: !editor.can().addColumnBefore(),
          run: () => editor.chain().focus().addColumnBefore().run(),
        },
        {
          key: "col-after",
          label: "+Col→",
          title: "Add column after",
          disabled: !editor.can().addColumnAfter(),
          run: () => editor.chain().focus().addColumnAfter().run(),
        },
        {
          key: "col-del",
          label: "−Col",
          title: "Delete column",
          disabled: !editor.can().deleteColumn(),
          run: () => editor.chain().focus().deleteColumn().run(),
        },
        {
          key: "row-before",
          label: "+Row↑",
          title: "Add row before",
          disabled: !editor.can().addRowBefore(),
          run: () => editor.chain().focus().addRowBefore().run(),
        },
        {
          key: "row-after",
          label: "+Row↓",
          title: "Add row after",
          disabled: !editor.can().addRowAfter(),
          run: () => editor.chain().focus().addRowAfter().run(),
        },
        {
          key: "row-del",
          label: "−Row",
          title: "Delete row",
          disabled: !editor.can().deleteRow(),
          run: () => editor.chain().focus().deleteRow().run(),
        },
        {
          key: "merge",
          label: "Merge",
          title: "Merge selected cells",
          disabled: !editor.can().mergeCells(),
          run: () => editor.chain().focus().mergeCells().run(),
        },
        {
          key: "split",
          label: "Split",
          title: "Split merged cell",
          disabled: !editor.can().splitCell(),
          run: () => editor.chain().focus().splitCell().run(),
        },
        {
          key: "table-del",
          label: "Del table",
          title: "Delete table",
          disabled: !editor.can().deleteTable(),
          run: () => editor.chain().focus().deleteTable().run(),
        },
      ]
    : [];

  const currentSize =
    (editor.getAttributes("fontSizeClass").size as string | undefined) || "";
  const currentSpace = (
    (editor.getAttributes("paragraph").spaceAfter as string | undefined) ||
    (editor.getAttributes("heading").spaceAfter as string | undefined) ||
    ""
  );
  const words = wordCountFromEditor(editor);
  const pages = words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_PAGE));

  const renderToolbarButtons = (items: ToolbarBtn[]) =>
    items.map(({ key, label, title, active, disabled, run }) => (
      <button
        key={key}
        type="button"
        title={title}
        aria-label={title}
        disabled={disabled}
        onClick={run}
        style={toolbarBtnStyle(key, active, disabled)}
      >
        {label}
      </button>
    ));

  return (
    <div style={{ ["--editor-min-height" as string]: minHeightCss }}>
      {!readOnly && (
        <div style={{ margin: "-12px -12px 12px" }}>
          <div
            style={{
              display: "flex",
              gap: 4,
              flexWrap: "wrap",
              alignItems: "center",
              borderBottom: "1px solid var(--color-border-medium)",
              background: "var(--color-bg-secondary)",
              padding: "8px 8px 10px",
            }}
          >
            <select
              aria-label={t("editor.size")}
              value={
                FONT_SIZE_PRESETS.includes(currentSize as FontSizePreset)
                  ? currentSize
                  : ""
              }
              onChange={(e) => applyFontSize(editor, e.target.value || null)}
              style={{
                fontSize: 11,
                padding: "4px 6px",
                border: "1px solid var(--color-border-medium)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-ui)",
                borderRadius: 0,
                cursor: "pointer",
              }}
            >
              <option value="">{t("editor.size")}</option>
              {FONT_SIZE_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              aria-label={t("editor.space")}
              value={
                SPACE_AFTER_PRESETS.includes(currentSpace as SpaceAfterPreset)
                  ? currentSpace
                  : ""
              }
              onChange={(e) => setSpaceAfter(editor, e.target.value || null)}
              style={{
                fontSize: 11,
                padding: "4px 6px",
                border: "1px solid var(--color-border-medium)",
                background: "var(--color-bg-primary)",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-ui)",
                borderRadius: 0,
                cursor: "pointer",
              }}
            >
              <option value="">{t("editor.space.default")}</option>
              <option value="sm">{t("editor.space.sm")}</option>
              <option value="md">{t("editor.space.md")}</option>
              <option value="lg">{t("editor.space.lg")}</option>
            </select>
            {renderToolbarButtons(buttons)}
          </div>
          {inTable && (
            <div
              role="toolbar"
              aria-label={t("editor.table")}
              style={{
                display: "flex",
                gap: 4,
                flexWrap: "wrap",
                alignItems: "center",
                borderBottom: "1px solid var(--color-border-medium)",
                background: "var(--color-bg-tertiary)",
                padding: "6px 8px 8px",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  fontFamily: "var(--font-ui)",
                  letterSpacing: "0.04em",
                  marginRight: 4,
                  textTransform: lang === "en" ? "uppercase" : "none",
                }}
              >
                {t("editor.table")}
              </span>
              {renderToolbarButtons(tableButtons)}
            </div>
          )}
        </div>
      )}
      <div ref={editorShellRef} style={{ position: "relative" }}>
        <EditorContent
          editor={editor}
          style={{
            minHeight: minHeightCss,
            fontFamily: "var(--font-document)",
            fontSize: 15,
            color: "var(--color-text-primary)",
            lineHeight: 1.65,
          }}
        />
        {!readOnly && refListHud && (
          <label
            ref={refHudRef}
            onMouseEnter={() => {
              if (hideHudTimer.current != null) {
                window.clearTimeout(hideHudTimer.current);
                hideHudTimer.current = null;
              }
            }}
            style={{
              position: "absolute",
              top: Math.max(0, refListHud.top),
              left: Math.max(0, refListHud.left),
              zIndex: 4,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border-medium)",
              fontSize: 11,
              fontFamily: "var(--font-ui)",
              color: "var(--color-text-primary)",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
              whiteSpace: "nowrap",
            }}
            title={
              lang === "tr"
                ? "Açık: madde işaretleri (•). Kapalı: numaralı liste (1. 2. 3.). Tüm References listesine uygulanır."
                : "On: bullet list (•). Off: numbered list (1. 2. 3.). Applies to the whole References block."
            }
          >
            <input
              type="checkbox"
              checked={refListHud.isBullet}
              onChange={(e) => switchReferencesListStyle(e.target.checked)}
              style={{ margin: 0, cursor: "pointer" }}
            />
            <span style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.25 }}>
              <span>{lang === "tr" ? "Madde işaretleri" : "Bullet markers"}</span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-secondary)",
                  fontWeight: 400,
                }}
              >
                {refListHud.isBullet
                  ? lang === "tr"
                    ? "Şu an: •  — kapatınca 1. 2. 3."
                    : "Now: •  — uncheck for 1. 2. 3."
                  : lang === "tr"
                    ? "Şu an: 1. 2. 3. — açınca •"
                    : "Now: 1. 2. 3. — check for •"}
              </span>
            </span>
          </label>
        )}
      </div>
      {!readOnly && (
        <div
          className="data-figure"
          style={{
            marginTop: 8,
            color: "var(--color-text-secondary)",
            textAlign: "end",
          }}
        >
          {t("editor.words").replace("{n}", String(words))}
          {pages > 0
            ? ` · ${t("editor.pages").replace("{n}", String(pages))}`
            : ""}
        </div>
      )}
      <style>{`
        .tiptap { outline: none; min-height: var(--editor-min-height, 240px); font-family: var(--font-document); }
        .tiptap p { margin: 0 0 0.6em; }
        /* Tailwind preflight sets list-style:none on ul/ol — restore markers in the editor. */
        .tiptap ul {
          list-style-type: disc;
          list-style-position: outside;
          padding-left: 1.75em;
          margin: 0 0 0.6em;
        }
        .tiptap ol {
          list-style-type: decimal;
          list-style-position: outside;
          padding-left: 1.75em;
          margin: 0 0 0.6em;
        }
        .tiptap li {
          display: list-item;
          margin: 0 0 0.25em;
        }
        .tiptap li p { margin: 0; }
        /* References list: default 11px; markers follow li (and thus text-fs-* via :has). */
        .tiptap p.clauseiq-references + ol,
        .tiptap p.clauseiq-references + ul {
          margin-top: 0.15em;
          line-height: 1.45;
        }
        .tiptap p.clauseiq-references + ol > li,
        .tiptap p.clauseiq-references + ul > li {
          font-size: 11px;
          font-family: var(--font-document);
        }
        .tiptap p.clauseiq-references + ol > li:has(.text-fs-11),
        .tiptap p.clauseiq-references + ul > li:has(.text-fs-11) { font-size: 11px; }
        .tiptap p.clauseiq-references + ol > li:has(.text-fs-12),
        .tiptap p.clauseiq-references + ul > li:has(.text-fs-12) { font-size: 12px; }
        .tiptap p.clauseiq-references + ol > li:has(.text-fs-14),
        .tiptap p.clauseiq-references + ul > li:has(.text-fs-14) { font-size: 14px; }
        .tiptap p.clauseiq-references + ol > li:has(.text-fs-16),
        .tiptap p.clauseiq-references + ul > li:has(.text-fs-16) { font-size: 16px; }
        .tiptap p.clauseiq-references + ol > li:has(.text-fs-18),
        .tiptap p.clauseiq-references + ul > li:has(.text-fs-18) { font-size: 18px; }
        .tiptap p.clauseiq-references + ol > li::marker,
        .tiptap p.clauseiq-references + ul > li::marker {
          font-size: 1em;
          font-family: inherit;
          color: inherit;
        }
        .tiptap h2, .tiptap h3 {
          font-family: var(--font-document);
          font-weight: 600;
          color: var(--color-text-primary);
        }
        .tiptap h2 { font-size: 1.2em; margin: 0.8em 0 0.4em; }
        .tiptap h3 { font-size: 1.08em; margin: 0.7em 0 0.35em; }
        .tiptap .text-align-left { text-align: left; }
        .tiptap .text-align-center { text-align: center; }
        .tiptap .text-align-right { text-align: right; }
        .tiptap .text-align-justify { text-align: justify; }
        .tiptap .indent-1 { padding-left: 1.5em; }
        .tiptap .indent-2 { padding-left: 3em; }
        .tiptap .indent-3 { padding-left: 4.5em; }
        .tiptap .indent-4 { padding-left: 6em; }
        .tiptap .space-after-sm { margin-bottom: 0.25em; }
        .tiptap .space-after-md { margin-bottom: 0.9em; }
        .tiptap .space-after-lg { margin-bottom: 1.5em; }
        .tiptap table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.6em 0 1em;
          font-size: 12px;
        }
        .tiptap th, .tiptap td {
          border: 1px solid var(--color-border-medium);
          padding: 6px 8px;
          vertical-align: top;
          min-width: 40px;
        }
        .tiptap th {
          background: var(--color-bg-secondary);
          font-weight: 600;
        }
        .tiptap span.text-fs-11 { font-size: 11px !important; }
        .tiptap span.text-fs-12 { font-size: 12px !important; }
        .tiptap span.text-fs-14 { font-size: 14px !important; }
        .tiptap span.text-fs-16 { font-size: 16px !important; }
        .tiptap span.text-fs-18 { font-size: 18px !important; }
      `}</style>
    </div>
  );
}
