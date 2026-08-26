/**
 * Authoring HTML policy — shared by TipTap (client) and mirrored in
 * backend/core/html_sanitizer.py. TipTap itself stays in RichTextEditor.tsx.
 */
import DOMPurify from "dompurify";

export const FONT_SIZE_PRESETS = ["11", "12", "14", "16", "18"] as const;
export const SPACE_AFTER_PRESETS = ["sm", "md", "lg"] as const;
export const ALIGNMENTS = ["left", "center", "right", "justify"] as const;

export const ALLOWED_CLASSES = new Set<string>([
  ...FONT_SIZE_PRESETS.map((s) => `text-fs-${s}`),
  ...ALIGNMENTS.map((a) => `text-align-${a}`),
  ...([1, 2, 3, 4] as const).map((n) => `indent-${n}`),
  ...SPACE_AFTER_PRESETS.map((s) => `space-after-${s}`),
  "clauseiq-references",
]);

const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "u", "s", "b", "i",
  "h1", "h2", "h3", "h4",
  "ul", "ol", "li",
  "blockquote", "hr",
  "span",
  "table", "thead", "tbody", "tr", "td", "th",
  "a",
];

/** Word/Outlook conditional comments and office-namespace tags. */
const WORD_CONDITIONAL = /<!--\[if[\s\S]*?endif\]-->/gi;
const OFFICE_NS_TAGS = /<\/?(?:o|w|v|m):\w+[^>]*>/gi;
const META_OR_LINK = /<(?:meta|link)\b[^>]*>/gi;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
/** Three or more empty Word paragraphs → one blank line. */
const EMPTY_PARA_RUN = /(?:<p\b[^>]*>\s*(?:&nbsp;|\u00a0|<br\s*\/?>)*\s*<\/p>\s*){3,}/gi;

export function filterAllowedClasses(html: string): string {
  return html.replace(
    /(<(?:span|p|h1|h2|h3|h4)\b[^>]*\bclass\s*=\s*)(["'])([^"']*)\2/gi,
    (_full, prefix: string, quote: string, classes: string) => {
      const kept = classes.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
      if (!kept.length) {
        return prefix.replace(/\s*class\s*=\s*$/i, "");
      }
      return `${prefix}${quote}${kept.join(" ")}${quote}`;
    },
  );
}

export function sanitizeClient(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "colspan", "rowspan", "class"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
  return filterAllowedClasses(clean);
}

/**
 * Strip Word/Outlook chrome before the allow-list pass.
 * Does not introduce tags — only removes known junk, then sanitizes.
 */
export function cleanPastedHtml(html: string): string {
  let s = html || "";
  s = s.replace(WORD_CONDITIONAL, "");
  s = s.replace(STYLE_BLOCK, "");
  s = s.replace(META_OR_LINK, "");
  s = s.replace(OFFICE_NS_TAGS, "");
  s = s.replace(EMPTY_PARA_RUN, "<p></p>");
  return sanitizeClient(s);
}
