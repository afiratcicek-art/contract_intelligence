"""Clean-slate DOCX builder for authored drafts.

Never ingests a user-supplied .docx — always starts from Document().
"""
from __future__ import annotations

import logging
import re
from html.parser import HTMLParser
from io import BytesIO
from typing import Any, Optional

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt

from backend.utils.file_handler import download_document

logger = logging.getLogger(__name__)


class _HtmlToDocx(HTMLParser):
    """Minimal HTML → python-docx walker for B2-supported tags."""

    def __init__(self, doc: Document):
        super().__init__()
        self.doc = doc
        self._p = None
        self._bold = False
        self._italic = False
        self._in_list = None  # 'ul' | 'ol' | None
        self._list_index = 0
        self._skip = False

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ("script", "style", "iframe"):
            self._skip = True
            return
        if tag in ("p", "h1", "h2", "h3", "h4"):
            self._p = self.doc.add_paragraph()
            if tag.startswith("h"):
                run = self._p.add_run("")
                size = {"h1": 16, "h2": 14, "h3": 12, "h4": 11}.get(tag, 11)
                run.font.size = Pt(size)
                run.bold = True
        elif tag == "br":
            if self._p is None:
                self._p = self.doc.add_paragraph()
            self._p.add_run().add_break()
        elif tag == "strong" or tag == "b":
            self._bold = True
        elif tag in ("em", "i"):
            self._italic = True
        elif tag in ("ul", "ol"):
            self._in_list = tag
            self._list_index = 0
        elif tag == "li":
            self._list_index += 1
            self._p = self.doc.add_paragraph(style="List Bullet" if self._in_list == "ul" else "List Number")
        elif tag == "table":
            self._table_rows = []
            self._current_row = None
            self._in_table = True
        elif tag == "tr":
            self._current_row = []
        elif tag in ("td", "th"):
            self._cell_buf = []
            self._in_cell = True

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("script", "style", "iframe"):
            self._skip = False
            return
        if tag in ("strong", "b"):
            self._bold = False
        elif tag in ("em", "i"):
            self._italic = False
        elif tag in ("ul", "ol"):
            self._in_list = None
        elif tag in ("p", "h1", "h2", "h3", "h4", "li"):
            self._p = None
        elif tag in ("td", "th"):
            text = "".join(self._cell_buf)
            if self._current_row is not None:
                self._current_row.append(text)
            self._in_cell = False
        elif tag == "tr":
            if self._current_row is not None:
                self._table_rows.append(self._current_row)
            self._current_row = None
        elif tag == "table":
            rows = getattr(self, "_table_rows", [])
            if rows:
                cols = max(len(r) for r in rows)
                table = self.doc.add_table(rows=len(rows), cols=cols)
                for i, row in enumerate(rows):
                    for j, cell_text in enumerate(row):
                        table.rows[i].cells[j].text = cell_text
            self._in_table = False

    def handle_data(self, data):
        if self._skip:
            return
        if getattr(self, "_in_cell", False):
            self._cell_buf.append(data)
            return
        if not data:
            return
        if self._p is None:
            self._p = self.doc.add_paragraph()
        run = self._p.add_run(data)
        run.bold = self._bold
        run.italic = self._italic


def _download_storage_bytes(storage_path: Optional[str]) -> Optional[bytes]:
    """Fetch chrome image bytes via file_handler (same Storage path as upload)."""
    if not storage_path:
        return None
    try:
        return download_document(storage_path)
    except Exception as exc:
        logger.warning("Chrome image fetch failed: %s | path=%s", exc, storage_path)
        return None


def build_docx(
    *,
    body_html: str,
    field_values: dict[str, Any],
    template: Optional[dict] = None,
) -> bytes:
    """Build a clean .docx from template chrome + fields + body_html."""
    doc = Document()

    section = doc.sections[0]
    header = section.header
    footer = section.footer

    tpl = template or {}

    # Header image + text
    header_img = _download_storage_bytes(tpl.get("header_image_path"))
    if header_img:
        try:
            hp = header.paragraphs[0] if header.paragraphs else header.add_paragraph()
            run = hp.add_run()
            run.add_picture(BytesIO(header_img), width=Inches(6.0))
            hp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        except Exception as exc:
            logger.warning("Header image embed failed: %s", exc)
    header_text = tpl.get("header_text")
    if header_text:
        hp = header.add_paragraph(header_text)
        hp.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # TB: watermark via raw XML unstable, deferred
    # watermark_image_path is stored and returned to FE for CSS preview opacity,
    # but is NOT embedded in the .docx in Faz A/B (python-docx has no first-class
    # watermark API; raw OOXML behind-text anchoring proved fragile).

    # Footer image + text
    footer_img = _download_storage_bytes(tpl.get("footer_image_path"))
    if footer_img:
        try:
            fp = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
            run = fp.add_run()
            run.add_picture(BytesIO(footer_img), width=Inches(6.0))
            fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        except Exception as exc:
            logger.warning("Footer image embed failed: %s", exc)
    footer_text = tpl.get("footer_text")
    if footer_text:
        fp = footer.add_paragraph(footer_text)
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Field block: Attention to / Project / References
    attention = field_values.get("attention_to") or ""
    project = field_values.get("project") or ""
    refs = field_values.get("references") or []

    if attention:
        p = doc.add_paragraph()
        p.add_run("Attention to: ").bold = True
        p.add_run(str(attention))
    if project:
        p = doc.add_paragraph()
        p.add_run("Project: ").bold = True
        p.add_run(str(project))
    if refs:
        p = doc.add_paragraph()
        p.add_run("References: ").bold = True
        labels = []
        for r in refs:
            if isinstance(r, dict):
                labels.append(
                    r.get("label")
                    or r.get("external_ref")
                    or r.get("rfi_id")
                    or r.get("ref_corr_id")
                    or str(r)
                )
            else:
                labels.append(str(r))
        p.add_run("; ".join(labels))

    doc.add_paragraph()  # spacer

    # Body HTML → paragraphs
    parser = _HtmlToDocx(doc)
    # Strip residual event handlers / javascript: as defense-in-depth
    safe_html = re.sub(r"\son\w+\s*=", " ", body_html or "", flags=re.I)
    safe_html = re.sub(r"javascript\s*:", "", safe_html, flags=re.I)
    try:
        parser.feed(safe_html)
        parser.close()
    except Exception as exc:
        logger.warning("HTML→docx parse fallback to plain text: %s", exc)
        plain = re.sub(r"<[^>]+>", "", safe_html)
        doc.add_paragraph(plain)

    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()
