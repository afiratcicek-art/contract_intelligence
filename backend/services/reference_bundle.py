"""Build reference e-bundle PDF: cover page + primary document per reference.

Letter stays DOCX (build_docx). This module produces the appendix / full
bundle PDF (covers + primary files). When letter_pdf_bytes is provided,
it is prepended for a single downloadable PDF.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from backend.services.render_provider import get_render_provider
from backend.utils.file_handler import download_document

logger = logging.getLogger(__name__)

_IMAGE_EXT = frozenset({"jpg", "jpeg", "png"})
_DOCX_EXT = frozenset({"docx", "doc"})


def _ext(filename: str) -> str:
    if not filename or "." not in filename:
        return ""
    return filename.rsplit(".", 1)[-1].lower()


def resolve_primary_document(
    db,
    project_id: str,
    ref: dict[str, Any],
) -> Optional[dict]:
    """Primary filed document for a reference — not citation/attachment chain noise.

    Manual: ref.document_id.
    System RFI/Corr: earliest ref_role=attachment on that entity, else earliest
    pdf_document row for the entity.
    """
    doc_id = ref.get("document_id")
    if doc_id:
        res = (
            db.table("pdf_document")
            .select("id, storage_path, original_filename, project_id")
            .eq("id", str(doc_id))
            .limit(1)
            .execute()
        )
        row = res.data[0] if res.data else None
        if row and row.get("project_id") == str(project_id):
            return row
        return None

    rfi_id = ref.get("rfi_id")
    corr_id = ref.get("ref_corr_id")
    if rfi_id:
        table, owner_col, entity_type, entity_id = (
            "rfi_references",
            "owner_rfi_id",
            "rfi",
            str(rfi_id),
        )
    elif corr_id:
        table, owner_col, entity_type, entity_id = (
            "correspondence_references",
            "correspondence_id",
            "correspondence",
            str(corr_id),
        )
    else:
        return None

    att = (
        db.table(table)
        .select("document_id")
        .eq(owner_col, entity_id)
        .eq("ref_role", "attachment")
        .order("added_at")
        .limit(1)
        .execute()
    )
    if att.data and att.data[0].get("document_id"):
        return resolve_primary_document(
            db, project_id, {"document_id": att.data[0]["document_id"]}
        )

    fallback = (
        db.table("pdf_document")
        .select("id, storage_path, original_filename, project_id")
        .eq("project_id", str(project_id))
        .eq("entity_type", entity_type)
        .eq("entity_id", entity_id)
        .order("created_at")
        .limit(1)
        .execute()
    )
    return fallback.data[0] if fallback.data else None


def _cover_meta_lines(db, project_id: str, ref: dict[str, Any], index: int) -> list[str]:
    lines = [f"Reference {index}"]
    ref_type = str(ref.get("ref_type") or "")
    if ref.get("rfi_id"):
        row = (
            db.table("rfis")
            .select("rfi_number, subject, submitted_date, created_at")
            .eq("id", str(ref["rfi_id"]))
            .eq("project_id", str(project_id))
            .limit(1)
            .execute()
        )
        r = row.data[0] if row.data else {}
        lines.append("Request for Information (RFI)")
        lines.append(f"Ref# {r.get('rfi_number') or '—'}")
        lines.append(f"Subject {r.get('subject') or '—'}")
        # Prefer submitted_date; created_at is ISO timestamp fallback
        date_s = (
            (r.get("submitted_date") and str(r.get("submitted_date"))[:10])
            or (r.get("created_at") and str(r.get("created_at"))[:10])
            or "—"
        )
        lines.append(f"Date {date_s}")
        return lines

    if ref.get("ref_corr_id"):
        row = (
            db.table("correspondences")
            .select("corr_number, subject, correspondence_date")
            .eq("id", str(ref["ref_corr_id"]))
            .eq("project_id", str(project_id))
            .limit(1)
            .execute()
        )
        r = row.data[0] if row.data else {}
        lines.append("Correspondence (Letter)")
        lines.append(f"Ref# {r.get('corr_number') or '—'}")
        lines.append(f"Subject {r.get('subject') or '—'}")
        lines.append(f"Date {r.get('correspondence_date') or '—'}")
        return lines

    type_label = ref_type.replace("_", " ").title() if ref_type else "Document"
    lines.append(type_label)
    lines.append(f"Ref# {ref.get('external_doc_number') or '—'}")
    lines.append(f"Subject {ref.get('external_doc_title') or '—'}")
    lines.append(f"Date {ref.get('external_doc_date') or '—'}")
    return lines


def _make_cover_pdf(lines: list[str]) -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    y = 72
    for i, text in enumerate(lines):
        size = 18 if i == 0 else 12
        page.insert_text((72, y), text[:200], fontsize=size)
        y += 28 if i == 0 else 20
    out = doc.tobytes()
    doc.close()
    return out


def _make_note_pdf(message: str) -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), message[:500], fontsize=12)
    out = doc.tobytes()
    doc.close()
    return out


def _pdf_with_ranges(src, page_ranges) -> bytes:
    """Copy selected ranges from src into a new PDF.

    DB ranges are 1-indexed; fitz uses 0-indexed pages. Open-ended
    (to=null) runs to src.page_count-1 at runtime (no dependency on
    nullable pdf_document.page_count).
    """
    import fitz

    dest = fitz.open()
    last = src.page_count - 1
    for r in page_ranges or []:
        try:
            f0 = max(0, int(r["from"]) - 1)
        except (KeyError, TypeError, ValueError):
            continue
        to_val = r.get("to")
        if to_val is None:
            t0 = last
        else:
            try:
                t0 = min(int(to_val) - 1, last)
            except (TypeError, ValueError):
                continue
        if f0 <= t0:
            dest.insert_pdf(src, from_page=f0, to_page=t0)
    out = dest.tobytes()
    dest.close()
    return out


def _bytes_as_pdf(file_bytes: bytes, filename: str) -> Optional[bytes]:
    """Convert primary file bytes to PDF pages, or None if unsupported."""
    import fitz

    ext = _ext(filename)
    if ext == "pdf" or file_bytes[:4] == b"%PDF":
        try:
            src = fitz.open(stream=file_bytes, filetype="pdf")
            out = src.tobytes()
            src.close()
            return out
        except Exception as exc:
            logger.warning("Primary PDF open failed: %s", exc)
            return None

    if ext in _IMAGE_EXT:
        try:
            doc = fitz.open()
            page = doc.new_page(width=595, height=842)
            rect = fitz.Rect(36, 36, 559, 806)
            page.insert_image(rect, stream=file_bytes, keep_proportion=True)
            out = doc.tobytes()
            doc.close()
            return out
        except Exception as exc:
            logger.warning("Primary image→PDF failed: %s", exc)
            return None

    if ext in _DOCX_EXT:
        pdf = get_render_provider().render_to_pdf(file_bytes)
        return pdf

    return None


def build_reference_bundle_pdf(
    db,
    *,
    project_id: str,
    references: list[Any],
    letter_pdf_bytes: Optional[bytes] = None,
) -> Optional[bytes]:
    """Merge letter (optional) + per-ref cover + primary into one PDF.

    Returns None when there are no references.
    """
    import fitz

    refs = [r for r in (references or []) if isinstance(r, dict)]
    if not refs and not letter_pdf_bytes:
        return None
    if not refs:
        return letter_pdf_bytes

    dest = fitz.open()
    if letter_pdf_bytes:
        try:
            letter = fitz.open(stream=letter_pdf_bytes, filetype="pdf")
            dest.insert_pdf(letter)
            letter.close()
        except Exception as exc:
            logger.warning("Letter PDF prepend failed: %s", exc)

    for i, ref in enumerate(refs, start=1):
        cover_lines = _cover_meta_lines(db, project_id, ref, i)
        cover = _make_cover_pdf(cover_lines)
        cover_doc = fitz.open(stream=cover, filetype="pdf")
        dest.insert_pdf(cover_doc)
        cover_doc.close()

        primary = resolve_primary_document(db, project_id, ref)
        if not primary or not primary.get("storage_path"):
            note = _make_note_pdf(
                "Primary document file not available in ClauseIQ."
            )
            note_doc = fitz.open(stream=note, filetype="pdf")
            dest.insert_pdf(note_doc)
            note_doc.close()
            continue

        try:
            raw = download_document(primary["storage_path"])
        except Exception as exc:
            logger.warning("Primary download failed: %s", exc)
            note = _make_note_pdf(
                "Primary document file not available in ClauseIQ."
            )
            note_doc = fitz.open(stream=note, filetype="pdf")
            dest.insert_pdf(note_doc)
            note_doc.close()
            continue

        pdf_part = _bytes_as_pdf(raw, primary.get("original_filename") or "file.pdf")
        if pdf_part is None:
            note = _make_note_pdf(
                f"Primary file could not be appended "
                f"({primary.get('original_filename') or 'unknown'})."
            )
            note_doc = fitz.open(stream=note, filetype="pdf")
            dest.insert_pdf(note_doc)
            note_doc.close()
            continue

        part = fitz.open(stream=pdf_part, filetype="pdf")
        ranges = ref.get("page_ranges")
        if ranges:
            try:
                sliced = _pdf_with_ranges(part, ranges)
                part.close()
                part = fitz.open(stream=sliced, filetype="pdf")
            except Exception as exc:
                logger.warning("Page-range slice failed; using full PDF: %s", exc)
        dest.insert_pdf(part)
        part.close()

    if dest.page_count == 0:
        dest.close()
        return None
    out = dest.tobytes()
    dest.close()
    return out
