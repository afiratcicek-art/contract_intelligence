"""date_utils birim testleri — deterministik süre/takvim aritmetiği.

Mimarinin deterministic-first omurgası: süreler LLM'le değil burada hesaplanır.
İş-günü/hafta-sonu/tatil kenar-durumları + urgency eşiklerini kilitler.
Saf fonksiyonlar; DB/LLM/mock yok.
"""
from datetime import date

from backend.utils.date_utils import (
    add_business_days,
    add_calendar_days,
    days_between,
    urgency_label,
)


def test_days_between_positive():
    assert days_between(date(2024, 1, 1), date(2024, 1, 5)) == 4


def test_days_between_negative():
    assert days_between(date(2024, 1, 5), date(2024, 1, 1)) == -4


def test_add_calendar_days_forward():
    assert add_calendar_days(date(2024, 1, 1), 5) == date(2024, 1, 6)


def test_add_calendar_days_backward():
    assert add_calendar_days(date(2024, 1, 5), -2) == date(2024, 1, 3)


def test_business_days_skips_weekend():
    assert add_business_days(date(2024, 1, 5), 1) == date(2024, 1, 8)


def test_business_days_within_week():
    assert add_business_days(date(2024, 1, 1), 1) == date(2024, 1, 2)


def test_business_days_zero_returns_start():
    assert add_business_days(date(2024, 1, 1), 0) == date(2024, 1, 1)


def test_business_days_skips_holiday():
    assert add_business_days(
        date(2024, 1, 1), 1, holiday_dates={date(2024, 1, 2)}
    ) == date(2024, 1, 3)


def test_business_days_custom_weekend_gcc():
    assert add_business_days(
        date(2024, 1, 4), 1, weekend_days=[5, 6]
    ) == date(2024, 1, 7)


def test_urgency_overdue_kritik():
    assert urgency_label(date(2024, 1, 1), today=date(2024, 1, 2)) == (-1, "KRITIK")


def test_urgency_today_acil():
    assert urgency_label(date(2024, 1, 1), today=date(2024, 1, 1)) == (0, "ACIL")


def test_urgency_three_days_acil_boundary():
    assert urgency_label(date(2024, 1, 4), today=date(2024, 1, 1)) == (3, "ACIL")


def test_urgency_four_days_uyari():
    assert urgency_label(date(2024, 1, 5), today=date(2024, 1, 1)) == (4, "UYARI")


def test_urgency_seven_days_uyari_boundary():
    assert urgency_label(date(2024, 1, 8), today=date(2024, 1, 1)) == (7, "UYARI")


def test_urgency_eight_days_normal():
    assert urgency_label(date(2024, 1, 9), today=date(2024, 1, 1)) == (8, "NORMAL")
