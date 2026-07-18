"""ClauseIQ — Contract & Operational Intelligence Platform
FastAPI giriş noktası. Middleware'ler sırayla kayıt edilir,
ardından tüm router'lar dahil edilir.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import logging

from backend.core.config import settings
from backend.core.limiter import limiter
from backend.routers import auth, projects, project_dashboard, rfis, correspondences, changes, chronologies, deliverables, amendments, overrides
from backend.routers import config as config_router
from backend.routers import documents
from backend.routers import alerts as alerts_router
from backend.routers import notice_config as notice_config_router
from backend.database import get_admin_client as _get_admin_for_startup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── Production güvenlik kontrolleri ───────────────────────────
if settings.APP_ENV == "production":
    if settings.SECRET_KEY == "change-me-in-production":
        raise RuntimeError(
            "SECRET_KEY varsayılan değerle production'a alınamaz. "
            ".env dosyasında SECRET_KEY'i güncelleyin."
        )
    if "*" in settings.CORS_ORIGINS or "localhost" in settings.CORS_ORIGINS:
        raise RuntimeError(
            "CORS_ORIGINS production'da localhost veya * içeremez. "
            ".env dosyasında CORS_ORIGINS'i güncelleyin."
        )

# ── FastAPI app ────────────────────────────────────────────────────────────
_is_production = settings.APP_ENV == "production"

app = FastAPI(
    title="ClauseIQ — Contract Intelligence API",
    description=(
        "Contract & Operational Intelligence Platform. "
        "RFI, Correspondence, Change, Chronology ve Deliverable yönetimi."
    ),
    version="1.0.0",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-Requested-With"],
)
app.add_middleware(SlowAPIMiddleware)

# ── Global exception handler ───────────────────────────────────────────────
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled exception: %s %s — %s: %s",
        request.method,
        request.url.path,
        type(exc).__name__,
        str(exc),
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Sunucu hatası. Lütfen daha sonra tekrar deneyin."},
    )

# ── Timing middleware ──────────────────────────────────────
import time as _time

@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    t0 = _time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (_time.perf_counter() - t0) * 1000
    response.headers["X-Response-Time"] = f"{elapsed_ms:.1f}ms"
    logger.info(
        "REQUEST %s %s → %s | %.1fms",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response

# ── Security headers middleware ────────────────────────────────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    # OPTIONS preflight isteklerini CORS middleware'e bırak
    if request.method == "OPTIONS":
        response = await call_next(request)
        return response
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    return response

# ── CORS yukarida SlowAPIMiddleware den once eklendi ───────────────────────

# ── Startup: processing kayıtlarını pending'e döndür ──────────────────────
@app.on_event("startup")
async def recover_stalled_pdf_jobs():
    try:
        from datetime import datetime, timezone
        admin = _get_admin_for_startup()
        result = (
            admin.table("pdf_document")
            .update({
                "parse_status": "pending",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("parse_status", "processing")
            .execute()
        )
        count = len(result.data) if result.data else 0
        if count > 0:
            logger.info(
                "Startup recovery: %d takılı PDF kaydı pending'e döndürüldü.",
                count,
            )
    except Exception as exc:
        logger.error("Startup recovery hatası: %s", exc)

    # Reset stale metadata extractions
    # metadata_status processing → failed on restart
    try:
        _get_admin_for_startup() \
            .table("pdf_document") \
            .update({"metadata_status": "failed"}) \
            .eq("metadata_status", "processing") \
            .execute()
        logger.info("Stale metadata extractions reset to failed.")
    except Exception as exc:
        logger.error("Metadata extraction reset failed: %s", exc)

# ── Routers ────────────────────────────────────────────────────────────────
API_V1 = "/api/v1"
app.include_router(auth.router, prefix=API_V1)
app.include_router(projects.router, prefix=API_V1)
app.include_router(project_dashboard.router, prefix=API_V1)
app.include_router(rfis.router, prefix=API_V1)
app.include_router(correspondences.router, prefix=API_V1)
app.include_router(amendments.router, prefix=API_V1)
app.include_router(overrides.router, prefix=API_V1)
app.include_router(changes.router, prefix=API_V1)
app.include_router(chronologies.router, prefix=API_V1)
app.include_router(deliverables.router, prefix=API_V1)
app.include_router(config_router.router, prefix=API_V1)
app.include_router(documents.router, prefix=API_V1)
app.include_router(alerts_router.router, prefix=API_V1)
app.include_router(notice_config_router.router, prefix=API_V1)

# ── Health check ───────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
def health():
    return {"status": "ok"}

@app.get("/health", tags=["health"])
def health_detailed():
    return {"status": "ok"}
