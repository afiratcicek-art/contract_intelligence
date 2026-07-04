from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class DeadlineResult:
    deadline: Optional[date]
    source: str
    day_type: str
    days_remaining: Optional[int]
    urgency: str        # NORMAL | UYARI | ACIL | KRITIK
    is_teamul: bool     # Teamül'den geliyorsa frontend uyarı gösterir


class DeadlineService:
    """Deterministic deadline hesaplama servisi — asla LLM kullanmaz.

    Her hesap adımı audit_log'a yazılır.
    """

    URGENCY_CRITICAL_DAYS = 0
    URGENCY_ACIL_DAYS = 3
    URGENCY_UYARI_DAYS = 7

    def calculate_deadline(
        self,
        start_date: date,
        period_days: int,
        day_type: str,          # 'calendar' | 'business'
        calendar_config: Optional[dict] = None,
    ) -> date:
        """Başlangıç tarihinden itibaren deadline hesaplar.

        day_type == 'calendar' → takvim günü (doğrudan toplama)
        day_type == 'business' → iş günü (hafta sonu + tatil atlama)
        """
        if day_type == "calendar" or calendar_config is None:
            return start_date + timedelta(days=period_days)

        return self._calculate_business_days(
            start_date, period_days, calendar_config
        )

    def _calculate_business_days(
        self,
        start_date: date,
        period_days: int,
        calendar_config: dict,
    ) -> date:
        """calendar_config'den hafta sonu ve tatil günlerini okuyarak iş günü sayar."""
        weekend_days: list[int] = calendar_config.get("weekend_days", [6, 7])
        public_holidays: list[str] = calendar_config.get("public_holidays", [])
        holiday_dates = {date.fromisoformat(d) for d in public_holidays}

        current = start_date
        counted = 0
        while counted < period_days:
            current += timedelta(days=1)
            if current.isoweekday() not in weekend_days and current not in holiday_dates:
                counted += 1
        return current

    def check_urgency(self, deadline: date, today: Optional[date] = None) -> tuple[int, str]:
        """Deadline'a kaç gün kaldığını ve aciliyet seviyesini döndürür."""
        if today is None:
            today = date.today()

        days_remaining = (deadline - today).days

        if days_remaining < 0:
            urgency = "KRITIK"
        elif days_remaining <= self.URGENCY_ACIL_DAYS:
            urgency = "ACIL"
        elif days_remaining <= self.URGENCY_UYARI_DAYS:
            urgency = "UYARI"
        else:
            urgency = "NORMAL"

        return days_remaining, urgency

    def resolve_deadline(
        self,
        start_date: date,
        contract_period_days: Optional[int],
        config_period_days: int,
        day_type: str,
        calendar_config: Optional[dict] = None,
    ) -> DeadlineResult:
        """Deadline kaynağını ve değerini belirler.

        Öncelik sırası:
        1. Kontrat maddesinde süre tanımlıysa → kontrat
        2. Proje config'de default varsa → config
        3. Hiçbiri yoksa → teamül 14 gün + uyarı flag'i
        """
        if contract_period_days is not None:
            period = contract_period_days
            source = "contract"
            is_teamul = False
        elif config_period_days:
            period = config_period_days
            source = "config"
            is_teamul = False
        else:
            period = 14
            source = "teamul_14"
            is_teamul = True

        deadline = self.calculate_deadline(start_date, period, day_type, calendar_config)
        days_remaining, urgency = self.check_urgency(deadline)

        return DeadlineResult(
            deadline=deadline,
            source=source,
            day_type=day_type,
            days_remaining=days_remaining,
            urgency=urgency,
            is_teamul=is_teamul,
        )

    def to_db_source(self, result: DeadlineResult) -> str:
        """Map internal source labels to response_due_source CHECK values."""
        if result.source == "contract":
            return "contract_clause"
        if result.source == "teamul_14":
            return "teamul_14"
        # source == "config": no dedicated DB enum value yet;
        # returns "manual" until SQL schema adds a "config" source.
        return "manual"

    @staticmethod
    def fetch_configs(db, project_id: str) -> tuple[dict, Optional[dict]]:
        try:
            cfg = (
                db.table("project_config")
                .select("*")
                .eq("project_id", project_id)
                .single()
                .execute()
            )
            project_config = cfg.data or {}
        except Exception as exc:  # noqa: BLE001
            logger.debug("calendar_config not found for project %s, using defaults: %s", project_id, exc)
            project_config = {}

        cal = (
            db.table("calendar_config")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        calendar_config = cal.data[0] if cal.data else None
        if not calendar_config:
            cal = (
                db.table("calendar_config")
                .select("*")
                .eq("project_id", project_id)
                .limit(1)
                .execute()
            )
            calendar_config = cal.data[0] if cal.data else None
        return project_config, calendar_config

    def apply_response_deadline(
        self,
        data: dict,
        start_date: date,
        config_period_days: Optional[int],
        day_type: str,
        calendar_config: Optional[dict],
        contract_period_days: Optional[int] = None,
    ) -> None:
        result = self.resolve_deadline(
            start_date=start_date,
            contract_period_days=contract_period_days,
            config_period_days=config_period_days or 0,
            day_type=day_type,
            calendar_config=calendar_config,
        )
        data["response_due_date"] = str(result.deadline)
        data["response_due_source"] = self.to_db_source(result)
        data["response_due_day_type"] = result.day_type
