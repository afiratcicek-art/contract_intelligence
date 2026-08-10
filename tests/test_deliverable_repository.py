"""DeliverableRepository N+1 regresyon testleri.

list_by_project ve get_with_contract ilişkili veriyi PostgREST embedded-join ile
TEK round-trip'te çeker (döngüde değil). Bu testler o invariant'ı kilitler: biri
list'i parent-başına-sorgu döngüsüne çevirirse query_count artar → kırmızı.
"""
from backend.repositories.deliverable_repository import DeliverableRepository


def test_list_by_project_single_round_trip(fake_db):
    DeliverableRepository(fake_db).list_by_project("proj1")
    assert fake_db.query_count == 1


def test_get_with_contract_single_round_trip(fake_db):
    DeliverableRepository(fake_db).get_with_contract("deliv1")
    assert fake_db.query_count == 1
