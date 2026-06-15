from supabase import create_client, Client
from backend.core.config import settings

_anon_client: Client | None = None
_admin_client: Client | None = None


def get_anon_client() -> Client:
    """RLS aktif client — tüm kullanıcı işlemleri bu client ile yapılır."""
    global _anon_client
    if _anon_client is None:
        _anon_client = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_ANON_KEY
        )
    return _anon_client


def get_admin_client() -> Client:
    """RLS bypass admin client — SADECE sistem işlemleri (audit, migration vb.).
    Hiçbir zaman request handler içinde doğrudan kullanılmaz."""
    global _admin_client
    if _admin_client is None:
        _admin_client = create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_KEY
        )
    return _admin_client


def get_db() -> Client:
    """FastAPI Depends() için anon client döndürür."""
    return get_anon_client()


def get_authed_db(token: str):
    """
    JWT inject edilmiş fresh PostgREST client döndürür.
    Singleton anon client'ı mutate etmez — her request için yeni instance.
    auth.uid() doğru çalışır, RLS tam güvenlik sağlar.
    """
    from postgrest._sync.client import SyncPostgrestClient
    client = get_anon_client()
    return SyncPostgrestClient(
        base_url=client.rest_url,
        headers={**client.options.headers, "Authorization": f"Bearer {token}"},
        schema=client.options.schema,
    )
