"""Smoke test: uygulamanın temiz derlenip import edildiğini kanıtlar.

Regresyon ağının (P-B6) tohumu. Bugüne kadar elle güvendiğimiz
`import backend.main` build-kontrolünü otomatik teste çevirir.
Asıl invariant testleri (IDOR guard'ları, SEC-H4 path scoping,
deterministik deadline aritmetiği) sonraki slice'ta gelir.
"""


def test_backend_main_imports():
    """FastAPI uygulama modülü hatasız import edilir."""
    import backend.main  # noqa: F401
