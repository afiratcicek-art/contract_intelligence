// EDITOR ADAPTER: TipTap is confined to this file by design. Swapping the editor
// (Lexical/ProseMirror/etc.) must require changing only this module.
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import DOMPurify from "dompurify";
import { useEffect } from "react";

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "b", "i",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "td", "th",
  "a",
];

function sanitizeClient(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "colspan", "rowspan"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
}

export default function RichTextEditor({
  value,
  onChange,
  readOnly = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: sanitizeClient(value || ""),
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      onChange(sanitizeClient(ed.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = sanitizeClient(value || "");
    if (current !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [readOnly, editor]);

  if (!editor) return null;

  return (
    <div>
      {!readOnly && (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 8,
            flexWrap: "wrap",
            borderBottom: "1px solid var(--color-border-medium)",
            paddingBottom: 8,
          }}
        >
          {(
            [
              ["bold", () => editor.chain().focus().toggleBold().run()],
              ["italic", () => editor.chain().focus().toggleItalic().run()],
              ["H2", () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
              ["H3", () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
              ["• list", () => editor.chain().focus().toggleBulletList().run()],
              ["1. list", () => editor.chain().focus().toggleOrderedList().run()],
            ] as const
          ).map(([label, fn]) => (
            <button
              key={label}
              type="button"
              onClick={fn}
              style={{
                fontSize: 11,
                padding: "4px 8px",
                border: "1px solid var(--color-border-medium)",
                background: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                cursor: "pointer",
                fontFamily: "Inter, sans-serif",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <EditorContent
        editor={editor}
        style={{
          minHeight: 240,
          fontFamily: "Inter, sans-serif",
          fontSize: 13,
          color: "var(--color-text-primary)",
          lineHeight: 1.6,
        }}
      />
      <style>{`
        .tiptap { outline: none; min-height: 240px; }
        .tiptap p { margin: 0 0 0.6em; }
        .tiptap ul, .tiptap ol { padding-left: 1.4em; margin: 0 0 0.6em; }
        .tiptap h2 { font-size: 1.15em; margin: 0.8em 0 0.4em; }
        .tiptap h3 { font-size: 1.05em; margin: 0.7em 0 0.35em; }
      `}</style>
    </div>
  );
}
