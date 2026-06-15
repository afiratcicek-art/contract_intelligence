"""PDF belge yükleme ve yönetim endpoint'leri.

Tüm route'lar /projects/{project_id}/documents altında toplanır.
entity_type parametresi ile aynı endpoint RFI, correspondence,
change, deliverable, chronology ve contract_document entity'lerine
belge ekleyebilir.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request

from backend.core.dependencies import verify_project_access
from backend.core.limiter import limiter
from backend.database import get_db
from backend.services.pdf_pipeline_service import PDFPipelineService
from backend.services.permission_service import PermissionService
from backend.utils.file_handler import upload_document, get_signed_url

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/projects/{project_id}/documents",
    tags=["documents"],
)

VALID_ENTITY_TYPES = {
    "correspondence",
    "rfi",
    "change",
    "deliverable",
    "chronology",
    "contract_document",
}


# ----------------------------------------------------------
# POST /projects/{project_id}/documents/upload
# ----------------------------------------------------------
@router.post("/upload", status_code=201)
@limiter.limit("20/minute")
def upload_pdf(
    request: Request,
    project_id: str,
    entity_type: str = Query(..., description="correspondence | rfi | change | deliverable | chronology | contract_document"),
    entity_id: str = Query(..., description="Belgenin bağlı olduğu kaydın UUID'si. contract_document için project_id ile aynı olmalı."),
    file: UploadFile = File(...),
    db=Depends(get_db),
    access=Depends(verify_project_access),
):
    """
    PDF yükler, parse eder, pdf_document tablosuna kaydeder.
    Yalnızca .pdf uzantılı dosyalar kabul edilir.
    Yanıtta extracted_text dönmez — GET /documents/{doc_id}/text ile alınır.
    contract_document için entity_id, project_id ile aynı olmalıdır.
    """
    user_id = str(access["user"]["id"])

    # entity_type doğrulama
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Geçersiz entity_type. İzin verilenler: {sorted(VALID_ENTITY_TYPES)}",
        )

    # contract_document özel guard — entity_id project_id ile aynı olmalı
    if entity_type == "contract_document" and entity_id != project_id:
        raise HTTPException(
            status_code=400,
            detail="contract_document için entity_id, project_id ile aynı olmalıdır.",
        )

    # İzin kontrolü — entity_type bazlı, edit yetkisi gerekli
    PermissionService(db).require(
        user_id=user_id,
        project_id=project_id,
        entity_type=entity_type,
        permission="edit",
    )

    # Dosya bytes'ını oku
    file_bytes = file.file.read()
    filename = file.filename or "upload.pdf"

    # Storage'a yükle
    try:
        storage_path = upload_document(
            file_bytes=file_bytes,
            file_name=filename,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # PDF pipeline — parse et, veritabanına yaz
    try:
        pipeline = PDFPipelineService(db=db)
        record = pipeline.process(
            file_bytes=file_bytes,
            filename=filename,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
            user_id=user_id,
            storage_path=storage_path,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # extracted_text yanıtta dönmez
    record.pop("extracted_text", None)
    return record


# ----------------------------------------------------------
# GET /projects/{project_id}/documents
# ----------------------------------------------------------
@router.get("/", status_code=200)
def list_documents(
    project_id: str,
    entity_type: str = Query(None),
    entity_id: str = Query(None),
    db=Depends(get_db),
    access=Depends(verify_project_access),
):
    """
    Projeye ait PDF belgelerini listeler.
    entity_type ve entity_id ile filtreleme yapılabilir.
    extracted_text döndürülmez.
    """
    try:
        query = (
            db.table("pdf_document")
            .select(
                "id, project_id, entity_type, entity_id, "
                "original_filename, storage_path, file_size_bytes, "
                "parse_method, parse_status, page_count, quality_score, "
                "parse_error, created_by, created_at, updated_at"
            )
            .eq("project_id", project_id)
            .order("created_at", desc=True)
        )
        if entity_type:
            query = query.eq("entity_type", entity_type)
        if entity_id:
            query = query.eq("entity_id", entity_id)

        result = query.execute()
        return result.data or []
    except Exception as exc:
        logger.error("Belge listesi hatası: %s | project=%s", exc, project_id)
        raise HTTPException(status_code=500, detail="Belgeler alınamadı.")


# ----------------------------------------------------------
# GET /projects/{project_id}/documents/{doc_id}
# ----------------------------------------------------------
@router.get("/{doc_id}", status_code=200)
def get_document(
    project_id: str,
    doc_id: str,
    db=Depends(get_db),
    access=Depends(verify_project_access),
):
    """
    Tek belge metadata'sını döndürür. extracted_text dahil değil.
    """
    try:
        result = (
            db.table("pdf_document")
            .select(
                "id, project_id, entity_type, entity_id, "
                "original_filename, storage_path, file_size_bytes, "
                "parse_method, parse_status, page_count, quality_score, "
                "parse_error, created_by, created_at, updated_at"
            )
            .eq("id", doc_id)
            .eq("project_id", project_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Belge bulunamadı.")
        return result.data
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Belge getirme hatası: %s | id=%s", exc, doc_id)
        raise HTTPException(status_code=500, detail="Belge alınamadı.")


# ----------------------------------------------------------
# GET /projects/{project_id}/documents/{doc_id}/text
# ----------------------------------------------------------
@router.get("/{doc_id}/text", status_code=200)
def get_document_text(
    project_id: str,
    doc_id: str,
    db=Depends(get_db),
    access=Depends(verify_project_access),
):
    """
    Parse edilmiş PDF'in temiz metnini döndürür.
    Yalnızca parse_status = completed olan belgeler için metin döner.
    claude_service'e göndermeden önce bu endpoint çağrılır.
    """
    pipeline = PDFPipelineService(db=db)
    text = pipeline.get_extracted_text(
        pdf_document_id=doc_id,
        project_id=project_id,
    )
    if text is None:
        raise HTTPException(
            status_code=404,
            detail="Metin bulunamadı veya parse henüz tamamlanmadı.",
        )
    return {"doc_id": doc_id, "text": text}


# ----------------------------------------------------------
# GET /projects/{project_id}/documents/{doc_id}/signed-url
# ----------------------------------------------------------
@router.get("/{doc_id}/signed-url", status_code=200)
def get_document_signed_url(
    project_id: str,
    doc_id: str,
    expires_in: int = Query(3600, ge=300, le=86400),
    db=Depends(get_db),
    access=Depends(verify_project_access),
):
    """
    Belge için geçici imzalı indirme URL'i üretir.
    expires_in: 300 (5 dk) ile 86400 (24 saat) arasında saniye cinsinden.
    """
    # Belgenin bu projeye ait olduğunu RLS + proje filtresi ile doğrula
    try:
        result = (
            db.table("pdf_document")
            .select("storage_path")
            .eq("id", doc_id)
            .eq("project_id", project_id)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Belge bulunamadı.")
        storage_path = result.data["storage_path"]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Storage path hatası: %s | id=%s", exc, doc_id)
        raise HTTPException(status_code=500, detail="Belge bilgisi alınamadı.")

    try:
        signed_url = get_signed_url(
            path=storage_path,
            expires_in=expires_in,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"doc_id": doc_id, "signed_url": signed_url, "expires_in": expires_in}
