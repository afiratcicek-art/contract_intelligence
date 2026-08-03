"""Document authoring router — templates, drafts, docx, approve/materialize.

Prefix: /projects/{project_id}/authoring
Auth: verify_project_access (reads) / require_cm_role (writes).
All DB I/O via access["db"] — no admin_client here (AuditService + file_handler excepted).
"""
import html
import io
import logging
import uuid
from datetime import date, datetime, timezone
# uuid used for docx filenames + pdf_document ids
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from backend.core.dependencies import require_cm_role, verify_project_access
from backend.core.exceptions import ConflictError, NotFoundError, RaceConditionError, ValidationError
from backend.core.guards import assert_target_in_project, assert_document_not_already_linked
from backend.core.html_sanitizer import sanitize_body_html
from backend.core.limiter import limiter
from backend.models.document_authoring import (
    AiChatRequest,
    DraftApprove,
    DraftCreate,
    DraftSnapshot,
    DraftUpdate,
    GenerateDocxRequest,
    TemplateCreate,
    TemplateUpdate,
)
from backend.repositories.contract_repository import ContractRepository
from backend.repositories.correspondence_repository import CorrespondenceRepository
from backend.repositories.document_draft_repository import DocumentDraftRepository
from backend.repositories.document_template_repository import DocumentTemplateRepository
from backend.repositories.rfi_repository import RFIRepository
from backend.services.audit_service import AuditService
from backend.services.claude_service import GateBlockedResult, get_ai_service
from backend.services.docx_builder import build_docx
from backend.services.image_sanitize import reencode_chrome_image
from backend.services.linkable_service import list_linkable_documents
from backend.services.reference_bundle import build_reference_bundle_pdf
from backend.services.render_provider import get_render_provider
from backend.utils.file_handler import download_document, get_signed_url, upload_document
from backend.utils.pdf_utils import validate_document_bytes
from backend.utils.sanitizer import sanitize_user_input

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/authoring", tags=["authoring"])

ChromeSlot = Literal["header", "footer", "watermark"]


def _assert_draft_in_project(draft: dict, project_id: str) -> None:
    if draft.get("project_id") != str(project_id):
        raise NotFoundError()


def _assert_template_in_project(tpl: dict, project_id: str) -> None:
    if tpl.get("project_id") != str(project_id):
        raise NotFoundError()


def _resolve_chain_link(
    *,
    doc_type: str,
    body_parent_id: Optional[UUID],
    body_relation: Optional[str],
    field_values: dict,
) -> tuple[Optional[UUID], Optional[str]]:
    """Resolve parent/relation for materialize. Approve body is authoritative;
    field_values may supply fallback but must not disagree with body.
    """
    fv_parent = field_values.get("parent_id")
    fv_relation = field_values.get("relation")

    if body_parent_id and fv_parent and str(fv_parent) != str(body_parent_id):
        raise ConflictError("parent_id taslak ile onay gövdesi uyuşmuyor.")
    if body_relation and fv_relation and str(fv_relation) != str(body_relation):
        raise ConflictError("relation taslak ile onay gövdesi uyuşmuyor.")

    parent_id = body_parent_id
    if parent_id is None and fv_parent:
        try:
            parent_id = UUID(str(fv_parent))
        except (TypeError, ValueError) as exc:
            raise ValidationError("Geçersiz parent_id.") from exc

    relation = body_relation or (str(fv_relation) if fv_relation else None)

    if bool(parent_id) != bool(relation):
        raise ValidationError("parent_id ve relation birlikte gerekir.")

    if not parent_id:
        return None, None

    if doc_type == "rfi":
        if relation not in ("response", "revision"):
            raise ValidationError("RFI relation yalnızca response veya revision olabilir.")
    elif doc_type == "letter":
        if relation not in ("response", "followup"):
            raise ValidationError(
                "Correspondence relation yalnızca response veya followup olabilir."
            )
    else:
        raise ValidationError("Bilinmeyen doc_type.")

    return parent_id, relation


def _plaintext_to_body_html(text: str) -> str:
    """Escape first, then structural newlines → paragraphs/br, then sanitize."""
    escaped = html.escape(text or "").replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = escaped.split("\n\n")
    inner = "</p><p>".join(p.replace("\n", "<br>") for p in paragraphs)
    return sanitize_body_html(f"<p>{inner}</p>")


