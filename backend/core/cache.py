"""
Simple in-memory TTL cache for API responses.
Thread-safe via dict operations (GIL protected in CPython).
No external dependencies required.
"""
import time
from typing import Any

_store: dict[str, tuple[Any, float]] = {}
MAX_SIZE = 500  # Maximum number of cache entries

def cache_cleanup() -> None:
    """Remove all expired entries. Call periodically to prevent memory leak."""
    now = time.time()
    expired = [k for k, (_, exp) in _store.items() if now > exp]
    for k in expired:
        del _store[k]

def _evict_if_full() -> None:
    """If cache exceeds MAX_SIZE, remove oldest entries first."""
    if len(_store) >= MAX_SIZE:
        cache_cleanup()
        if len(_store) >= MAX_SIZE:
            # Still full after cleanup — remove oldest 20% by expiry
            sorted_keys = sorted(_store, key=lambda k: _store[k][1])
            for k in sorted_keys[:MAX_SIZE // 5]:
                del _store[k]

def cache_get(key: str) -> Any | None:
    """Return cached value if not expired, else None."""
    entry = _store.get(key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.time() > expires_at:
        del _store[key]
        return None
    return value

def cache_set(key: str, value: Any, ttl: int) -> None:
    """Store value with TTL in seconds. Evicts if cache is full."""
    _evict_if_full()
    _store[key] = (value, time.time() + ttl)

def cache_delete(key: str) -> None:
    """Delete a specific cache entry."""
    _store.pop(key, None)

def cache_delete_prefix(prefix: str) -> None:
    """Delete all entries whose key starts with prefix."""
    keys = [k for k in _store if k.startswith(prefix)]
    for k in keys:
        del _store[k]
