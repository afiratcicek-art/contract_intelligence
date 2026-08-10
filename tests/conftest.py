"""Paylaşılan test fixture'ları.

FakeDB: Supabase client'ının fluent zincirini (table().select().eq()...execute())
taklit eden, execute() çağrılarını SAYAN hafif sahte-client. N+1 regresyon
testleri için: bir repo/servis metodunun kaç DB round-trip'i attığını doğrular.
Gerçek ağ/DB yok. Tekrar kullanılabilir — sonraki N+1 testleri de bunu kullanır.
"""
import pytest


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Zincir metotları (select/eq/order/limit/offset/single/maybe_single/
    insert/update/delete...) self döndürür; yalnız execute() sayacı artırır."""

    def __init__(self, counter, data):
        self._counter = counter
        self._data = data

    def __getattr__(self, _name):
        def _chain(*args, **kwargs):
            return self
        return _chain

    def execute(self):
        self._counter["count"] += 1
        return _FakeResult(self._data)


class FakeDB:
    """Sahte Supabase client. .table(...) sayaç-paylaşan bir zincir döndürür."""

    def __init__(self, data=None):
        self._counter = {"count": 0}
        self._data = data if data is not None else []

    def table(self, _name):
        return _FakeQuery(self._counter, self._data)

    @property
    def query_count(self) -> int:
        return self._counter["count"]


@pytest.fixture
def fake_db():
    """Boş-veri döndüren, sorgu-sayan sahte DB. Test .query_count ile round-trip sayar."""
    return FakeDB()
