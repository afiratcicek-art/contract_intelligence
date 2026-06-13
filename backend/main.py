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

from backend.core.limiter import limiter

from backend.routers import auth, projects, rfis, correspondences, changes, chronologies, deliverables
from backend.routers import config as config_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── FastAPI app ────────────────────────────────────────────────────────────
app = FastAPI(
    title="ClauseIQ — Contract Intelligence API",
    description=(
        "Contract & Operational Intelligence Platform. "
        "RFI, Correspondence, Change, Chronology ve Deliverable yönetimi."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ── Security headers middleware ────────────────────────────────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=()"
    return response

# ── CORS ───────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8501"],  # Streamlit dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(rfis.router)
app.include_router(correspondences.router)
app.include_router(changes.router)
app.include_router(chronologies.router)
app.include_router(deliverables.router)
app.include_router(config_router.router)


# ── Health check ───────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
def health():
    return {"status": "ok", "service": "ClauseIQ API", "version": "1.0.0"}


@app.get("/health", tags=["health"])
def health_detailed():
    return {
        "status": "ok",
        "service": "ClauseIQ API",
        "version": "1.0.0",
        "modules": ["rfi", "correspondence", "change", "chronology", "deliverable"],
    }
