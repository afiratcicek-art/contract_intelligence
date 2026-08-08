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


def assert_project_storage_path(storage_path: str, project_id: str) -> str:
    """Normalize path and require it lives under ``{project_id}/`` (SEC-H4).

    Rejects empty paths, ``..`` segments, and cross-project prefixes before any
    service_role storage call.
    """
    if not storage_path or not project_id:
        raise ValueError("Geçersiz storage path.")
    normalized = storage_path.replace("\\", "/").lstrip("/")
    if not normalized or any(part == ".." for part in normalized.split("/")):
        raise ValueError("Geçersiz storage path.")
    prefix = f"{project_id}/"
    if not normalized.startswith(prefix):
        raise ValueError("Storage path proje kapsamı dışında.")
    return normalized


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


def delete_document(storage_path: str, project_id: str) -> None:
    """
    Supabase Storage'dan dosyayı siler.
    Orphan file cleanup için kullanılır.
    Path proje dışıysa silmez (loglar). Diğer hatalarda ana akışı engellemez.
    """
    try:
        path = assert_project_storage_path(storage_path, project_id)
    except ValueError as exc:
        logger.error(
            "Storage silme reddedildi: %s | path=%s project=%s",
            exc,
            storage_path,
            project_id,
        )
        return
    try:
        get_admin_client().storage.from_(STORAGE_BUCKET).remove([path])
        logger.info("Storage dosyası silindi: %s", path)
    except Exception as exc:
        logger.error("Storage silme hatası: %s | path=%s", exc, path)


def get_signed_url(path: str, project_id: str, expires_in: int = 3600) -> str:
    """
    Geçici imzalı URL oluşturur (varsayılan 1 saat).
    Path must be under project_id/ (SEC-H4).
    Hata durumunda RuntimeError / ValueError fırlatır.
    """
    scoped = assert_project_storage_path(path, project_id)
    try:
        result = get_admin_client().storage.from_(STORAGE_BUCKET).create_signed_url(
            path=scoped,
            expires_in=expires_in,
        )
        return result["signedURL"]
    except Exception as exc:
        raise RuntimeError(f"Signed URL oluşturma hatası: {exc}") from exc


def download_document(storage_path: str, project_id: str) -> bytes:
    """
    Storage'dan dosya baytlarını indirir (chrome görselleri / docx rebuild).
    Path must be under project_id/ (SEC-H4).
    """
    scoped = assert_project_storage_path(storage_path, project_id)
    try:
        data = get_admin_client().storage.from_(STORAGE_BUCKET).download(scoped)
        return data
    except Exception as exc:
        raise RuntimeError(f"Storage indirme hatası: {exc}") from exc


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
