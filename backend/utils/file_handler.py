"""Supabase Storage dosya işlemleri."""
import logging
import os

from backend.database import get_admin_client
from backend.utils.pdf_utils import scan_for_virus

logger = logging.getLogger(__name__)

ALLOWED_TYPES = {
    "pdf", "docx", "doc", "xlsx", "xls",
    "pptx", "ppt", "jpg", "jpeg", "png",
    "dwg", "dxf", "txt", "csv",
}
MAX_FILE_SIZE_MB = 50
STORAGE_BUCKET = "documents"


def upload_document(
    file_bytes: bytes,
    file_name: str,
    project_id: str,
    entity_type: str,
    entity_id: str,
) -> str:
    """
    Dosyayı Supabase Storage'a yükler, storage path döndürür.
    Yüklemeden önce ClamAV ile virüs taraması yapar.
    Admin client singleton kullanır — RLS bypass, sistem işlemi.
    Hata durumunda RuntimeError veya ValueError fırlatır.
    Aynı path'e ikinci yükleme SDK default davranışıyla reddedilir (upsert kapalı).
    """
    # Path traversal koruması — ../  ve benzeri karakterleri temizle
    file_name = os.path.basename(file_name.replace("\\", "/"))
    if not file_name:
        raise ValueError("Geçersiz dosya adı.")
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext not in ALLOWED_TYPES:
        raise ValueError(f"İzin verilmeyen dosya türü: .{ext}")

    if len(file_bytes) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise ValueError(
            f"Dosya boyutu sınırı aşıldı: "
            f"{len(file_bytes) / 1024 / 1024:.1f} MB (max {MAX_FILE_SIZE_MB} MB)."
        )

    # Virüs taraması — storage a yüklemeden önce
    scan_for_virus(file_bytes, file_name)

    storage_path = f"{project_id}/{entity_type}/{entity_id}/{file_name}"
    content_type = _content_type(ext)

    try:
        get_admin_client().storage.from_(STORAGE_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": content_type},
        )
    except Exception as exc:
        raise RuntimeError(f"Storage yükleme hatası: {exc}") from exc

    return storage_path


def delete_document(storage_path: str) -> None:
    """
    Supabase Storage'dan dosyayı siler.
    Orphan file cleanup için kullanılır.
    Hata durumunda sadece loglar — ana akışı engellemez.
    """
    try:
        get_admin_client().storage.from_(STORAGE_BUCKET).remove([storage_path])
        logger.info("Storage dosyası silindi: %s", storage_path)
    except Exception as exc:
        logger.error("Storage silme hatası: %s | path=%s", exc, storage_path)


def get_signed_url(path: str, expires_in: int = 3600) -> str:
    """
    Geçici imzalı URL oluşturur (varsayılan 1 saat).
    Admin client singleton kullanır.
    Hata durumunda RuntimeError fırlatır.
    """
    try:
        result = get_admin_client().storage.from_(STORAGE_BUCKET).create_signed_url(
            path=path,
            expires_in=expires_in,
        )
        return result["signedURL"]
    except Exception as exc:
        raise RuntimeError(f"Signed URL oluşturma hatası: {exc}") from exc


def _content_type(ext: str) -> str:
    mapping = {
        "pdf":  "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc":  "application/msword",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xls":  "application/vnd.ms-excel",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "ppt":  "application/vnd.ms-powerpoint",
        "png":  "image/png",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
        "dwg":  "application/acad",
        "dxf":  "application/dxf",
        "txt":  "text/plain",
        "csv":  "text/csv",
    }
    return mapping.get(ext, "application/octet-stream")
