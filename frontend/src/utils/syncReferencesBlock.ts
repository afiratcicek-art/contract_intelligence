/**
 * Managed References block for authoring letter body.
 * Marker: <p class="clauseiq-references">…</p> followed by optional <ol|ul>.
 * Default list: numbered (<ol>). User may switch to bullets in the editor;
 * sync preserves the chosen list tag.
 *
 * Default look: 11px + italic (distinct from letter body).
 */

const MARKER_RE =
  /<p\b[^>]*\bclauseiq-references\b[^>]*>[\s\S]*?<\/p>\s*(?:<(ul|ol)\b[^>]*>[\s\S]*?<\/\1>)?/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styledLine(innerHtml: string): string {
  return `<em><span class="text-fs-11">${innerHtml}</span></em>`;
}

/** Preserve user choice (bullet vs numbered) across picker syncs. */
export function detectReferencesListTag(bodyHtml: string): "ol" | "ul" {
  const m = bodyHtml.match(
    /<p\b[^>]*\bclauseiq-references\b[^>]*>[\s\S]*?<\/p>\s*<(ul|ol)\b/i
  );
  return m?.[1]?.toLowerCase() === "ul" ? "ul" : "ol";
}

export function buildReferencesBlockHtml(
  lines: string[],
  listTag: "ol" | "ul" = "ol"
): string {
  if (lines.length === 0) return "";
  // TipTap list schema expects a block (<p>) inside each <li>.
  const items = lines
    .map(
      (line) => `<li><p>${styledLine(escapeHtml(line))}</p></li>`
    )
    .join("");
  return (
    `<p class="clauseiq-references">${styledLine("<strong>References</strong>")}</p>` +
    `<${listTag}>${items}</${listTag}>`
  );
}

export function syncReferencesBlock(bodyHtml: string, lines: string[]): string {
  const listTag = detectReferencesListTag(bodyHtml);
  const block = buildReferencesBlockHtml(lines, listTag);
  const body = bodyHtml || "";
  if (MARKER_RE.test(body)) {
    const next = body.replace(MARKER_RE, block);
    if (!block) {
      return next.replace(/^(?:<p><\/p>|<p><br\/?><\/p>)\s*/i, "");
    }
    return next;
  }
  if (!block) return body;
  return block + body;
}
