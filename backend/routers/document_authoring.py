"""Document authoring router — templates, drafts, docx, approve/materialize.

Prefix: /projects/{project_id}/authoring
Auth: verify_project_access (reads) / require_cm_role (writes).
All DB I/O via access["db"] — no admin_client here (AuditService + file_handler excepted).
"""
import logging
import uuid
from datetime import date, datetime, timezone
# uuid used for docx filenames + pdf_document ids
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from backend.core.dependencies import require_cm_role, verify_project_access
from backend.core.exceptions import ConflictError, NotFoundError, RaceConditionError, ValidationError
from backend.core.guards import assert_target_in_project, assert_document_not_already_linked
from backend.core.html_sanitizer import sanitize_body_html
from backend.models.document_authoring import (
    DraftApprove,
    DraftCreate,
    DraftSnapshot,
    DraftUpdate,
    TemplateCreate,
    TemplateUpdate,
)
from backend.repositories.contract_repository import ContractRepository
from backend.repositories.correspondence_repository import CorrespondenceRepository
from backend.repositories.document_draft_repository import DocumentDraftRepository
from backend.repositories.document_template_repository import DocumentTemplateRepository
from backend.repositories.rfi_repository import RFIRepository
from backend.services.audit_service import AuditService
from backend.services.docx_builder import build_docx
from backend.services.image_sanitize import reencode_chrome_image
from backend.services.render_provider import get_render_provider
from backend.utils.file_handler import get_signed_url, upload_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/authoring", tags=["authoring"])

ChromeSlot = Literal["header", "footer", "watermark"]


def _assert_draft_in_project(draft: dict, project_id: str) -> None:
    if draft.get("project_id") != str(project_id):
        raise NotFoundError()


def _assert_template_in_project(tpl: dict, project_id: str) -> None:
    if tpl.get("project_id") != str(project_id):
        raise NotFoundError()


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


def _generate_and_store_docx(
    db,
    draft: dict,
    *,
    user_id: str,
    snapshot_reason: Optional[str] = None,
) -> dict:
    """Build docx, upload to Storage, update draft.docx_path. Returns updated draft."""
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

    updated = (
        db.table("document_drafts")
        .update({"docx_path": storage_path})
        .eq("id", draft["id"])
        .execute()
    )
    row = updated.data[0] if updated.data else {**draft, "docx_path": storage_path}

    if snapshot_reason == "pre_generation":
        draft_repo.create_version_snapshot(
            draft["id"], body_html, field_values, "post_generation", user_id
        )

    row["_pdf_preview_available"] = pdf_preview is not None
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
    from backend.utils.file_handler import download_document

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
        "parse_status": "pending",
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


@router.post("/drafts/{draft_id}/generate-docx")
def generate_docx(
    project_id: UUID,
    draft_id: UUID,
    access: dict = Depends(require_cm_role),
):
    db = access["db"]
    repo = DocumentDraftRepository(db)
    draft = repo.get_with_template(str(draft_id))
    if not draft:
        raise NotFoundError()
    _assert_draft_in_project(draft, str(project_id))
    result = _generate_and_store_docx(
        db, draft, user_id=access["user"]["id"], snapshot_reason="pre_generation"
    )
    return {
        "draft": {k: v for k, v in result.items() if not k.startswith("_")},
        "docx_path": result.get("docx_path"),
        "pdf_preview_available": result.get("_pdf_preview_available", False),
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
    draft = {**draft, "docx_path": result.get("docx_path")}

    subject = draft.get("subject") or "Untitled"
    fv = draft.get("field_values") or {}
    user_id = access["user"]["id"]
    pid = str(project_id)

    # 4. Materialize — mirror create_rfi / create_correspondence field construction
    if draft["doc_type"] == "rfi":
        rfi_repo = RFIRepository(db)
        rfi_data = {
            "project_id": pid,
            "rfi_number": body.document_number,
            "subject": subject,
            "description": None,
            "discipline": body.discipline,
            "entry_mode": "authored",
            "status": "draft",
            "rfi_type": "original",
            "created_by": user_id,
        }
        entity = rfi_repo.create(rfi_data)
        entity_type = "rfi"
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
            rdata = {k: v for k, v in ref.items() if k != "_display" and v is not None}
            rdata["owner_rfi_id"] = entity["id"]
            rdata["added_by"] = user_id
            if "external_doc_date" in rdata:
                rdata["external_doc_date"] = str(rdata["external_doc_date"])
            db.table("rfi_references").insert(rdata).execute()
    else:
        corr_repo = CorrespondenceRepository(db)
        corr_date = body.correspondence_date or date.today()
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
        entity = corr_repo.create(corr_data)
        entity_type = "correspondence"
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
            rdata = {k: v for k, v in ref.items() if k != "_display" and v is not None}
            rdata["correspondence_id"] = entity["id"]
            rdata["added_by"] = user_id
            if "external_doc_date" in rdata:
                rdata["external_doc_date"] = str(rdata["external_doc_date"])
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
        },
    )
    return {
        "draft": approved,
        "materialized": entity,
        "entity_type": entity_type,
    }
