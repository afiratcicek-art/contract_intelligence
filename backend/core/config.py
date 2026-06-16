from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Supabase
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_KEY: str

    # Anthropic / AI
    ANTHROPIC_API_KEY: str = ""
    AI_PROVIDER: str = "anthropic"
    GATE_MODEL: str = "claude-haiku-4-5-20251001"
    ANALYSIS_MODEL: str = "claude-sonnet-4-20250514"
    GATE_TIMEOUT_SECONDS: int = 5
    AI_MODEL: str = "claude-sonnet-4-20250514"  # deprecated — use ANALYSIS_MODEL

    # Güvenlik
    SECRET_KEY: str = "change-me-in-production"

    # Sistem prompt (şifreli dosya)
    SYSTEM_PROMPT_PATH: str = "prompts/system.enc"
    SYSTEM_PROMPT_KEY: str = ""

    # Uygulama
    APP_ENV: str = "development"
    CORS_ORIGINS: str = "http://localhost:8501"
    BASE_URL: str = "http://localhost:8000"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
