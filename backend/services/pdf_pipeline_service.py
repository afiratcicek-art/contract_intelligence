"""PDF pipeline orkestratörü.

Sorumluluk zinciri:
  1. validate_pdf_bytes()     — boyut, uzantı, magic bytes
  2. classify_pages()         — quality score, parse metodu kararı
  3. _extract_text()          — önerilen metot vs gerçek motor
                                 (genelde PyMuPDF; LlamaParse henüz aktif değil)
  4. clean_extracted_text()   — metin temizleme
  5. _persist()               — pdf_document tablosuna yaz
  6. audit_log                — her adım kayıt altında

Bu servis LLM çağrısı YAPMAZ. Temiz metin üretir,
claude_service'e teslim etmek caller'ın sorumluluğudur.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.database import get_admin_client
from backend.services.audit_service import AuditService
from backend.services.embedding_service import get_embedding_service
from backend.utils.pdf_utils import (
    DocumentQuality,
    ParseMethod,
    ParseStatus,
    clean_extracted_text,
    classify_pages,
    validate_pdf_bytes,
)

logger = logging.getLogger(__name__)


class PDFPipelineService:
    """
    PDF yükleme, parse ve depolama pipeline'ı.
    db — Supabase anon client (okuma işlemleri).
    Yazma işlemleri get_admin_client() singleton'ı ile yapılır.
    """

    def __init__(self, db):
        self.db = db
        self._audit = AuditService()

    # ----------------------------------------------------------
    # PUBLIC API
    # ----------------------------------------------------------

    def process(
        self,
        file_bytes: bytes,
        filename: str,
        project_id: str,
        entity_type: str,
        entity_id: str,
        user_id: str,
        storage_path: str,
    ) -> dict:
        """
        PDF'i alır, doğrular, parse eder, veritabanına yazar.
        Başarıda pdf_document kaydının dict temsilini döndürür.
        Herhangi bir adımda hata olursa RuntimeError fırlatır.
        """
        doc_id = str(uuid.uuid4())

        # ADIM 1 — Doğrulama
        try:
            validate_pdf_bytes(file_bytes, filename)
        except ValueError as exc:
            self._audit.log(
                action="pdf_upload",
                entity_type="pdf_document",
                entity_id=doc_id,
                user_id=user_id,
                project_id=project_id,
                note=f"Doğrulama hatası: {exc}",
            )
            raise RuntimeError(str(exc)) from exc

        # ADIM 2 — Sayfa sınıflandırma ve metod kararı
        try:
            quality: DocumentQuality = classify_pages(file_bytes)
        except Exception as exc:
            self._audit.log(
                action="pdf_parse_failed",
                entity_type="pdf_document",
                entity_id=doc_id,
                user_id=user_id,
                project_id=project_id,
                note=f"Sınıflandırma hatası: {exc}",
            )
            raise RuntimeError(f"PDF sınıflandırma başarısız: {exc}") from exc

        self._audit.log(
            action="pdf_parse_start",
            entity_type="pdf_document",
            entity_id=doc_id,
            user_id=user_id,
            project_id=project_id,
            new_value={
                "method": quality.recommended_method.value,
                "page_count": quality.page_count,
                "quality_score": quality.quality_score,
            },
        )

        # ADIM 3 — Metin çıkarma
        # actual_method starts as the recommendation; overwritten after a real run.
        actual_method = quality.recommended_method
        try:
            raw_text, actual_method = self._extract_text(file_bytes, quality.recommended_method)
        except Exception as exc:
            self._persist_failed(
                doc_id=doc_id,
                project_id=project_id,
                entity_type=entity_type,
                entity_id=entity_id,
                filename=filename,
                storage_path=storage_path,
                file_size=len(file_bytes),
                quality=quality,
                error=str(exc),
                user_id=user_id,
                actual_method=actual_method,
            )
            self._audit.log(
                action="pdf_parse_failed",
                entity_type="pdf_document",
                entity_id=doc_id,
                user_id=user_id,
                project_id=project_id,
                note=f"Metin çıkarma hatası: {exc}",
            )
            raise RuntimeError(f"PDF parse başarısız: {exc}") from exc

        # ADIM 4 — Metin temizleme
        clean_text = clean_extracted_text(raw_text)

        # ADIM 5 — Veritabanına yaz
        record = self._persist_success(
            doc_id=doc_id,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
            filename=filename,
            storage_path=storage_path,
            file_size=len(file_bytes),
            quality=quality,
            extracted_text=clean_text,
            user_id=user_id,
            actual_method=actual_method,
        )

        self._audit.log(
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

        # Trigger embedding pipeline after successful parse
        # Runs synchronously here — pdf_pipeline is already
        # called from a background worker process.
        # TB-12: Move to async queue at scale.
        try:
            embedding_service = get_embedding_service()
            embedding_service.embed_document(
                doc_id=doc_id,
                project_id=project_id,
                entity_type=entity_type,
                entity_id=entity_id,
                user_id=user_id,
                text=clean_text,
                doc_date=None,  # TB-5: populate from extraction metadata
                doc_type=None,  # TB-5: populate from extraction metadata
            )
        except Exception as exc:
            # Embedding failure must not block PDF pipeline
            logger.warning(
                "Embedding trigger failed (non-critical): %s | doc_id=%s",
                exc, doc_id,
            )

        return record

    def get_extracted_text(self, pdf_document_id: str, project_id: str) -> Optional[str]:
        """
        Daha önce parse edilmiş PDF'in temiz metnini döndürür.
        RLS anon client üzerinden çalışır — tenant isolation policy kapsar.
        """
        try:
            result = (
                self.db.table("pdf_document")
                .select("extracted_text, parse_status")
                .eq("id", pdf_document_id)
                .eq("project_id", project_id)
                .single()
                .execute()
            )
            if result.data and result.data.get("parse_status") == ParseStatus.COMPLETED.value:
                return result.data.get("extracted_text")
            return None
        except Exception as exc:
            logger.error("PDF metin okuma hatası: %s | id=%s", exc, pdf_document_id)
            return None

    # ----------------------------------------------------------
    # PRIVATE — Metin çıkarma
    # ----------------------------------------------------------

    def _extract_text(self, pdf_bytes: bytes, method: ParseMethod) -> tuple[str, ParseMethod]:
        if method == ParseMethod.PYMUPDF:
            return self._extract_pymupdf(pdf_bytes), ParseMethod.PYMUPDF
        elif method == ParseMethod.LLAMAPARSE:
            return self._extract_llamaparse(pdf_bytes)
        else:
            return self._extract_tesseract(pdf_bytes), ParseMethod.TESSERACT

    def _extract_pymupdf(self, pdf_bytes: bytes) -> str:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = [doc[i].get_text("text") for i in range(len(doc))]
        doc.close()
        return "\n\n".join(pages)

    def _extract_llamaparse(self, pdf_bytes: bytes) -> tuple[str, ParseMethod]:
        """
        LlamaParse stub — API key olmadan çalışmaz.
        Key geldiğinde bu metodun içi doldurulur,
        imza ve döndürdüğü tip değişmez.

        TEKNİK BORÇ:
        llama-parse paketi requirements.txt'den çıkarıldı —
        pydantic>=2.8 gerektirir, mevcut pydantic==2.7.0 ile çakışır.
        Aktivasyon adımları:
          1. pydantic upgrade kararı ver (2.7.0 → uyumlu versiyon)
          2. pip install llama-parse (o tarihte latest stable'ı kontrol et)
          3. requirements.txt'e ekle
          4. LLAMAPARSE_API_KEY'i .env'e ekle
          5. Aşağıdaki TODO bloğunu implement et
        """
        import os
        api_key = os.getenv("LLAMAPARSE_API_KEY")
        if not api_key:
            logger.warning(
                "LLAMAPARSE_API_KEY tanımlı değil — PyMuPDF fallback devreye giriyor."
            )
            return self._extract_pymupdf(pdf_bytes), ParseMethod.PYMUPDF
        # TODO: LlamaParse entegrasyonu — key ve paket hazır olduğunda implement et
        # from llama_parse import LlamaParse
        # parser = LlamaParse(api_key=api_key, result_type="text")
        # documents = parser.load_data(file_bytes)
        # return "\n\n".join([doc.text for doc in documents]), ParseMethod.LLAMAPARSE
        raise NotImplementedError("LlamaParse entegrasyonu henüz aktif değil.")

    def _extract_tesseract(self, pdf_bytes: bytes) -> str:
        """
        Tesseract OCR — sistem binary'si gerektirir.
        Ubuntu: sudo apt-get install tesseract-ocr tesseract-ocr-tur
        """
        try:
            import fitz
            import pytesseract
            from PIL import Image
            import io
        except ImportError as exc:
            raise RuntimeError(f"OCR bağımlılığı eksik: {exc}") from exc

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        texts = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(2.0, 2.0)   # 2x zoom — OCR kalitesi için
            pix = page.get_pixmap(matrix=mat)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            text = pytesseract.image_to_string(img, lang="tur+eng")
            texts.append(text)
        doc.close()
        return "\n\n".join(texts)

    # ----------------------------------------------------------
    # PRIVATE — Veritabanı yazma
    # ----------------------------------------------------------

    def _persist_success(
        self,
        doc_id: str,
        project_id: str,
        entity_type: str,
        entity_id: str,
        filename: str,
        storage_path: str,
        file_size: int,
        quality: DocumentQuality,
        extracted_text: str,
        user_id: str,
        actual_method: Optional[ParseMethod] = None,
    ) -> dict:
        if actual_method is None:
            actual_method = quality.recommended_method
        record = {
            "id": doc_id,
            "project_id": project_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "original_filename": filename,
            "storage_path": storage_path,
            "file_size_bytes": file_size,
            "parse_method": actual_method.value,
            "parse_status": ParseStatus.COMPLETED.value,
            "page_count": quality.page_count,
            "quality_score": quality.quality_score,
            "extracted_text": extracted_text,
            "parse_error": None,
            "created_by": user_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            get_admin_client().table("pdf_document").insert(record).execute()
        except Exception as exc:
            logger.error("PDF kayıt yazma hatası: %s | id=%s", exc, doc_id)
            raise RuntimeError(f"Veritabanı yazma hatası: {exc}") from exc
        return record

    def _persist_failed(
        self,
        doc_id: str,
        project_id: str,
        entity_type: str,
        entity_id: str,
        filename: str,
        storage_path: str,
        file_size: int,
        quality: DocumentQuality,
        error: str,
        user_id: str,
        actual_method: Optional[ParseMethod] = None,
    ) -> None:
        if actual_method is None:
            actual_method = quality.recommended_method
        record = {
            "id": doc_id,
            "project_id": project_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "original_filename": filename,
            "storage_path": storage_path,
            "file_size_bytes": file_size,
            "parse_method": actual_method.value,
            "parse_status": ParseStatus.FAILED.value,
            "page_count": quality.page_count,
            "quality_score": quality.quality_score,
            "extracted_text": None,
            "parse_error": error,
            "created_by": user_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            get_admin_client().table("pdf_document").insert(record).execute()
        except Exception as exc:
            logger.error("PDF hata kaydı yazılamadı: %s | id=%s", exc, doc_id)
