"""Tarih yardımcı fonksiyonları."""
from datetime import date, timedelta
from typing import Optional


def days_between(start: date, end: date) -> int:
    """İki tarih arasındaki gün farkını döndürür. Negatif olabilir."""
    return (end - start).days


def add_calendar_days(start: date, days: int) -> date:
    return start + timedelta(days=days)


def add_business_days(
    start: date,
    days: int,
    weekend_days: Optional[list[int]] = None,
    holiday_dates: Optional[set[date]] = None,
) -> date:
    """İş günü ekler. weekend_days: 1=Mon ... 7=Sun ISO formatında."""
    if weekend_days is None:
        weekend_days = [6, 7]
    if holiday_dates is None:
        holiday_dates = set()

    current = start
    counted = 0
    while counted < days:
        current += timedelta(days=1)
        if current.isoweekday() not in weekend_days and current not in holiday_dates:
            counted += 1
    return current


def urgency_label(deadline: date, today: Optional[date] = None) -> tuple[int, str]:
    """(kalan_gun, urgency) döndürür. urgency: NORMAL | UYARI | ACIL | KRITIK"""
    if today is None:
        today = date.today()
    remaining = (deadline - today).days
    if remaining < 0:
        urgency = "KRITIK"
    elif remaining <= 3:
        urgency = "ACIL"
    elif remaining <= 7:
        urgency = "UYARI"
    else:
        urgency = "NORMAL"
    return remaining, urgency
