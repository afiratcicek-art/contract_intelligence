"""PDF async parse worker.

Supabase pdf_document tablosunu poll eder.
parse_status = 'pending' olan kayıtları bulur, PDFPipelineService ile işler.

Çalıştırma:
    python -m backend.workers.pdf_worker

Ortam değişkenleri:
    POLL_INTERVAL_SECONDS  — kaç saniyede bir kontrol (varsayılan: 15)
    WORKER_BATCH_SIZE      — her turda kaç kayıt işlenir (varsayılan: 3)

# TECHNICAL DEBT: TD-001
# Worker tek process olarak çalışır. Eş zamanlı yoğun PDF yüklemesinde
# batch sıraya girer. Ölçekleme gerektiğinde worker sayısı artırılabilir
# veya Celery+Redis mimarisine geçilebilir.
"""
import logging
import os
import time
from datetime import datetime, timezone

from backend.database import get_admin_client, get_anon_client
from backend.services.audit_service import AuditService
from backend.services.pdf_pipeline_service import PDFPipelineService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

POLL_INTERVAL = int(os.getenv("POLL_INTERVAL_SECONDS", "15"))
BATCH_SIZE = int(os.getenv("WORKER_BATCH_SIZE", "3"))


def fetch_pending(admin_client) -> list[dict]:
    """parse_status = pending olan en eski BATCH_SIZE kaydı döndürür."""
    result = (
        admin_client.table("pdf_document")
        .select("*")
        .eq("parse_status", "pending")
        .order("created_at")
        .limit(BATCH_SIZE)
        .execute()
    )
    return result.data or []


def mark_processing(admin_client, doc_id: str) -> None:
    """Kaydı processing olarak işaretle — başka worker almasın."""
    admin_client.table("pdf_document").update({
        "parse_status": "processing",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", doc_id).eq("parse_status", "pending").execute()


def fetch_file_bytes(storage_path: str) -> bytes:
    """Storage'dan dosya byte'larını indir."""
    result = get_admin_client().storage.from_("documents").download(storage_path)
    return result


def process_one(record: dict) -> None:
    """Tek bir pending kaydı işler."""
    doc_id = record["id"]
    project_id = record["project_id"]
    user_id = record["created_by"]
    storage_path = record["storage_path"]
    filename = record["original_filename"]
    entity_type = record["entity_type"]
    entity_id = record["entity_id"]

    admin = get_admin_client()

    logger.info("İşleniyor: %s | %s", doc_id, filename)

    # Non-PDF guard — PyMuPDF only handles PDFs.
    # Non-PDF files (docx, xlsx, etc.) are stored but not parsed.
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext != "pdf":
        admin.table("pdf_document").update({
            "parse_status": "completed",
            "parse_method": "unsupported",
            "page_count": 0,
            "quality_score": 0.0,
            "extracted_text": "",
            "parse_error": f"Non-PDF file type (.{ext}) — stored only, not parsed.",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", doc_id).execute()
        logger.info("Non-PDF atlandı: %s | .%s", doc_id, ext)
        return

    # processing olarak işaretle
    mark_processing(admin, doc_id)

    # Storage'dan dosyayı indir
    try:
        file_bytes = fetch_file_bytes(storage_path)
    except Exception as exc:
        logger.error("Storage indirme hatası: %s | id=%s", exc, doc_id)
        admin.table("pdf_document").update({
            "parse_status": "failed",
            "parse_error": f"Storage indirme hatası: {exc}",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", doc_id).execute()
        return

    # PDF pipeline — parse et
    # db olarak anon client kullan; pipeline içindeki yazma işlemleri
    # zaten admin client singleton kullanıyor
    db = get_anon_client()

    try:
        pipeline = PDFPipelineService(db=db)

        # process() kendi persist işlemini yapıyor ancak doc_id'yi kendisi üretiyor.
        # Worker modunda mevcut doc_id'yi kullanmak için _persist metodlarını
        # doğrudan çağırıyoruz — process() yerine adım adım gidiyoruz.
        from backend.utils.pdf_utils import (
            classify_pages,
            clean_extracted_text,
            ParseStatus,
        )

        # ADIM 1 — Sayfa sınıflandırma
        quality = classify_pages(file_bytes)

        # ADIM 2 — Metin çıkarma
        raw_text = pipeline._extract_text(file_bytes, quality.recommended_method)

        # ADIM 3 — Metin temizleme
        clean_text = clean_extracted_text(raw_text)

        # ADIM 4 — Kaydı güncelle (insert değil update — kayıt zaten var)
        admin.table("pdf_document").update({
            "parse_status": ParseStatus.COMPLETED.value,
            "parse_method": quality.recommended_method.value,
            "page_count": quality.page_count,
            "quality_score": quality.quality_score,
            "extracted_text": clean_text,
            "parse_error": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", doc_id).execute()

        # Audit log
        AuditService().log(
            action="pdf_parse_complete",
            entity_type="pdf_document",
            entity_id=doc_id,
            user_id=user_id,
            project_id=project_id,
            new_value={
                "method": quality.recommended_method.value,
                "page_count": quality.page_count,
                "quality_score": quality.quality_score,
                "char_count": len(clean_text),
            },
        )

        logger.info(
            "Tamamlandı: %s | method=%s pages=%d score=%.3f chars=%d",
            doc_id,
            quality.recommended_method.value,
            quality.page_count,
            quality.quality_score,
            len(clean_text),
        )

    except Exception as exc:
        logger.error("Parse hatası: %s | id=%s", exc, doc_id)
        admin.table("pdf_document").update({
            "parse_status": "failed",
            "parse_error": str(exc),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", doc_id).execute()

        AuditService().log(
            action="pdf_parse_failed",
            entity_type="pdf_document",
            entity_id=doc_id,
            user_id=user_id,
            project_id=project_id,
            note=f"Parse hatası: {exc}",
        )


def run() -> None:
    """Ana poll döngüsü — sonsuza kadar çalışır."""
    logger.info(
        "PDF Worker başlatıldı | poll=%ds batch=%d",
        POLL_INTERVAL,
        BATCH_SIZE,
    )
    admin = get_admin_client()

    while True:
        try:
            pending = fetch_pending(admin)
            if pending:
                logger.info("%d pending kayıt bulundu.", len(pending))
                for record in pending:
                    process_one(record)
            else:
                logger.debug("Bekleyen kayıt yok.")
        except Exception as exc:
            logger.error("Worker döngü hatası: %s", exc)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
