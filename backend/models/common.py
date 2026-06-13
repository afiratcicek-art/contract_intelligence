from enum import Enum


class Direction(str, Enum):
    INCOMING = "incoming"
    OUTGOING = "outgoing"


class DayType(str, Enum):
    CALENDAR = "calendar"
    BUSINESS = "business"


class DeadlineSource(str, Enum):
    CONTRACT = "contract_clause"
    TEAMUL_7 = "teamul_7"
    TEAMUL_14 = "teamul_14"
    TEAMUL_21 = "teamul_21"
    EMPLOYER_SET = "employer_set"
    MANUAL = "manual"


class ContractualStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED_ONLY = "archived_only"


class ProjectRole(str, Enum):
    CM = "cm"
    ENGINEER = "engineer"
    DCC = "dcc"
    VIEWER = "viewer"


class ContractType(str, Enum):
    FIDIC_RED_2017 = "FIDIC_RED_2017"
    FIDIC_RED_1999 = "FIDIC_RED_1999"
    FIDIC_YELLOW_2017 = "FIDIC_YELLOW_2017"
    NEC4 = "NEC4"
    NEC3 = "NEC3"
    BESPOKE = "bespoke"
    OTHER = "other"


class ProjectStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    SUSPENDED = "suspended"


class PMApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    PROXIED = "proxied"
    NOT_REQUIRED = "not_required"