def _autofill_fields(db, project_id: str) -> dict:
    """Measured sources: project name + contract_parties / project party fallbacks.
    References left empty for user picker (no Faz D grounding).
    """
    proj = (
        db.table("projects")
        .select("name, employer_name, contractor_name, engineer_name")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    row = (proj.data or [None])[0] or {}
    project_name = row.get("name") or ""

    attention = ""
    contract = ContractRepository(db).get_by_project(project_id)
    if contract:
        parties = contract.get("contract_parties") or []
        # Prefer employer / engineer as attention-to for outgoing authored docs
        by_role = {p.get("role"): p.get("name") for p in parties if p.get("name")}
        attention = (
            by_role.get("employer")
            or by_role.get("engineer")
            or by_role.get("contractor")
            or next(iter(by_role.values()), "")
        )
    if not attention:
        attention = (
            row.get("employer_name")
            or row.get("engineer_name")
            or row.get("contractor_name")
            or ""
        )

    return {
        "project": project_name,
        "attention_to": attention,
        "references": [],
    }


def _strip_ref_ui_keys(ref: dict) -> dict:
    """Drop UI-only keys (leading _) before reference table insert."""
    return {k: v for k, v in ref.items() if not str(k).startswith("_") and v is not None}


def _validate_page_ranges(ranges, page_count: Optional[int]) -> Optional[list]:
    """Validate + normalize page_ranges JSONB. None/[] → None (whole document).
    Each item: {from:int>=1, to:int>=from OR null(open-ended)}.
    When page_count is known, enforce upper bounds; when None (defense /
    race before page-count cache), skip upper-bound checks only.
    """
    if not ranges:
        return None
    if not isinstance(ranges, list):
        raise ValidationError("page_ranges bir liste olmalı.")
    out = []
    for r in ranges:
        if not isinstance(r, dict) or "from" not in r:
            raise ValidationError("Geçersiz sayfa aralığı.")
        f = r.get("from")
        t = r.get("to")
        # JSON may decode whole numbers as int; reject bool (bool is int subclass).
        if isinstance(f, bool) or not isinstance(f, int) or f < 1:
            raise ValidationError("Sayfa başlangıcı 1 veya daha büyük olmalı.")
        if t is not None:
            if isinstance(t, bool) or not isinstance(t, int) or t < f:
                raise ValidationError("Sayfa bitişi başlangıçtan küçük olamaz.")
            if page_count is not None and t > page_count:
                raise ValidationError(
                    f"Sayfa aralığı belgeyi aşıyor (max {page_count})."
                )
        if page_count is not None and f > page_count:
            raise ValidationError(
                f"Sayfa başlangıcı belgeyi aşıyor (max {page_count})."
            )
        out.append({"from": f, "to": t})
    return out or None


def _pdf_document_page_count(db, document_id: str) -> Optional[int]:
    res = (
        db.table("pdf_document")
        .select("page_count")
        .eq("id", str(document_id))
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    pc = res.data[0].get("page_count")
    try:
        n = int(pc) if pc is not None else None
    except (TypeError, ValueError):
        return None
    return n if n is not None and n > 0 else None


def _apply_page_ranges_to_rdata(db, ref: dict, rdata: dict) -> None:
    """Set validated page_ranges on rdata, or clear when no primary document."""
    if not rdata.get("document_id"):
        rdata.pop("page_ranges", None)
        return
    page_count = _pdf_document_page_count(db, rdata["document_id"])
    rdata["page_ranges"] = _validate_page_ranges(ref.get("page_ranges"), page_count)


def _validate_field_values_page_ranges(db, field_values: dict) -> None:
    """Validate page_ranges of every reference in a draft's field_values.
    Mirrors approve-time _apply_page_ranges_to_rdata; raises on invalid range
    so the draft save (autosave) rejects it immediately.
    """
    for ref in (field_values or {}).get("references") or []:
        if not isinstance(ref, dict):
            continue
        doc_id = ref.get("document_id")
        if not doc_id:
            ref.pop("page_ranges", None)  # dosyasız ref → aralık anlamsız
            continue
        page_count = _pdf_document_page_count(db, doc_id)
        ref["page_ranges"] = _validate_page_ranges(ref.get("page_ranges"), page_count)


def _generate_and_store_docx(
    db,
    draft: dict,
    *,
    user_id: str,
    snapshot_reason: Optional[str] = None,
) -> dict:
    """Build docx + reference bundle PDF, upload, update draft paths."""
    draft_repo = DocumentDraftRepository(db)
    template = None
    if draft.get("template_id"):
        template = DocumentTemplateRepository(db).get(draft["template_id"])
    elif draft.get("document_templates"):
        template = draft["document_templates"]

    body_html = sanitize_body_html(draft.get("body_html") or "")
    field_values = draft.get("field_values") or {}

    if snapshot_reason in ("pre_generation", "approval"):
        draft_repo.create_version_snapshot(
            draft["id"],
            body_html,
            field_values,
            snapshot_reason if snapshot_reason != "approval" else "approval",
            user_id,
        )

    docx_bytes = build_docx(
        body_html=body_html,
        field_values=field_values,
        template=template,
    )
    filename = f"draft_{draft['id'][:8]}_{uuid.uuid4().hex[:8]}.docx"
    storage_path = upload_document(
        file_bytes=docx_bytes,
        file_name=filename,
        project_id=draft["project_id"],
        entity_type="draft",
        entity_id=draft["id"],
    )

    # Preview path (Null provider returns None — FE shows download-docx message)
    pdf_preview = get_render_provider().render_to_pdf(docx_bytes)

    # Reference copies are appended only when the user opted in (default true for
    # backward compatibility). Preference lives on the draft, so generate-docx and
    # approve both honor the same choice (decision: chosen once at generate time).
    include_copies = field_values.get("include_reference_copies", True)
    if not isinstance(include_copies, bool):
        include_copies = True

    bundle_path = None
    refs = field_values.get("references") or []
    if refs and include_copies:
        try:
            bundle_bytes = build_reference_bundle_pdf(
                db,
                project_id=draft["project_id"],
                references=refs,
                letter_pdf_bytes=pdf_preview,
            )
            if bundle_bytes:
                bundle_name = f"draft_{draft['id'][:8]}_{uuid.uuid4().hex[:8]}_bundle.pdf"
                bundle_path = upload_document(
                    file_bytes=bundle_bytes,
                    file_name=bundle_name,
                    project_id=draft["project_id"],
                    entity_type="draft",
                    entity_id=draft["id"],
                )
        except Exception as exc:
            logger.error("Reference bundle build failed: %s", exc)

    patch = {"docx_path": storage_path, "bundle_pdf_path": bundle_path}
    updated = (
        db.table("document_drafts")
        .update(patch)
        .eq("id", draft["id"])
        .execute()
    )
    row = updated.data[0] if updated.data else {**draft, **patch}

    if snapshot_reason == "pre_generation":
        draft_repo.create_version_snapshot(
            draft["id"], body_html, field_values, "post_generation", user_id
        )

    row["_pdf_preview_available"] = pdf_preview is not None
    row["_bundle_available"] = bool(bundle_path)
    return row


def _attach_docx_to_entity(
    db,
    *,
    project_id: str,
    entity_type: str,
    entity_id: str,
    docx_path: str,
    user_id: str,
    original_filename: str,
) -> str:
    """Mirror documents.upload_pdf pending_record + attachment reference — JWT db."""
    # Copy: storage already holds the draft docx; re-upload under entity path
    file_bytes = download_document(docx_path)
    entity_path = upload_document(
        file_bytes=file_bytes,
        file_name=original_filename,
        project_id=project_id,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    doc_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    pending_record = {
        "id": doc_id,
        "project_id": project_id,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "original_filename": original_filename,
        "storage_path": entity_path,
        "file_size_bytes": len(file_bytes),
        # We produced this docx/bundle — its content is already known from our own
        # source (body_html / merged parts). Mark completed so the worker never
        # ships it to the external parser (LlamaParse). Data-egress control
        # (KVKK / ISO A.5.19-23 / SOC): no external re-parse of self-generated files.
        "parse_status": "completed",
        "created_by": user_id,
        "created_at": now,
        "updated_at": now,
    }
    db.table("pdf_document").insert(pending_record).execute()

    if entity_type == "rfi":
        db.table("rfi_references").insert({
            "owner_rfi_id": entity_id,
            "ref_type": "document",
            "document_id": doc_id,
            "ref_role": "attachment",
            "added_by": user_id,
        }).execute()
    elif entity_type == "correspondence":
        db.table("correspondence_references").insert({
            "correspondence_id": entity_id,
            "ref_type": "document",
            "document_id": doc_id,
            "ref_role": "attachment",
            "added_by": user_id,
        }).execute()
    return doc_id


# ── Templates ───────────────────────────────────────────────────────────────

@router.get("/templates")
def list_templates(
    project_id: UUID,
    doc_type: Optional[str] = Query(None),
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    return DocumentTemplateRepository(db).list_by_project(
        str(project_id), doc_type=doc_type
    )


@router.post("/templates", status_code=201)
def create_template(
    project_id: UUID,
    body: TemplateCreate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DocumentTemplateRepository(db)
    data = body.model_dump(mode="json", exclude_none=True)
    data["project_id"] = str(project_id)
    data["created_by"] = access["user"]["id"]
    if data.get("is_active"):
        # Deactivate peers first to satisfy partial unique index
        existing = repo.get_active(str(project_id), data["doc_type"])
        if existing:
            repo.update(existing["id"], {"is_active": False})
    tpl = repo.create(data)
    AuditService().log(
        action="create",
        entity_type="document_template",
        entity_id=tpl["id"],
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={"doc_type": tpl["doc_type"], "name": tpl["name"]},
    )
    return tpl


@router.patch("/templates/{template_id}")
def update_template(
    project_id: UUID,
    template_id: UUID,
    body: TemplateUpdate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DocumentTemplateRepository(db)
    tpl = repo.get_or_404(str(template_id))
    _assert_template_in_project(tpl, str(project_id))
    data = body.model_dump(mode="json", exclude_none=True)
    if data.get("is_active") is True:
        repo.deactivate_others(str(project_id), tpl["doc_type"], str(template_id))
    updated = repo.update(str(template_id), data)
    AuditService().log(
        action="update",
        entity_type="document_template",
        entity_id=str(template_id),
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value=data,
    )
    return updated


@router.post("/templates/{template_id}/chrome")
async def upload_template_chrome(
    project_id: UUID,
    template_id: UUID,
    slot: ChromeSlot = Form(...),
    file: UploadFile = File(...),
    access: dict = Depends(require_cm_role),
):
    """Header/footer/watermark image — PNG/JPEG + Pillow re-encode mandatory."""
    db = access["db"]
    repo = DocumentTemplateRepository(db)
    tpl = repo.get_or_404(str(template_id))
    _assert_template_in_project(tpl, str(project_id))

    raw = await file.read()
    try:
        clean_bytes, ext = reencode_chrome_image(raw)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc

    filename = f"{slot}_{uuid.uuid4().hex[:8]}.{ext}"
    try:
        path = upload_document(
            file_bytes=clean_bytes,
            file_name=filename,
            project_id=str(project_id),
            entity_type="template",
            entity_id=str(template_id),
        )
    except (ValueError, RuntimeError) as exc:
        raise ValidationError(str(exc)) from exc

    col = {
        "header": "header_image_path",
        "footer": "footer_image_path",
        "watermark": "watermark_image_path",
    }[slot]
    updated = repo.update(str(template_id), {col: path})
    return updated


# ── Linkable references (authoring picker) ──────────────────────────────────

@router.get("/linkable-references")
def list_authoring_linkable_references(
    project_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """RFI + Corr + filed contract documents + amendments for draft references.

    Distinct from chronologies/linkable-documents (RFI+Corr only). Contract /
    amendment items use pdf_document id as ``id`` (stored as reference
    document_id). File-less rows are omitted.
    """
    db = access["db"]
    return list_linkable_documents(
        db, str(project_id), include_contract_instruments=True
    )


# ── Drafts ──────────────────────────────────────────────────────────────────

@router.get("/drafts")
def list_drafts(
    project_id: UUID,
    status: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    return DocumentDraftRepository(db).list_by_project(
        str(project_id),
        status=status,
        doc_type=doc_type,
        limit=limit,
        offset=offset,
    )


@router.post("/drafts", status_code=201)
def create_draft(
    project_id: UUID,
    body: DraftCreate,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    draft_repo = DocumentDraftRepository(db)
    tpl_repo = DocumentTemplateRepository(db)

    template_id = str(body.template_id) if body.template_id else None
    if not template_id:
        active = tpl_repo.get_active(str(project_id), body.doc_type)
        template_id = active["id"] if active else None

    autofilled = _autofill_fields(db, str(project_id))
    # User-supplied field_values overlay autofill (references stay user-picked)
    merged = {**autofilled, **(body.field_values or {})}
    if "references" not in (body.field_values or {}):
        merged["references"] = []

    data = {
        "project_id": str(project_id),
        "doc_type": body.doc_type,
        "template_id": template_id,
        "subject": body.subject,
        "body_html": sanitize_body_html(body.body_html or ""),
        "field_values": merged,
        "status": "drafting",
        "created_by": access["user"]["id"],
        "version": 1,
    }
    draft = draft_repo.create(data)

    # Server-written provenance for each autofilled field (no content)
    for field_name in ("project", "attention_to"):
        if autofilled.get(field_name):
            draft_repo.add_provenance(
                draft["id"],
                "field_autofilled",
                target=field_name,
                actor_user_id=access["user"]["id"],
                metadata={"source": "server_autofill"},
            )

    AuditService().log(
        action="create",
        entity_type="document_draft",
        entity_id=draft["id"],
        user_id=access["user"]["id"],
        project_id=str(project_id),
        new_value={"doc_type": draft["doc_type"]},
    )
    return draft


@router.get("/drafts/{draft_id}")
def get_draft(
    project_id: UUID,
    draft_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    draft = DocumentDraftRepository(db).get_with_template(str(draft_id))
    if not draft:
        raise NotFoundError()
    _assert_draft_in_project(draft, str(project_id))
    return draft


@router.patch("/drafts/{draft_id}")
def update_draft(
    project_id: UUID,
    draft_id: UUID,
    body: DraftUpdate,
    access: dict = Depends(require_cm_role),
):
    """Autosave with optimistic concurrency on version → 409 on conflict."""
    db = access["db"]
    repo = DocumentDraftRepository(db)
    old = repo.get_or_404(str(draft_id))
    _assert_draft_in_project(old, str(project_id))
    if old.get("status") != "drafting":
        raise ConflictError("Onaylanmış veya iptal edilmiş taslak güncellenemez.")

    data = body.model_dump(mode="json", exclude_none=True)
    expected = data.pop("version")
    if "body_html" in data:
        data["body_html"] = sanitize_body_html(data["body_html"])
    # Kusur A: page_ranges'i approve'a kadar bekletmeden, autosave/draft anında
    # doğrula — geçersiz aralık draft'a bile yazılamaz (FE anında 400 alır).
    if "field_values" in data:
        _validate_field_values_page_ranges(db, data["field_values"])

    updated = repo.update_with_version_check(str(draft_id), data, expected)
    if not updated:
        raise RaceConditionError()

    # Attribution events (no content) when body/fields change
    if "body_html" in data:
        repo.add_provenance(
            str(draft_id),
            "body_user_edit",
            actor_user_id=access["user"]["id"],
            metadata={"version": updated["version"]},
        )
    if "field_values" in data:
        repo.add_provenance(
            str(draft_id),
            "field_edited",
            actor_user_id=access["user"]["id"],
            metadata={"version": updated["version"]},
        )
    return updated


@router.post("/drafts/{draft_id}/ai-draft")
@limiter.limit("10/minute")
def generate_ai_draft(
    request: Request,
    project_id: UUID,
    draft_id: UUID,
    user_instructions: str = "",
    language: str = Query("en", enum=["en", "ar", "tr"]),
    version: int = Query(...),
    access: dict = Depends(require_cm_role),
):
    """C2-A: LLM draft → replace body_html. Mask+gate via generate_correspondence_draft."""
    db = access["db"]
    user_id = access["user"]["id"]
    repo = DocumentDraftRepository(db)
    draft = repo.get_or_404(str(draft_id))
    _assert_draft_in_project(draft, str(project_id))
    if draft.get("status") != "drafting":
        raise ConflictError("Onaylanmış veya iptal edilmiş taslak güncellenemez.")

    field_values = draft.get("field_values") or {}
    previous_body = draft.get("body_html") or ""

    # DATA MINIMIZATION: only fields the model needs — never the whole project row.
    project = (
        db.table("projects")
        .select("name, contract_type")
        .eq("id", str(project_id))
        .single()
        .execute()
    )
    row = project.data or {}
    project_context = {
        "name": row.get("name"),
        "contract_type": row.get("contract_type"),
    }

    ai = get_ai_service(db)
    result = ai.generate_correspondence_draft(
        correspondence_type=draft["doc_type"],
        project_context=project_context,
        clause_references=[],
        user_instructions=sanitize_user_input(user_instructions or ""),
        language=language,
        project_id=str(project_id),
        user_id=user_id,
        entity_id=str(draft_id),
    )

    if isinstance(result, GateBlockedResult):
        raise HTTPException(
            status_code=422,
            detail=result.warning_message,
        )

    body_html = _plaintext_to_body_html(result.draft_text)
    updated = repo.update_with_version_check(
        str(draft_id),
        {"body_html": body_html},
        version,
    )
    if not updated:
        raise RaceConditionError()

    # Snapshots are written only AFTER a successful body replace: a 409, a gate
    # block, or an LLM abort all occur earlier and leave zero orphan version rows.
    # pre carries the previous body (undo point), post carries the new body;
    # inserted in this order so created_at keeps pre before post.
    repo.create_version_snapshot(
        str(draft_id),
        previous_body,
        field_values,
        "pre_ai_draft",
        user_id,
    )
    repo.create_version_snapshot(
        str(draft_id),
        body_html,
        field_values,
        "post_ai_draft",
        user_id,
    )
    repo.add_provenance(
        str(draft_id),
        "llm_generation",
        target="body",
        actor_user_id=user_id,
        llm_role="qualified",
        metadata={
            "version": updated["version"],
            "review_required": result.review_required,
            "objectivity_flag": result.objectivity_flag,
            "resolved_by_gate": result.resolved_by_gate,
            "confidence_score": result.confidence_score,
        },
    )

    return {
        "body_html": body_html,
        "version": updated["version"],
        "confidence_score": result.confidence_score,
        "warnings": result.warnings,
        "review_required": result.review_required,
        "objectivity_flag": result.objectivity_flag,
    }


@router.post("/drafts/{draft_id}/ai-chat")
@limiter.limit("10/minute")
def generate_ai_chat(
    request: Request,
    project_id: UUID,
    draft_id: UUID,
    body: AiChatRequest,
    access: dict = Depends(require_cm_role),
):
    """C2-B: multi-turn chat revise. Server does not write body_html — FE applies reply."""
    db = access["db"]
    user_id = access["user"]["id"]
    repo = DocumentDraftRepository(db)
    draft = repo.get_or_404(str(draft_id))
    _assert_draft_in_project(draft, str(project_id))
    if draft.get("status") != "drafting":
        raise ConflictError("Onaylanmış veya iptal edilmiş taslak güncellenemez.")

    field_values = draft.get("field_values") or {}
    current_body = draft.get("body_html") or ""

    # DATA MINIMIZATION: only fields the model needs — never the whole project row.
    project = (
        db.table("projects")
        .select("name, contract_type")
        .eq("id", str(project_id))
        .single()
        .execute()
    )
    row = project.data or {}
    project_context = {
        "name": row.get("name"),
        "contract_type": row.get("contract_type"),
    }

    messages = [
        {"role": m.role, "content": m.content}
        for m in (body.messages or [])
    ]
    selection = sanitize_user_input(body.selection_text) if body.selection_text else None

    ai = get_ai_service(db)
    result = ai.generate_chat_turn(
        messages=messages,
        current_body=current_body,
        correspondence_type=draft["doc_type"],
        project_context=project_context,
        language=body.language,
        selection_text=selection,
        project_id=str(project_id),
        user_id=user_id,
        entity_id=str(draft_id),
    )

    if isinstance(result, GateBlockedResult):
        raise HTTPException(
            status_code=422,
            detail=result.warning_message,
        )

    # Undo anchor only — body is not replaced here; FE applies reply_text via autosave.
    repo.create_version_snapshot(
        str(draft_id),
        current_body,
        field_values,
        "pre_ai_draft",
        user_id,
    )
    repo.add_provenance(
        str(draft_id),
        "llm_generation",
        target="selection" if selection else "body",
        actor_user_id=user_id,
        llm_role="qualified",
        metadata={
            "version": body.version,
            "review_required": result.review_required,
            "objectivity_flag": result.objectivity_flag,
            "resolved_by_gate": result.resolved_by_gate,
            "confidence_score": result.confidence_score,
        },
    )

    return {
        "reply_text": result.draft_text,
        "confidence_score": result.confidence_score,
        "warnings": result.warnings,
        "review_required": result.review_required,
        "objectivity_flag": result.objectivity_flag,
    }


@router.post("/drafts/{draft_id}/snapshot", status_code=201)
def snapshot_draft(
    project_id: UUID,
    draft_id: UUID,
    body: DraftSnapshot,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DocumentDraftRepository(db)
    draft = repo.get_or_404(str(draft_id))
    _assert_draft_in_project(draft, str(project_id))
    snap = repo.create_version_snapshot(
        str(draft_id),
        sanitize_body_html(draft.get("body_html") or ""),
        draft.get("field_values") or {},
        body.snapshot_reason,
        access["user"]["id"],
    )
    return snap


@router.post("/drafts/{draft_id}/reference-files", status_code=201)
@limiter.limit("20/minute")
async def upload_draft_reference_file(
    request: Request,
    project_id: UUID,
    draft_id: UUID,
    file: UploadFile = File(...),
    access: dict = Depends(require_cm_role),
):
    """Upload primary file for a manual authoring reference (entity_type=draft)."""
    db = access["db"]
    draft = DocumentDraftRepository(db).get_or_404(str(draft_id))
    _assert_draft_in_project(draft, str(project_id))
    if draft.get("status") != "drafting":
        raise ConflictError("Yalnızca drafting taslağa referans dosyası yüklenebilir.")

    file_bytes = await file.read()
    original_name = file.filename or "upload.pdf"
    # Unique storage key; keep original_filename on pdf_document for display.
    storage_name = f"{uuid.uuid4().hex[:8]}_{original_name}"
    try:
        validate_document_bytes(file_bytes, original_name)
        storage_path = upload_document(
            file_bytes=file_bytes,
            file_name=storage_name,
            project_id=str(project_id),
            entity_type="draft",
            entity_id=str(draft_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    doc_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    pending_record = {
        "id": doc_id,
        "project_id": str(project_id),
        "entity_type": "draft",
        "entity_id": str(draft_id),
        "original_filename": original_name,
        "storage_path": storage_path,
        "file_size_bytes": len(file_bytes),
        "parse_status": "pending",
        "created_by": access["user"]["id"],
        "created_at": now,
        "updated_at": now,
    }
    db.table("pdf_document").insert(pending_record).execute()
    return {"doc_id": doc_id, "original_filename": original_name}


@router.post("/drafts/{draft_id}/generate-docx")
def generate_docx(
    project_id: UUID,
    draft_id: UUID,
    body: GenerateDocxRequest,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DocumentDraftRepository(db)
    draft = repo.get_with_template(str(draft_id))
    if not draft:
        raise NotFoundError()
    _assert_draft_in_project(draft, str(project_id))

    # Persist opt-in on draft so approve uses the same choice (field_values JSON).
    fv = dict(draft.get("field_values") or {})
    fv["include_reference_copies"] = body.include_reference_copies
    repo.update(str(draft_id), {"field_values": fv})
    draft = {**draft, "field_values": fv}

    result = _generate_and_store_docx(
        db, draft, user_id=access["user"]["id"], snapshot_reason="pre_generation"
    )
    return {
        "draft": {k: v for k, v in result.items() if not k.startswith("_")},
        "docx_path": result.get("docx_path"),
        "bundle_pdf_path": result.get("bundle_pdf_path"),
        "pdf_preview_available": result.get("_pdf_preview_available", False),
        "bundle_available": result.get("_bundle_available", False),
    }


@router.get("/drafts/{draft_id}/docx-url")
def draft_docx_url(
    project_id: UUID,
    draft_id: UUID,
    expires_in: int = Query(3600, le=86400),
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    draft = DocumentDraftRepository(db).get_or_404(str(draft_id))
    _assert_draft_in_project(draft, str(project_id))
    path = draft.get("docx_path")
    if not path:
        raise NotFoundError("DOCX henüz üretilmedi.")
    try:
        url = get_signed_url(path, expires_in=expires_in)
    except RuntimeError as exc:
        raise ValidationError(str(exc)) from exc
    return {"draft_id": str(draft_id), "signed_url": url, "expires_in": expires_in}


@router.get("/drafts/{draft_id}/bundle-url")
def draft_bundle_url(
    project_id: UUID,
    draft_id: UUID,
    expires_in: int = Query(3600, le=86400),
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    draft = DocumentDraftRepository(db).get_or_404(str(draft_id))
    _assert_draft_in_project(draft, str(project_id))
    path = draft.get("bundle_pdf_path")
    if not path:
        raise NotFoundError("Referans e-bundle henüz üretilmedi.")
    try:
        url = get_signed_url(path, expires_in=expires_in)
    except RuntimeError as exc:
        raise ValidationError(str(exc)) from exc
    return {"draft_id": str(draft_id), "signed_url": url, "expires_in": expires_in}


@router.get("/drafts/{draft_id}/preview")
def preview_draft(
    project_id: UUID,
    draft_id: UUID,
    access: dict = Depends(verify_project_access),
):
    """PDF preview of the draft DOCX via configured render provider."""
    db = access["db"]
    draft = DocumentDraftRepository(db).get_with_template(str(draft_id))
    if not draft:
        raise NotFoundError()
    _assert_draft_in_project(draft, str(project_id))

    docx_bytes: Optional[bytes] = None
    path = draft.get("docx_path")
    if path:
        try:
            docx_bytes = download_document(path)
        except RuntimeError:
            docx_bytes = None

    if docx_bytes is None:
        template = None
        if draft.get("template_id"):
            template = DocumentTemplateRepository(db).get(draft["template_id"])
        elif draft.get("document_templates"):
            template = draft["document_templates"]
        docx_bytes = build_docx(
            body_html=sanitize_body_html(draft.get("body_html") or ""),
            field_values=draft.get("field_values") or {},
            template=template,
        )

    pdf_bytes = get_render_provider().render_to_pdf(docx_bytes)
    if pdf_bytes is None:
        return JSONResponse(
            status_code=501,
            content={"detail": "Preview unavailable — download the .docx"},
        )
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
    )


@router.get("/drafts/{draft_id}/provenance")
def list_provenance(
    project_id: UUID,
    draft_id: UUID,
    access: dict = Depends(verify_project_access),
):
    db = access["db"]
    draft = DocumentDraftRepository(db).get_or_404(str(draft_id))
    _assert_draft_in_project(draft, str(project_id))
    return DocumentDraftRepository(db).list_provenance(str(draft_id))


@router.post("/drafts/{draft_id}/approve")
def approve_draft(
    project_id: UUID,
    draft_id: UUID,
    body: DraftApprove,
    access: dict = Depends(require_cm_role),
):
    """Snapshot → docx → materialize via existing RFI/corr create path → provenance.

    Does NOT add a second lifecycle gate: materialized RFI stays draft (authored);
    correspondence stays draft until its own submit-for-approval/approve/publish.
    """
    db = access["db"]
    draft_repo = DocumentDraftRepository(db)
    draft = draft_repo.get_with_template(str(draft_id))
    if not draft:
        raise NotFoundError()
    _assert_draft_in_project(draft, str(project_id))

    if draft.get("status") != "drafting":
        raise ConflictError("Taslak zaten onaylanmış veya iptal edilmiş.")

    # Optimistic lock on version before mutating
    locked = draft_repo.update_with_version_check(
        str(draft_id),
        {},  # bump version only; status set after materialize
        body.version,
    )
    if not locked:
        raise RaceConditionError()
    draft = {**draft, **locked}

    # 2–3. Snapshot (approval) + generate docx
    result = _generate_and_store_docx(
        db, draft, user_id=access["user"]["id"], snapshot_reason="approval"
    )
    draft = {
        **draft,
        "docx_path": result.get("docx_path"),
        "bundle_pdf_path": result.get("bundle_pdf_path"),
    }

    subject = draft.get("subject") or "Untitled"
    fv = draft.get("field_values") or {}
    user_id = access["user"]["id"]
    pid = str(project_id)

    parent_id, relation = _resolve_chain_link(
        doc_type=draft["doc_type"],
        body_parent_id=body.parent_id,
        body_relation=body.relation,
        field_values=fv,
    )

    # 4. Materialize — mirror create_rfi / create_correspondence field construction
    if draft["doc_type"] == "rfi":
        rfi_repo = RFIRepository(db)
        rfi_type = relation if relation in ("response", "revision") else "original"
        if parent_id:
            parent_rfi = rfi_repo.get(str(parent_id))
            if not parent_rfi or parent_rfi.get("project_id") != pid:
                raise HTTPException(403, "Geçersiz parent_id")
        rfi_data = {
            "project_id": pid,
            "rfi_number": body.document_number,
            "subject": subject,
            "description": None,
            "discipline": body.discipline,
            "entry_mode": "authored",
            "status": "draft",
            "rfi_type": rfi_type,
            "created_by": user_id,
        }
        if parent_id:
            rfi_data["parent_id"] = str(parent_id)
        entity = rfi_repo.create(rfi_data)
        entity_type = "rfi"
        # Authored draft child must NOT flip parent status (create_rfi parity).
        # Attach user-picked references — IDOR guards mirror create_rfi
        for ref in fv.get("references") or []:
            if not isinstance(ref, dict):
                continue
            if ref.get("rfi_id"):
                assert_target_in_project(db, "rfis", ref["rfi_id"], project_id)
            if ref.get("ref_corr_id"):
                assert_target_in_project(db, "correspondences", ref["ref_corr_id"], project_id)
            if ref.get("change_id"):
                assert_target_in_project(db, "changes", ref["change_id"], project_id)
            if ref.get("document_id"):
                assert_target_in_project(db, "pdf_document", ref["document_id"], project_id)
                assert_document_not_already_linked(
                    db, "rfi_references", "owner_rfi_id", entity["id"], ref["document_id"]
                )
            rdata = _strip_ref_ui_keys(ref)
            rdata["owner_rfi_id"] = entity["id"]
            rdata["added_by"] = user_id
            if "external_doc_date" in rdata:
                rdata["external_doc_date"] = str(rdata["external_doc_date"])
            _apply_page_ranges_to_rdata(db, ref, rdata)
            if rdata.get("document_id"):
                db.table("pdf_document").update({
                    "entity_type": "rfi",
                    "entity_id": entity["id"],
                    # Approved now → release the user-attached reference file to the parse
                    # queue (draft guard no longer applies once re-parented).
                    "parse_status": "pending",
                }).eq("id", rdata["document_id"]).eq(
                    "entity_type", "draft"
                ).eq("entity_id", str(draft_id)).execute()
            db.table("rfi_references").insert(rdata).execute()
    else:
        corr_repo = CorrespondenceRepository(db)
        corr_date = body.correspondence_date or date.today()
        if parent_id:
            parent_corr = corr_repo.get(str(parent_id))
            if not parent_corr or parent_corr.get("project_id") != pid:
                raise HTTPException(403, "Geçersiz parent_id")
            if relation not in ("response", "followup"):
                raise ValidationError("Geçersiz correspondence relation.")
        corr_data = {
            "project_id": pid,
            "corr_number": body.document_number,
            "direction": body.direction or "outgoing",
            "type": body.corr_type or "letter",
            "subject": subject,
            "correspondence_date": str(corr_date),
            "entry_mode": "authored",
            "status": "draft",
            "created_by": user_id,
        }
        if parent_id:
            corr_data["parent_id"] = str(parent_id)
        entity = corr_repo.create(corr_data)
        entity_type = "correspondence"
        # Mirror create_correspondence parent side-effect (Register parity).
        if parent_id:
            corr_repo.update_parent_response_status(
                parent_id=str(parent_id),
                response_corr_id=entity["id"],
            )
        # Same IDOR guard set as create_rfi; owner table = correspondence_references
        for ref in fv.get("references") or []:
            if not isinstance(ref, dict):
                continue
            if ref.get("rfi_id"):
                assert_target_in_project(db, "rfis", ref["rfi_id"], project_id)
            if ref.get("ref_corr_id"):
                assert_target_in_project(db, "correspondences", ref["ref_corr_id"], project_id)
            if ref.get("change_id"):
                assert_target_in_project(db, "changes", ref["change_id"], project_id)
            if ref.get("document_id"):
                assert_target_in_project(db, "pdf_document", ref["document_id"], project_id)
                assert_document_not_already_linked(
                    db, "correspondence_references", "correspondence_id", entity["id"], ref["document_id"]
                )
            rdata = _strip_ref_ui_keys(ref)
            rdata["correspondence_id"] = entity["id"]
            rdata["added_by"] = user_id
            if "external_doc_date" in rdata:
                rdata["external_doc_date"] = str(rdata["external_doc_date"])
            _apply_page_ranges_to_rdata(db, ref, rdata)
            if rdata.get("document_id"):
                db.table("pdf_document").update({
                    "entity_type": "correspondence",
                    "entity_id": entity["id"],
                    # Approved now → release the user-attached reference file to the parse
                    # queue (draft guard no longer applies once re-parented).
                    "parse_status": "pending",
                }).eq("id", rdata["document_id"]).eq(
                    "entity_type", "draft"
                ).eq("entity_id", str(draft_id)).execute()
            db.table("correspondence_references").insert(rdata).execute()

    # Attach generated docx via pdf_document + Storage pattern
    if draft.get("docx_path"):
        try:
            _attach_docx_to_entity(
                db,
                project_id=pid,
                entity_type=entity_type,
                entity_id=entity["id"],
                docx_path=draft["docx_path"],
                user_id=user_id,
                original_filename=f"{body.document_number}.docx",
            )
        except Exception as exc:
            logger.error("DOCX attachment failed after materialize: %s", exc)

    if draft.get("bundle_pdf_path"):
        try:
            _attach_docx_to_entity(
                db,
                project_id=pid,
                entity_type=entity_type,
                entity_id=entity["id"],
                docx_path=draft["bundle_pdf_path"],
                user_id=user_id,
                original_filename=f"{body.document_number}_references_bundle.pdf",
            )
        except Exception as exc:
            logger.error("Bundle PDF attachment failed after materialize: %s", exc)

    # 5. Update draft status
    now = datetime.now(timezone.utc).isoformat()
    approved = draft_repo.update(str(draft_id), {
        "status": "approved",
        "materialized_entity_type": entity_type,
        "materialized_entity_id": entity["id"],
        "approved_by": user_id,
        "approved_at": now,
        "docx_path": draft.get("docx_path"),
    })

    # 6. Provenance + audit (no content)
    draft_repo.add_provenance(
        str(draft_id),
        "approval",
        actor_user_id=user_id,
        metadata={
            "materialized_entity_type": entity_type,
            "materialized_entity_id": entity["id"],
            "parent_id": str(parent_id) if parent_id else None,
            "relation": relation,
        },
    )
    AuditService().log(
        action="approve",
        entity_type="document_draft",
        entity_id=str(draft_id),
        user_id=user_id,
        project_id=pid,
        new_value={
            "materialized_entity_type": entity_type,
            "materialized_entity_id": entity["id"],
            "parent_id": str(parent_id) if parent_id else None,
            "relation": relation,
        },
    )
    return {
        "draft": approved,
        "materialized": entity,
        "entity_type": entity_type,
    }
