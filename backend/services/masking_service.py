"""Deterministic, LLM-free identity masking for outbound AI prompts.

Request-scoped only: MaskSession holds the real↔token map in memory.
Never write the map to storage (SELECT-only provider; no writes).

STOPGAP (TB-41): masking here is DETERMINISTIC exact-match only. It cannot catch typos,
abbreviations, OCR-variants, or unregistered party names — those reach the provider
UNMASKED and has_leak() will not flag them (has_leak only knows registry names). Known
recall limitation, not a bug. TARGET is a hybrid: a LOCAL NER/LLM detector fronts this
module to find identity spans regardless of spelling, feeding this same deterministic token
backbone (assignment + bijection + de-mask unchanged). The mask model MUST be local — a
cloud model would send raw text out to mask it, defeating the purpose (S-H4). No local model
exists yet (Faz-3); deterministic is the accepted stopgap.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

_ROLE_TOKENS = {
    "employer": "⟦EMPLOYER⟧",
    "contractor": "⟦CONTRACTOR⟧",
    "engineer": "⟦ENGINEER⟧",
}
_PROJECT_TOKEN = "⟦PROJECT⟧"
_MIN_IDENTITY_LEN = 2
LABEL_MAP = {
    "organization": "ORG",
    "person": "PERSON",
    "location": "LOC",
}
_TOKEN_RE = re.compile(r"⟦[A-Z_]+(?:_\d+)?⟧")
_INVISIBLE_RE = re.compile(r"[\u200b\u200c\u200d\u200f\ufeff]")
_ARTICLES = frozenset({"the", "a", "an"})
# Kenar-kırpma: FIDIC taraf-rolü (tek kelime). "authority" YOK — kamu-kurumu
# tam-adını (Riyadh Development Authority) parçalamasın.
_EDGE_ROLES = frozenset({
    "engineer", "employer", "contractor", "subcontractor", "sub contractor",
    "consultant", "client", "company", "party", "parties",
    "المهندس", "مهندس", "المقاول", "مقاول",
    "الشركة", "شركة", "العميل", "عميل",
    "الطرف", "طرف", "الأطراف", "أطراف",
})

# Jenerik FIDIC rol/kurum/enstrüman terimleri + kamu — TARAF ADI DEĞİL.
# Tam-eşleşme (normalize) ile atlanır; "engineer" atlanır, "Engineer Khalid" atlanmaz.
# NOT (TB-64): bespoke sözleşmelerde Company/Client/Employer/Authority jenerik-rol
# olabilir; bu liste gerçek-dünya ölçümüyle revize edilecek (over-mask vs sızıntı dengesi).
_DONT_MASK = frozenset({
    # roller
    "engineer", "employer", "contractor", "subcontractor", "sub-contractor",
    "sub contractor",
    "nominated subcontractor", "employer's representative", "engineer's representative",
    "consultant", "client", "company", "authority", "party", "parties",
    "dab", "daab", "dispute board", "dispute adjudication board",
    "dispute avoidance and adjudication board",
    # enstrüman/sertifika (belge-türü, ad değil)
    "ipc", "interim payment certificate", "payment certificate",
    "final payment certificate", "taking-over certificate", "performance certificate",
    "defects notification period", "dnp", "statement", "contract data",
    "appendix to tender", "letter of acceptance", "letter of tender",
    "nda",
    # Arapça roller/belgeler — ال'li + ال'siz iki form (Fix-C: ال strip edilmiyor)
    "المهندس", "مهندس", "المقاول", "مقاول", "صاحب العمل",
    "المقاول من الباطن", "مقاول من الباطن", "مجلس فض النزاعات",
    "ممثل المهندس", "ممثل صاحب العمل", "الطرف", "طرف", "الأطراف", "أطراف",
    "الشركة", "شركة", "العميل", "عميل",
    "شهادة الدفع", "شهادة الاستلام", "شهادة الأداء", "فترة الإخطار بالعيوب",
    # proje-jenerikleri (FIDIC Site/Works/Plant/Project — taraf adı değil)
    "site", "the works", "works", "the project", "project", "plant",
    "permanent works", "temporary works",
    "الموقع", "موقع", "الأعمال", "أعمال", "المشروع", "مشروع",
    "الأشغال", "أشغال",
    # kamu kurumları — sözleşmede regülatör/statü (EN tam-ad + akronim, AR temiz-form).
    # İşveren olabilecek işletmeciler (SEC, NWC, Royal Commission, havalimanı) YOK.
    "sama", "saudi central bank", "saudi arabian monetary authority",
    "البنك المركزي السعودي", "مؤسسة النقد العربي السعودي", "مؤسسة النقد",
    "cchi", "council of cooperative health insurance", "مجلس الضمان الصحي",
    "zatca", "zakat, tax and customs authority",
    "zakat tax and customs authority",
    "هيئة الزكاة والضريبة والجمارك", "هيئة الزكاة",
    "الزكاة والضريبة والجمارك",
    "gosi", "general organization for social insurance",
    "المؤسسة العامة للتأمينات الاجتماعية", "التأمينات الاجتماعية",
    "ministry of labor", "ministry of labour", "وزارة العمل",
    "hrsd", "mhrsd",
    "ministry of human resources and social development",
    "وزارة الموارد البشرية والتنمية الاجتماعية", "وزارة الموارد البشرية",
    "momra", "momrah",
    "ministry of municipal and rural affairs",
    "وزارة الشؤون البلدية والقروية والإسكان", "وزارة الشؤون البلدية",
    "saso", "saudi standards, metrology and quality organization",
    "الهيئة السعودية للمواصفات والمقاييس والجودة", "الهيئة السعودية للمواصفات",
    "civil defence", "civil defense",
    "الدفاع المدني", "المديرية العامة للدفاع المدني",
    "saudi building code", "sbc", "كود البناء السعودي",
    "ministry of commerce", "وزارة التجارة",
    "ministry of interior", "وزارة الداخلية",
    "ministry of energy", "وزارة الطاقة",
    "ministry of transport", "وزارة النقل",
    "capital market authority", "cma", "هيئة السوق المالية",
    "gaca", "general authority of civil aviation",
    "الهيئة العامة للطيران المدني",
    "riyadh development authority", "هيئة تطوير الرياض",
    # standart-gövdeleri (çıplak, numarasız). Numaralı kod (ISO 9001:2015) ayrı yol.
    "iso", "astm", "iec", "aci", "din", "asme", "aws", "ieee", "api",
    "aashto", "fidic", "nec", "bs", "bs en",
})

# Numaralı standart-kod: "ISO 9001:2015", "ASTM C150", "NEC4", "BS EN 1992-1-1".
# Gövde adı + (opsiyonel harf) + rakam — "engineer" eşleşmez (rakam yok).
_STANDARD_CODE_RE = re.compile(
    r"^(?:iso|astm|iec|aci|din|asme|aws|ieee|api|saso|aashto|fidic|nec|"
    r"bs(?:\s+en)?|en)[\s\-/]*[a-z]{0,3}\d"
)
_STANDARD_BODIES = frozenset({
    "iso", "astm", "iec", "aci", "din", "asme", "aws", "ieee", "api",
    "saso", "aashto", "fidic", "nec", "bs", "en",
})
_STANDARD_TAILS = frozenset({
    "standards", "standard", "methods", "method", "code", "codes",
    "specification", "specifications",
})


def _normalize_allow(s: str) -> str:
    """Allowlist eşleşmesi için normalize: casefold + trim + baştaki 'the '/'al-' at
    + tire→boşluk + sondaki iyelik ('s / ’s).
    NOT: Arapça 'ال' (el-takısı) STRIP EDİLMEZ — özel-ad parçalama riski (العتيبي/الراشد);
    Arapça terimler allowlist'e ال'li + ال'siz iki formda yazılır (Fix-C)."""
    t = s.strip().casefold()
    for prefix in ("the ", "al-"):
        if t.startswith(prefix):
            t = t[len(prefix):].strip()
            break
    t = " ".join(t.replace("-", " ").split())
    if t.endswith("'s") or t.endswith("\u2019s"):
        t = t[:-2].rstrip()
    return t


def _strip_invisible(text: str) -> str:
    """NBSP→space; zero-width/BOM sil. Anlam taşımaz; tersinirlik gerekmez."""
    return _INVISIBLE_RE.sub("", text.replace("\u00a0", " "))


def _trim_allowlisted_edges(etext: str) -> str:
    """'The Contractor Silverline…' → 'Silverline…'. Ortadaki kelimeye dokunma.
    Sonuç boşalırsa orijinali koru. Ltd gibi hukuki son ek kırpılmaz."""
    parts = etext.split()
    if not parts:
        return etext
    while parts:
        n = _normalize_allow(parts[0])
        if n in _ARTICLES or n in _EDGE_ROLES:
            parts.pop(0)
            continue
        break
    while parts:
        n = _normalize_allow(parts[-1])
        if n in _EDGE_ROLES:
            parts.pop()
            continue
        break
    if not parts:
        return etext
    return " ".join(parts)


def _is_standard_span(etext: str) -> bool:
    """Numaralı standart-kod veya 'ISO standards' / 'ASTM methods' kuyruğu."""
    n = _normalize_allow(etext)
    if _STANDARD_CODE_RE.match(n):
        return True
    parts = n.split()
    if len(parts) >= 2 and parts[0] in _STANDARD_BODIES:
        return all(p in _STANDARD_TAILS for p in parts[1:])
    if n.startswith("bs en"):
        rest = n[5:].strip().split()
        if rest and all(p in _STANDARD_TAILS or any(c.isdigit() for c in p) for p in rest):
            return True
    return False


def _skip_detected_span(etext: str) -> bool:
    """NER span'i maskeleme/has_leak'ten atla: allowlist tam-eşleşme veya standart-kod."""
    return _normalize_allow(etext) in _DONT_MASK or _is_standard_span(etext)


def _normalize(name: str) -> str:
    return name.strip().casefold()


def _usable(name: Any) -> bool:
    if name is None:
        return False
    if not isinstance(name, str):
        return False
    stripped = name.strip()
    return len(stripped) >= _MIN_IDENTITY_LEN


def _ident_pattern(identity: str) -> re.Pattern:
    """Word-bounded + whitespace-flexible: çok-kelimeli kimlik satır-sonu/çoklu
    boşlukla bölünse de eşleşir ('A B' -> 'A\\nB', 'A  B'). Tek-kelime kimlik
    öncekiyle aynı. Ortaya başka kelime giremez (\\s+ yalnız boşluk-koşusu).
    Neden: PDF parse taraf adını satıra böler → registry/has_leak whitespace-literal
    olduğu için bilinen taraf sessiz sızardı (BULGU-1, S10 sınıfı)."""
    toks = identity.split()
    if not toks:
        return re.compile(r"(?!x)x")
    body = r"\s+".join(re.escape(t) for t in toks)
    return re.compile(rf"(?<!\w){body}(?!\w)", re.IGNORECASE)


@dataclass
class MaskSession:
    """real identity string → ⟦TOKEN⟧ and reverse; identities sorted long→short."""

    _mask_pairs: tuple[tuple[str, str], ...]  # (identity, token), long→short
    _demask_pairs: tuple[tuple[str, str], ...]  # (token, identity), long→short
    _detector: Callable[[str], list[tuple[str, str]]] | None = None
    _leak_detector: Callable[[str], list[tuple[str, str]]] | None = None
    _dynamic: dict[str, str] = field(default_factory=dict)
    _dynamic_demask: dict[str, str] = field(default_factory=dict)
    _party_counters: dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_identity_map(
        cls,
        identity_to_token: dict[str, str],
        detector: Callable[[str], list[tuple[str, str]]] | None = None,
        leak_detector: Callable[[str], list[tuple[str, str]]] | None = None,
    ) -> MaskSession:
        mask_pairs = tuple(
            sorted(
                identity_to_token.items(),
                key=lambda kv: len(kv[0]),
                reverse=True,
            )
        )
        demask_pairs = tuple(
            sorted(
                ((token, identity) for identity, token in identity_to_token.items()),
                key=lambda kv: len(kv[0]),
                reverse=True,
            )
        )
        return cls(
            _mask_pairs=mask_pairs,
            _demask_pairs=demask_pairs,
            _detector=detector,
            _leak_detector=leak_detector,
        )

    def mask(self, text: str) -> str:
        """Replace known identities with tokens (case-insensitive, whole-word, long first)."""
        if not text:
            return text
        text = _strip_invisible(text)
        if self._detector is not None:
            self._ingest_detected_spans(self._invoke_detector(self._detector, text))
        pairs = self._combined_mask_pairs()
        if not pairs:
            return text
        out = text
        for identity, token in pairs:
            # Kenar: identity '.' ile bitse re.escape kaçırır; \w '.' saymaz
            # → W.L.L. + boşluk eşleşir. ZenithX (bitişik \w) eşleşmez.
            # Registry/NER span'leri trimli (baş/son boşluk yok).
            out = _ident_pattern(identity).sub(token, out)
        return out

    def _invoke_detector(
        self,
        detector: Callable[[str], list[tuple[str, str]]],
        text: str,
    ) -> list[tuple[str, str]]:
        """Run detector. `gliner` paketi yoksa (CI hermetik) [] — diğer ImportError/hata propagate."""
        try:
            return detector(text)
        except ImportError as exc:
            if getattr(exc, "name", None) == "gliner":
                logger.warning("masking: gliner unavailable; detector skipped")
                return []
            raise

    def _ingest_detected_spans(self, spans: list[tuple[str, str]]) -> None:
        registry_norms = {_normalize(ident) for ident, _tok in self._mask_pairs}
        dynamic_norms = {_normalize(ident) for ident in self._dynamic}
        for etext, label in spans:
            if not _usable(etext) or label not in LABEL_MAP:
                continue
            etext = _trim_allowlisted_edges(etext)
            if not _usable(etext):
                continue
            if _skip_detected_span(etext):
                continue
            norm = _normalize(etext)
            if norm in registry_norms or norm in dynamic_norms:
                continue
            n = self._party_counters.get(label, 0) + 1
            self._party_counters[label] = n
            token = f"⟦{LABEL_MAP[label]}_{n}⟧"
            self._dynamic[etext] = token
            self._dynamic_demask[token] = etext
            dynamic_norms.add(norm)

    def _combined_mask_pairs(self) -> tuple[tuple[str, str], ...]:
        merged = list(self._mask_pairs) + list(self._dynamic.items())
        merged.sort(key=lambda kv: len(kv[0]), reverse=True)
        return tuple(merged)

    def mask_context(self, ctx: dict) -> dict:
        """Recursively mask all str values in a dict (and list/tuple children)."""
        return self._mask_value(ctx)  # type: ignore[return-value]

    def _mask_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.mask(value)
        if isinstance(value, dict):
            return {k: self._mask_value(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._mask_value(v) for v in value]
        if isinstance(value, tuple):
            return tuple(self._mask_value(v) for v in value)
        return value

    def demask(self, text: str) -> str:
        """⟦TOKEN⟧ → real identity (exact, case-sensitive)."""
        if not text:
            return text
        pairs = list(self._demask_pairs) + list(self._dynamic_demask.items())
        if not pairs:
            return text
        pairs.sort(key=lambda kv: len(kv[0]), reverse=True)
        out = text
        for token, identity in pairs:
            out = out.replace(token, identity)
        return out

    def has_leak(self, text: str) -> bool:
        """Saf fail-closed doğrulayıcı (INV-MASK-4). Payload'ı DEĞİŞTİRMEZ.
        True eğer: (a) bozuk-token, (b) registry-taraf ham kalıntısı, (c) leak_detector
        (mask ile AYNI eşik) allowlist-dışı NER-entity bulursa. Simetri → mask'in
        maskelediğini bulmaz (over-block yok); kaçırdığını bulursa fail-closed blok.
        recover DEĞİL: has_leak payload'a erişemez, yerel-recover sessiz sızıntı yapardı."""
        if not text:
            return False
        text = _strip_invisible(text)
        residual = _TOKEN_RE.sub(" ", text)
        if "⟦" in residual or "⟧" in residual:
            return True
        if self._mask_pairs:
            for identity, _token in self._mask_pairs:
                if _ident_pattern(identity).search(residual):
                    return True
        if self._leak_detector is not None:
            for etext, label in self._invoke_detector(self._leak_detector, residual):
                if label in LABEL_MAP and not _skip_detected_span(etext):
                    return True
        return False


class MaskingProvider:
    """Builds a request-scoped MaskSession from project identity sources (SELECT only)."""

    def __init__(self, db):
        self.db = db

    def build(self, project_id: str) -> MaskSession | None:
        """Collect identities from projects, contract_parties, project_parties.

        Returns None when the primary source (projects row) is missing or the
        resulting registry is empty — caller must fail-closed.
        """
        # identity_key (normalized) → (display_name, token)
        by_norm: dict[str, tuple[str, str]] = {}
        # role → token already claimed by a display name
        role_claimed: dict[str, str] = {}
        party_names: list[str] = []

        project = self._load_project(project_id)
        if project is None:
            return None

        self._register_role(
            by_norm, role_claimed, project.get("employer_name"), "employer"
        )
        self._register_role(
            by_norm, role_claimed, project.get("contractor_name"), "contractor"
        )
        self._register_role(
            by_norm, role_claimed, project.get("engineer_name"), "engineer"
        )
        if _usable(project.get("name")):
            display = project["name"].strip()
            norm = _normalize(display)
            if norm not in by_norm:
                by_norm[norm] = (display, _PROJECT_TOKEN)

        # TB-40: supplementary sources must not fail-open — incomplete registry
        # would leave known parties unmasked. Load error → fail-closed (None).
        contract_parties = self._load_contract_parties(project_id)
        if contract_parties is None:
            return None
        for role, name in contract_parties:
            if not _usable(name):
                continue
            display = name.strip()
            norm = _normalize(display)
            if norm in by_norm:
                continue  # dedup (role, normalized-name) / any prior identity
            if role in _ROLE_TOKENS:
                token = _ROLE_TOKENS[role]
                if role in role_claimed and role_claimed[role] != norm:
                    # Same role, different name → keep bijection via PARTY_n
                    party_names.append(display)
                else:
                    by_norm[norm] = (display, token)
                    role_claimed[role] = norm
            else:
                # role == 'other' (or unknown)
                party_names.append(display)

        project_parties = self._load_project_parties(project_id)
        if project_parties is None:
            return None
        for name in project_parties:
            if not _usable(name):
                continue
            display = name.strip()
            norm = _normalize(display)
            if norm in by_norm:
                continue
            party_names.append(display)

        # ⟦PARTY_n⟧ index deterministic: sort by normalized name
        unique_parties: list[str] = []
        seen_party: set[str] = set()
        for display in sorted(party_names, key=_normalize):
            norm = _normalize(display)
            if norm in by_norm or norm in seen_party:
                continue
            seen_party.add(norm)
            unique_parties.append(display)

        for i, display in enumerate(unique_parties, start=1):
            by_norm[_normalize(display)] = (display, f"⟦PARTY_{i}⟧")

        identity_to_token = {display: token for display, token in by_norm.values()}
        if not identity_to_token:
            return None
        return MaskSession.from_identity_map(
            identity_to_token,
            detector=lambda t: detect_identity_spans(t),
            leak_detector=lambda t: detect_identity_spans(t, threshold=_LEAK_THRESHOLD),
        )

    def _register_role(
        self,
        by_norm: dict[str, tuple[str, str]],
        role_claimed: dict[str, str],
        name: Any,
        role: str,
    ) -> None:
        if not _usable(name):
            return
        display = name.strip()
        norm = _normalize(display)
        if norm in by_norm:
            return
        token = _ROLE_TOKENS[role]
        by_norm[norm] = (display, token)
        role_claimed[role] = norm

    def _load_project(self, project_id: str) -> dict | None:
        try:
            result = (
                self.db.table("projects")
                .select("name, employer_name, contractor_name, engineer_name")
                .eq("id", project_id)
                .limit(1)
                .execute()
            )
            rows = result.data or []
            return rows[0] if rows else None
        except Exception as exc:  # noqa: BLE001
            logger.warning("masking: projects read failed: %s", exc)
            return None

    def _load_contract_parties(
        self, project_id: str
    ) -> list[tuple[str, str]] | None:
        """Return (role, name) pairs, or None on load failure (TB-40 fail-closed)."""
        try:
            contracts = (
                self.db.table("contracts")
                .select("id")
                .eq("project_id", project_id)
                .eq("is_deleted", False)
                .execute()
            )
            ids = [row["id"] for row in (contracts.data or []) if row.get("id")]
            if not ids:
                return []
            parties = (
                self.db.table("contract_parties")
                .select("role, name")
                .in_("contract_id", ids)
                .execute()
            )
            out: list[tuple[str, str]] = []
            for row in parties.data or []:
                role = (row.get("role") or "").strip()
                name = row.get("name")
                if role and name:
                    out.append((role, name))
            return out
        except Exception as exc:  # noqa: BLE001
            logger.warning("masking: contract_parties read failed: %s", exc)
            return None

    def _load_project_parties(self, project_id: str) -> list[str] | None:
        """Return party names, or None on load failure (TB-40 fail-closed)."""
        try:
            result = (
                self.db.table("project_parties")
                .select("party_name")
                .eq("project_id", project_id)
                .eq("is_active", True)
                .execute()
            )
            return [
                row["party_name"]
                for row in (result.data or [])
                if row.get("party_name")
            ]
        except Exception as exc:  # noqa: BLE001
            logger.warning("masking: project_parties read failed: %s", exc)
            return None


# --- Semantik NER katmanı (S2a; ADR-0004 INV-MASK-1/2/3) ---
_NER_MODEL_NAME = "urchade/gliner_multi-v2.1"  # vendor-pin (INV-MASK-2)
_IDENTITY_LABELS = ["person", "organization", "location"]
_NER_THRESHOLD = 0.4  # recall-öncelik (INV-MASK-4); S3'te tune
_LEAK_THRESHOLD = _NER_THRESHOLD  # has_leak = mask ile SİMETRİK (INV-MASK-4). Asimetri (leak<mask) = TB-64 over-block; tek-kaynak → drift imkansız.
_ner_model = None  # process-lifetime singleton


def _get_ner_model():
    """Lazy + tek-sefer yükleme (ADR-0001/INV-MASK-2). gliner IMPORT FONKSİYON İÇİNDE
    (top-level DEĞİL) → CI (gliner'sız) `import backend.main`'i kırmaz."""
    global _ner_model
    if _ner_model is None:
        from gliner import GLiNER  # lazy — CI hermetik
        _ner_model = GLiNER.from_pretrained(_NER_MODEL_NAME)
    return _ner_model


def detect_identity_spans(
    text: str, threshold: float | None = None
) -> list[tuple[str, str]]:
    """(entity_text, label) listesi. Boş/kısa metin → []. Model/inference hatası
    PROPAGATE eder (çağıran fail-closed: build()→None, INV-MASK-3).
    """
    if not _usable(text):
        return []
    model = _get_ner_model()
    thresh = _NER_THRESHOLD if threshold is None else threshold
    preds = model.predict_entities(text, _IDENTITY_LABELS, threshold=thresh)
    return [(pred["text"], pred["label"]) for pred in preds]
