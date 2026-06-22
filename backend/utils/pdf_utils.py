"""PDF quality scoring ve page classification utilities."""
import logging
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from enum import Enum

from backend.core.config import settings

logger = logging.getLogger(__name__)

MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024   # 50 MB — file_handler ile tutarlı
MIN_TEXT_CHARS_PER_PAGE = 50             # Bu altı → sayfa scanned kabul edilir
QUALITY_SCORE_THRESHOLD_HIGH = 0.75      # LlamaParse gerekmez
QUALITY_SCORE_THRESHOLD_LOW = 0.25       # Tesseract gerekir


class ParseMethod(str, Enum):
    LLAMAPARSE = "llamaparse"
    PYMUPDF = "pymupdf"
    TESSERACT = "tesseract"


class ParseStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class PageClassification:
    page_number: int
    has_text_layer: bool
    char_count: int
    needs_ocr: bool


@dataclass
class DocumentQuality:
    quality_score: float
    page_count: int
    text_pages: int
    scanned_pages: int
    recommended_method: ParseMethod
    page_classifications: list[PageClassification]


def validate_pdf_bytes(file_bytes: bytes, filename: str) -> None:
    """
    PDF yüklemeden önce temel doğrulama.
    Hata durumunda ValueError fırlatır — router HTTP 400'e çevirir.
    """
    if not file_bytes:
        raise ValueError("Dosya boş.")

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"Dosya boyutu sınırı aşıldı: "
            f"{len(file_bytes) / 1024 / 1024:.1f} MB (max 50 MB)."
        )

    if not filename.lower().endswith(".pdf"):
        raise ValueError("Yalnızca .pdf uzantılı dosyalar kabul edilir.")

    if not file_bytes.startswith(b"%PDF"):
        raise ValueError("Geçersiz PDF formatı: dosya imzası tanınamadı.")


ALLOWED_EXTENSIONS = {
    "pdf", "docx", "doc", "xlsx", "xls",
    "pptx", "ppt", "jpg", "jpeg", "png",
    "dwg", "dxf", "txt", "csv",
}

def validate_document_bytes(file_bytes: bytes, filename: str) -> None:
    """
    Tüm desteklenen dosya tipleri için temel doğrulama.
    PDF için magic bytes kontrolü de yapar.
    Hata durumunda ValueError fırlatır.
    """
    if not file_bytes:
        raise ValueError("Dosya boş.")
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise ValueError(
            f"Dosya boyutu sınırı aşıldı: "
            f"{len(file_bytes) / 1024 / 1024:.1f} MB (max 50 MB)."
        )
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Desteklenmeyen dosya türü: .{ext}. "
            f"İzin verilenler: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )
    if ext == "pdf" and not file_bytes.startswith(b"%PDF"):
        raise ValueError("Geçersiz PDF formatı: dosya imzası tanınamadı.")


