"""Supabase Storage dosya işlemleri."""
import logging
from typing import Optional
from backend.core.config import settings

logger = logging.getLogger(__name__)

ALLOWED_TYPES = {"pdf", "docx", "xlsx", "png", "jpg", "jpeg"}
MAX_FILE_SIZE_MB = 50


def upload_document(
    admin_db,
    file_bytes: bytes,
    file_name: str,
    project_id: str,
    entity_type: str,
    entity_id: str,
) -> str:
    """Dosyayı Supabase Storage'a yükler, path döndürür."""
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext not in ALLOWED_TYPES:
        raise ValueError(f"Desteklenmeyen dosya türü: {ext}")

    if len(file_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise ValueError(f"Dosya boyutu {MAX_FILE_SIZE_MB} MB sınırını aşıyor")

    path = f"{project_id}/{entity_type}/{entity_id}/{file_name}"

    try:
        admin_db.storage.from_("documents").upload(
            path=path,
            file=file_bytes,
            file_options={"content-type": _content_type(ext)},
        )
        return path
    except Exception as exc:
        logger.error("Dosya yükleme hatası: %s", exc)
        raise


def get_signed_url(admin_db, path: str, expires_in: int = 3600) -> str:
    """Geçici imzalı URL oluşturur (varsayılan 1 saat)."""
    result = admin_db.storage.from_("documents").create_signed_url(path, expires_in)
    return result["signedURL"]


def _content_type(ext: str) -> str:
    mapping = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
    }
    return mapping.get(ext, "application/octet-stream")