def classify_pages(pdf_bytes: bytes) -> DocumentQuality:
    """
    PyMuPDF ile her sayfayı analiz eder, quality score üretir,
    hangi parse metodunun kullanılacağını belirler.

    parse_method kararı:
    - quality_score >= 0.75 → pymupdf (text layer yeterli)
    - 0.25 <= quality_score < 0.75 → llamaparse (karışık içerik)
    - quality_score < 0.25 → tesseract (çoğunlukla scanned)
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.error("PyMuPDF kurulu değil — pip install pymupdf==1.24.14")
        raise RuntimeError("PDF işleme kütüphanesi bulunamadı.")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_count = len(doc)

    if page_count == 0:
        raise ValueError("PDF sayfa içermiyor.")

    classifications: list[PageClassification] = []

    for page_num in range(page_count):
        page = doc[page_num]
        text = page.get_text("text")
        char_count = len(text.strip())
        has_text_layer = char_count >= MIN_TEXT_CHARS_PER_PAGE
        classifications.append(
            PageClassification(
                page_number=page_num + 1,
                has_text_layer=has_text_layer,
                char_count=char_count,
                needs_ocr=not has_text_layer,
            )
        )

    doc.close()

    text_pages = sum(1 for p in classifications if p.has_text_layer)
    scanned_pages = page_count - text_pages
    quality_score = round(text_pages / page_count, 3)

    if quality_score >= QUALITY_SCORE_THRESHOLD_HIGH:
        method = ParseMethod.PYMUPDF
    elif quality_score >= QUALITY_SCORE_THRESHOLD_LOW:
        method = ParseMethod.LLAMAPARSE
    else:
        method = ParseMethod.TESSERACT

    logger.info(
        "PDF classified: pages=%d text=%d scanned=%d score=%.3f method=%s",
        page_count, text_pages, scanned_pages, quality_score, method.value,
    )

    return DocumentQuality(
        quality_score=quality_score,
        page_count=page_count,
        text_pages=text_pages,
        scanned_pages=scanned_pages,
        recommended_method=method,
        page_classifications=classifications,
    )


def clean_extracted_text(raw_text: str) -> str:
    """
    PyMuPDF veya Tesseract'tan gelen ham metni temizler.
    - Aşırı boşluk ve satır sonlarını normalize eder
    - Null byte ve kontrol karakterlerini kaldırır
    - sanitizer.py'nin sanitize_user_input() ile zincirlenmez:
      bu fonksiyon PDF metnini temizler, kullanıcı girdisi değil
    """
    if not raw_text:
        return ""

    text = raw_text.replace("\x00", "")
    text = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.strip() for line in text.splitlines()]
    text = "\n".join(lines)

    return text.strip()


def _get_scan_command(file_path: str) -> list[str]:
    """
    clamd daemon varsa clamdscan (~0.1s) kullan.
    Yoksa clamscan (~15s) fallback.
    """
    import shutil
    if shutil.which("clamdscan"):
        try:
            # clamd erişilebilir mi kontrol et
            test = subprocess.run(
                ["clamdscan", "--version"],
                capture_output=True,
                timeout=2,
            )
            if test.returncode == 0 and b"Connection refused" not in test.stdout:
                logger.debug("ClamAV daemon aktif — clamdscan kullanılıyor.")
                return ["clamdscan", "--no-summary", file_path]
        except Exception:
            pass
    logger.debug("clamd erişilemez — clamscan fallback.")
    return ["clamscan", "--no-summary", file_path]


def scan_for_virus(file_bytes: bytes, filename: str) -> None:
    """
    ClamAV ile virüs taraması yapar.
    Virüs bulunursa ValueError fırlatır — router HTTP 400 döndürür.
    ClamAV kurulu değilse:
      - development: uyarı loglar, devam eder
      - production: RuntimeError fırlatır
    Tarama için geçici dosya kullanır, tarama sonrası siler.
    """
    suffix = os.path.splitext(filename)[1] or ".pdf"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        # Önce clamd daemon ile dene (~0.1s) — başarısız olursa clamscan (~15s)
        scan_cmd = _get_scan_command(tmp_path)
        result = subprocess.run(
            scan_cmd,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 1:
            raise ValueError(
                f"Güvenlik taraması başarısız: '{filename}' dosyasında "
                "zararlı içerik tespit edildi."
            )
        if result.returncode == 2:
            logger.error("ClamAV tarama hatası: %s", result.stderr)
            raise RuntimeError("Virüs taraması sırasında hata oluştu.")
    except FileNotFoundError:
        if settings.APP_ENV == "production":
            raise RuntimeError(
                "ClamAV kurulu değil — production ortamında zorunludur."
            )
        logger.warning(
            "ClamAV bulunamadı — %s taranmadan geçirildi (development modu).",
            filename,
        )
    except subprocess.TimeoutExpired:
        logger.error("ClamAV tarama zaman aşımı: %s", filename)
        raise RuntimeError("Virüs taraması zaman aşımına uğradı.")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
