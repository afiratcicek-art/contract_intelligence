import { createContext, useCallback, useContext, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "tr" | "en" | "ar";

/** Cycle order for the chrome toggle. */
export const LANGS: Lang[] = ["en", "tr", "ar"];

/** Short codes shown on the toggle — Latin so they stay legible in --font-meta. */
export const LANG_CODES: Record<Lang, string> = { en: "EN", tr: "TR", ar: "AR" };

/** Endonyms — a language picker should name itself in its own language. */
export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  tr: "Türkçe",
  ar: "العربية",
};

interface LanguageContextValue {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (next: Lang) => void;
  toggle: () => void;
  t: (key: string) => string;
}

const TRANSLATIONS: Record<string, Record<Lang, string>> = {
  // Nav
  "nav.projects": { tr: "Projeler", en: "Projects", ar: "المشاريع" },
  "nav.overview": { tr: "Genel Bakış", en: "Overview", ar: "نظرة عامة" },
  "nav.workspace": { tr: "Çalışma Alanı", en: "Workspace", ar: "مساحة العمل" },
  "nav.signout": { tr: "Çıkış", en: "Sign out", ar: "تسجيل الخروج" },
  // Sidebar
  "module.general": { tr: "Genel", en: "General", ar: "عام" },
  "module.correspondence": { tr: "Yazışmalar", en: "Correspondence", ar: "المراسلات" },
  "module.rfis": { tr: "RFI'lar", en: "RFIs", ar: "طلبات المعلومات" },
  "module.changes": { tr: "Değişiklikler", en: "Changes", ar: "التغييرات" },
  "module.deliverables": { tr: "Yükümlülükler", en: "Deliverables", ar: "الالتزامات" },
  "module.chronologies": { tr: "Kronoloji", en: "Chronologies", ar: "التسلسل الزمني" },
  "module.disputes": { tr: "İhtilaf Dosyesi", en: "Dispute Ready", ar: "ملف النزاع" },
  "module.documents": { tr: "Belgeler", en: "Documents", ar: "المستندات" },
  "module.intelligence": { tr: "Zeka", en: "Intelligence", ar: "الذكاء" },
  "module.config": { tr: "Ayarlar", en: "Config", ar: "الإعدادات" },
  "module.system": { tr: "Sistem", en: "System", ar: "النظام" },
  "module.alerts": { tr: "Uyarılar ve Aksiyonlar", en: "Alerts & Actions", ar: "التنبيهات والإجراءات" },
  "module.contracts": { tr: "Sözleşmeler ve Zeyilnameler", en: "Contracts & Amendments", ar: "العقود والتعديلات" },
  // General
  "general.title": { tr: "Genel Arama", en: "General Search", ar: "بحث عام" },
  "general.placeholder": { tr: "Kelime veya ifade yazın...", en: "Search by keyword...", ar: "ابحث بكلمة مفتاحية..." },
  "general.searching": { tr: "Aranıyor...", en: "Searching...", ar: "جارٍ البحث..." },
  "general.noresults": { tr: "Sonuç bulunamadı.", en: "No results found.", ar: "لا توجد نتائج." },
  // Filters
  "filter.all": { tr: "Tümü", en: "All", ar: "الكل" },
  "filter.allstatus": { tr: "Tüm Durumlar", en: "All Status", ar: "جميع الحالات" },
  "filter.alldirections": { tr: "Tüm Yönler", en: "All Directions", ar: "جميع الاتجاهات" },
  "filter.alldisciplines": { tr: "Tüm Disiplinler", en: "All Disciplines", ar: "جميع التخصصات" },
  "filter.allorigins": { tr: "Tüm Kaynak", en: "All Origins", ar: "جميع المصادر" },
  "filter.incoming": { tr: "← Gelen", en: "← Incoming", ar: "وارد" },
  "filter.outgoing": { tr: "Giden →", en: "Outgoing →", ar: "صادر" },
  "filter.issuedate": { tr: "İşlenen Tarih", en: "Issue Date", ar: "تاريخ الإصدار" },
  "filter.duedate": { tr: "Son Tarih", en: "Due Date", ar: "تاريخ الاستحقاق" },
  "filter.submitteddate": { tr: "Gönderim Tarihi", en: "Submitted Date", ar: "تاريخ التقديم" },
  "filter.createddate": { tr: "Oluşturma Tarihi", en: "Created Date", ar: "تاريخ الإنشاء" },
  "filter.date": { tr: "Tarih", en: "Date", ar: "التاريخ" },
  "filter.search": { tr: "Ara...", en: "Search...", ar: "بحث..." },
  // Status
  "status.open": { tr: "Açık", en: "Open", ar: "مفتوح" },
  "status.draft": { tr: "Taslak", en: "Draft", ar: "مسودة" },
  "status.under_review": { tr: "İncelemede", en: "Under Review", ar: "قيد المراجعة" },
  "status.approved": { tr: "Onaylandı", en: "Approved", ar: "معتمد" },
  "status.published": { tr: "Yayınlandı", en: "Published", ar: "منشور" },
  "status.closed": { tr: "Kapalı", en: "Closed", ar: "مغلق" },
  "status.overdue": { tr: "Gecikmiş", en: "Overdue", ar: "متأخر" },
  "status.pending": { tr: "Bekliyor", en: "Pending", ar: "قيد الانتظار" },
  "status.fulfilled": { tr: "İfa edildi", en: "Fulfilled", ar: "تم الوفاء" },
  "status.in_progress": { tr: "Devam Ediyor", en: "In Progress", ar: "قيد التنفيذ" },
  "status.responded": { tr: "Yanıtlandı", en: "Responded", ar: "تم الرد" },
  "status.rejected": { tr: "Reddedildi", en: "Rejected", ar: "مرفوض" },
  "status.active": { tr: "Aktif", en: "Active", ar: "نشط" },
  "status.submitted": { tr: "Gönderildi", en: "Submitted", ar: "تم التقديم" },
  "status.identified": { tr: "Tespit Edildi", en: "Identified", ar: "تم التحديد" },
  "status.agreed": { tr: "Mutabık", en: "Agreed", ar: "متفق عليه" },
  "status.disputed": { tr: "İhtilaflı", en: "Disputed", ar: "متنازع عليه" },
  "status.prepared": { tr: "Hazır", en: "Prepared", ar: "مُعدّ" },
  "status.completed": { tr: "Tamamlandı", en: "Completed", ar: "مكتمل" },
  "status.not_applicable": { tr: "Uygulanamaz", en: "Not Applicable", ar: "غير منطبق" },
  "status.expiring_soon": { tr: "Süresi Doluyor", en: "Expiring Soon", ar: "ينتهي قريباً" },
  "status.cancelled": { tr: "İptal", en: "Cancelled", ar: "ملغى" },
  "status.on_hold": { tr: "Beklemede", en: "On Hold", ar: "معلّق" },
  "status.actioned": { tr: "İşlem Yapıldı", en: "Actioned", ar: "تم اتخاذ إجراء" },
  "status.snoozed": { tr: "Ertelendi", en: "Snoozed", ar: "مؤجل" },
  "status.dismissed": { tr: "Kapatıldı", en: "Dismissed", ar: "تم الصرف" },
  // Priority — rendered raw ("critical") before.
  "priority.critical": { tr: "Kritik", en: "Critical", ar: "حرج" },
  "priority.high": { tr: "Yüksek", en: "High", ar: "مرتفع" },
  "priority.normal": { tr: "Normal", en: "Normal", ar: "عادي" },
  "priority.low": { tr: "Düşük", en: "Low", ar: "منخفض" },
  // Chain — the parent/child thread that ties a correspondence group together
  "unit.days": { tr: "{n} gün", en: "{n}d", ar: "{n} يوم" },
  "chain.label": { tr: "Zincir", en: "Chain", ar: "السلسلة" },
  "chain.responses": { tr: "Yanıtlar / Revizeler", en: "Responses / Revisions", ar: "الردود / المراجعات" },
  "chain.inchain": { tr: "Zincirde", en: "In Chain", ar: "ضمن السلسلة" },
  "chain.notlatest": { tr: "Bu, yazışma zincirinin en güncel belgesi değil.", en: "This is not the latest document in the correspondence chain.", ar: "هذه ليست أحدث وثيقة في سلسلة المراسلات." },
  "chain.golatest": { tr: "En Güncele Git", en: "Go to Latest", ar: "الانتقال إلى الأحدث" },
  // Table headers
  "col.no": { tr: "No.", en: "No.", ar: "رقم" },
  "col.subject": { tr: "Konu", en: "Subject", ar: "الموضوع" },
  "col.direction": { tr: "Yön", en: "Direction", ar: "الاتجاه" },
  "col.date": { tr: "Tarih", en: "Date", ar: "التاريخ" },
  "col.deadline": { tr: "Son Tarih", en: "Deadline", ar: "الموعد النهائي" },
  "col.status": { tr: "Durum", en: "Status", ar: "الحالة" },
  "col.discipline": { tr: "Disiplin", en: "Discipline", ar: "التخصص" },
  "col.submitted": { tr: "Gönderildi", en: "Submitted", ar: "تاريخ التقديم" },
  "col.due": { tr: "Son Tarih", en: "Due", ar: "الاستحقاق" },
  "col.title": { tr: "Başlık", en: "Title", ar: "العنوان" },
  "col.origin": { tr: "Kaynak", en: "Origin", ar: "المصدر" },
  "col.category": { tr: "Kategori", en: "Category", ar: "الفئة" },
  "col.duedate": { tr: "Son Tarih", en: "Due Date", ar: "تاريخ الاستحقاق" },
  "col.noticedue": { tr: "İhbar Süresi", en: "Notice Due", ar: "موعد الإشعار" },
  "col.type": { tr: "Tür", en: "Type", ar: "النوع" },
  // Actions
  "action.newcorrespondence": { tr: "+ Yeni Yazışma", en: "+ New Correspondence", ar: "+ مراسلة جديدة" },
  "action.newrfi": { tr: "+ Yeni RFI", en: "+ New RFI", ar: "+ طلب معلومات جديد" },
  "action.newchange": { tr: "+ Yeni Değişiklik", en: "+ New Change", ar: "+ تغيير جديد" },
  "action.newdeliverable": { tr: "+ Yeni Yükümlülük", en: "+ New Deliverable", ar: "+ التزام جديد" },
  "action.newdispute": { tr: "+ Yeni İhtilaf", en: "+ New Dispute", ar: "+ نزاع جديد" },
  "action.opendispute": { tr: "İhtilaf olarak aç", en: "Open as dispute", ar: "فتح كنزاع" },
  "action.add": { tr: "Ekle", en: "Add", ar: "إضافة" },
  "action.register": { tr: "Kayıt Et", en: "Register", ar: "تسجيل" },
  "action.create": { tr: "Oluştur", en: "Create", ar: "إنشاء" },
  "action.addresponse": { tr: "↩ Yanıt Ekle", en: "↩ Add Response", ar: "إضافة رد" },
  "action.addrevision": { tr: "↺ Revize Ekle", en: "↺ Add Revision", ar: "إضافة مراجعة" },
  "action.writeresponse": { tr: "↩ Yanıt Yaz", en: "↩ Write Response", ar: "كتابة رد" },
  "action.addfollowup": { tr: "+ Followup Ekle", en: "+ Add Followup", ar: "+ إضافة متابعة" },
  "action.retry": { tr: "Tekrar Dene", en: "Retry", ar: "إعادة المحاولة" },
  "action.save": { tr: "Kaydet", en: "Save", ar: "حفظ" },
  "action.cancel": { tr: "Vazgeç", en: "Cancel", ar: "إلغاء" },
  "action.edit": { tr: "Düzenle", en: "Edit", ar: "تحرير" },
  "action.delete": { tr: "Sil", en: "Delete", ar: "حذف" },
  "action.approve": { tr: "Onayla", en: "Approve", ar: "اعتماد" },
  "action.close": { tr: "Kapat", en: "Close", ar: "إغلاق" },
  "action.new": { tr: "+ Yeni", en: "+ New", ar: "+ جديد" },
  "action.view": { tr: "Görüntüle", en: "View", ar: "عرض" },
  "action.remove": { tr: "Kaldır", en: "Remove", ar: "إزالة" },
  "common.optional": { tr: "(isteğe bağlı)", en: "(optional)", ar: "(اختياري)" },
  "common.failed": { tr: "İşlem başarısız.", en: "Failed.", ar: "فشلت العملية." },
  "common.savefailed": { tr: "Kaydedilemedi. Tekrar deneyin.", en: "Save failed. Please try again.", ar: "فشل الحفظ. حاول مرة أخرى." },
  // States
  "state.loading": { tr: "Yükleniyor...", en: "Loading...", ar: "جارٍ التحميل..." },
  "state.saving": { tr: "Kaydediliyor...", en: "Saving...", ar: "جارٍ الحفظ..." },
  "state.generating": { tr: "Üretiliyor...", en: "Generating...", ar: "جارٍ التوليد..." },
  "state.comingsoon": { tr: "Yakında burada olacak.", en: "Coming soon.", ar: "قريباً." },
  "state.nocorrespondence": { tr: "Yazışma bulunamadı.", en: "No correspondence found.", ar: "لا توجد مراسلات." },
  "state.norfis": { tr: "RFI bulunamadı.", en: "No RFIs found.", ar: "لا توجد طلبات معلومات." },
  "state.nochanges": { tr: "Değişiklik bulunamadı.", en: "No changes found.", ar: "لا توجد تغييرات." },
  "state.nodeliverables": { tr: "Yükümlülük bulunamadı.", en: "No deliverables found.", ar: "لا توجد التزامات." },
  "state.nodisputes": { tr: "İhtilaf dosyası bulunamadı.", en: "No dispute dossiers found.", ar: "لا توجد ملفات نزاع." },
  "state.precompletion": { tr: "Tamamlama Öncesi", en: "Pre-completion", ar: "ما قبل الإنجاز" },
  "state.pendingdetail": { tr: "detay bekleniyor", en: "pending detail", ar: "في انتظار التفاصيل" },
  // Load failures — absence of data must never look like an empty result set.
  "state.loadfailed": {
    tr: "Kayıtlar yüklenemedi. Bu, kayıt olmadığı anlamına gelmez.",
    en: "Could not load records. This does not mean there are none.",
    ar: "تعذّر تحميل السجلات. هذا لا يعني عدم وجود سجلات.",
  },
  // Result truncation — a silently capped list is a false negative in a claim.
  "state.truncated": {
    tr: "Yalnızca ilk {n} kayıt gösteriliyor. Liste eksik — daraltmak için filtre kullanın.",
    en: "Showing the first {n} records only. This list is incomplete — narrow it with filters.",
    ar: "يتم عرض أول {n} سجل فقط. القائمة غير كاملة — استخدم عوامل التصفية لتضييقها.",
  },
  // Login
  "login.title": { tr: "Oturum Aç", en: "Sign In", ar: "تسجيل الدخول" },
  "login.subtitle": { tr: "Devam etmek için giriş yapın.", en: "Sign in to continue.", ar: "سجّل الدخول للمتابعة." },
  "login.email": { tr: "E-POSTA", en: "EMAIL", ar: "البريد الإلكتروني" },
  "login.password": { tr: "ŞİFRE", en: "PASSWORD", ar: "كلمة المرور" },
  "login.remember": { tr: "E-posta adresimi hatırla", en: "Remember my email", ar: "تذكّر بريدي الإلكتروني" },
  "login.button": { tr: "Giriş Yap", en: "Sign In", ar: "تسجيل الدخول" },
  "login.loading": { tr: "Giriş yapılıyor...", en: "Signing in...", ar: "جارٍ تسجيل الدخول..." },
  "brand.tagline": {
    tr: "Sözleşme & Operasyonel Zeka",
    en: "Contract & Operational Intelligence",
    ar: "ذكاء تعاقدي وتشغيلي",
  },
  "brand.motto": {
    // Pre-cased: CSS text-transform:uppercase breaks Turkish i→İ (renders I).
    tr: "HASSASİYET. UYUM. KONTROL.",
    en: "PRECISION. COMPLIANCE. CONTROL.",
    ar: "الدقة. الامتثال. التحكم.",
  },
  "brand.motto_body": {
    tr: "Her bildirim, her süre, her yazışma — sözleşmesel hassasiyetle yönetilir.",
    en: "Every notice, every deadline, every correspondence — managed with contractual precision.",
    ar: "كل إشعار، كل موعد نهائي، كل مراسلة — تُدار بدقة تعاقدية.",
  },
  "brand.footer": { tr: "ClauseIQ · 2026", en: "ClauseIQ · 2026", ar: "ClauseIQ · 2026" },
  "inforce.loading": { tr: "Yükleniyor...", en: "Loading...", ar: "جارٍ التحميل..." },
  "inforce.error": {
    tr: "Yürürlük bilgisi yüklenemedi.",
    en: "Could not load in-force resolution.",
    ar: "تعذّر تحميل معلومات السريان.",
  },
  "inforce.tab.working": { tr: "Değişiklikler", en: "Working", ar: "التغييرات" },
  "inforce.tab.inforce": { tr: "Yürürlük", en: "In-Force", ar: "السريان" },
  "inforce.commencement": { tr: "Başlangıç", en: "Commencement", ar: "البدء" },
  "inforce.duration": { tr: "Süre", en: "Duration", ar: "المدة" },
  "inforce.dlp": { tr: "DLP", en: "DLP", ar: "DLP" },
  "inforce.dlpvalue": {
    tr: "{n} gün (fiili tamamlanmadan türetilir)",
    en: "{n}d (from actual completion)",
    ar: "{n} يوم (يُشتق من الإنجاز الفعلي)",
  },
  "inforce.type": { tr: "Tip", en: "Type", ar: "النوع" },
  "inforce.amendments": { tr: "Zeyilnameler", en: "Amendments", ar: "التعديلات" },
  "inforce.noamendments": {
    tr: "Kayıtlı zeyilname yok — sözleşme değişmemiş halde yürürlükte",
    en: "No amendments on record — the contract is in force as signed",
    ar: "لا توجد تعديلات مسجّلة — العقد ساري كما وُقّع",
  },
  "inforce.changeorders": { tr: "Değişiklik Emirleri", en: "Change Orders", ar: "أوامر التغيير" },
  "inforce.nochangeorders": {
    tr: "Yürürlükte değişiklik emri yok",
    en: "No change orders in force",
    ar: "لا توجد أوامر تغيير سارية",
  },
  "inforce.badge.contract": { tr: "Sözleşme · Yürürlükte", en: "Contract · In force", ar: "عقد · ساري" },
  "inforce.badge.amendment": { tr: "Zeyilname", en: "Amendment", ar: "تعديل" },
  "inforce.governedby": {
    tr: "Zeyilname ile yönetiliyor: {n}",
    en: "Governed by amendment: {n}",
    ar: "يُدار بموجب التعديل: {n}",
  },
  "inforce.amendmentpending": {
    tr: "kabul edildi, zeyilname bekliyor",
    en: "agreed, amendment pending",
    ar: "متفق عليه، بانتظار التعديل",
  },
  "inforce.opendoc": { tr: "Belgeyi aç", en: "Open document", ar: "فتح المستند" },
  "inforce.path.letter": { tr: "Yazışma", en: "Letter", ar: "مراسلة" },
  "inforce.path.change_order": { tr: "Değişiklik emri", en: "Change order", ar: "أمر تغيير" },
  "inforce.path.standalone": { tr: "Bağımsız", en: "Standalone", ar: "مستقل" },
  "inforce.setup.title": { tr: "Sözleşme henüz kaydedilmedi", en: "Contract not yet recorded", ar: "العقد غير مسجّل بعد" },
  "inforce.setup.body": {
    tr: "Sözleşme bu projenin çıpasıdır: yürürlük hiyerarşisi, zeyilnameler ve ileride yapay zekâ analizleri bu kayda dayanır. Kaydı sözleşme yöneticisi (CM) yapar — bilgiler asıl sözleşme belgesinden aktarılır.",
    en: "The contract is this project's anchor: the in-force hierarchy, amendments, and later AI analysis rest on this record. The Contract Manager files it — details are taken from the signed contract.",
    ar: "العقد هو مرتكز هذا المشروع: تسلسل السريان والتعديلات وتحليلات الذكاء الاصطناعي اللاحقة تعتمد على هذا السجل. يسجّله مدير العقد — تُنقل البيانات من وثيقة العقد الأصلية.",
  },
  "inforce.setup.name": { tr: "Sözleşme adı *", en: "Contract title *", ar: "اسم العقد *" },
  "inforce.setup.number": { tr: "Sözleşme no", en: "Contract no.", ar: "رقم العقد" },
  "inforce.setup.ctype": { tr: "Sözleşme tipi", en: "Contract type", ar: "نوع العقد" },
  "inforce.setup.fromproject": { tr: "— (projeden alınır)", en: "— (from project)", ar: "— (من المشروع)" },
  "inforce.setup.durationdays": { tr: "Süre (gün)", en: "Duration (days)", ar: "المدة (أيام)" },
  "inforce.setup.dlpdays": { tr: "DLP süresi (gün)", en: "DLP period (days)", ar: "مدة DLP (أيام)" },
  "inforce.setup.save": { tr: "Sözleşmeyi Kaydet", en: "Save contract", ar: "حفظ العقد" },
  "inforce.setup.savefailed": {
    tr: "Sözleşme kaydedilemedi. Yetkinizi (CM) ve alanları kontrol edin.",
    en: "Could not save the contract. Check your CM role and the fields.",
    ar: "تعذّر حفظ العقد. تحقق من صلاحية مدير العقد والحقول.",
  },
  "inforce.docs.title": {
    tr: "Sözleşme belgeleri (öncelik sırası)",
    en: "Contract documents (order of precedence)",
    ar: "مستندات العقد (ترتيب الأولوية)",
  },
  "inforce.docs.empty": { tr: "Henüz bağlı belge yok", en: "No documents linked yet", ar: "لا توجد مستندات مرتبطة بعد" },
  "inforce.docs.waiting": { tr: "dosya bekleniyor", en: "file pending", ar: "الملف قيد الانتظار" },
  "inforce.docs.choosefile": { tr: "Dosya Seç", en: "Choose File", ar: "اختر ملفاً" },
  "inforce.docs.formats": {
    tr: "PDF, Word, Excel, PowerPoint, Görsel, DWG, DXF, TXT, CSV",
    en: "PDF, Word, Excel, PowerPoint, Image, DWG, DXF, TXT, CSV",
    ar: "PDF، Word، Excel، PowerPoint، صورة، DWG، DXF، TXT، CSV",
  },
  "inforce.docs.appendices": { tr: "Ekler", en: "Appendices", ar: "الملاحق" },
  "inforce.docs.appendname": { tr: "Ek adı", en: "Appendix name", ar: "اسم الملحق" },
  "inforce.docs.appendph": {
    tr: "ör. EK-1 Özel Şartname",
    en: "e.g. App. A — Particular Spec",
    ar: "مثال: الملحق أ — المواصفات الخاصة",
  },
  "inforce.docs.file": { tr: "Dosya", en: "File", ar: "ملف" },
  "inforce.docs.add": { tr: "Ekle", en: "Add", ar: "إضافة" },
  "inforce.docs.addrow": { tr: "+ Satır ekle", en: "+ Add row", ar: "+ إضافة صف" },
  "inforce.docs.rankup": { tr: "Yukarı (öncelik artar)", en: "Move up (higher precedence)", ar: "أعلى (أولوية أكبر)" },
  "inforce.docs.rankdown": { tr: "Aşağı (öncelik azalır)", en: "Move down (lower precedence)", ar: "أسفل (أولوية أقل)" },
  "inforce.docs.remove": { tr: "Sözleşmeden kaldır", en: "Remove from contract", ar: "إزالة من العقد" },
  "inforce.docs.removerow": { tr: "Satırı kaldır", en: "Remove row", ar: "إزالة الصف" },
  "inforce.docs.fallback": { tr: "bu belge", en: "this document", ar: "هذا المستند" },
  "inforce.docs.unlinkconfirm": {
    tr: '"{n}" sözleşmeden kaldırılsın mı?\n(Dosya Belgeler\'de kalır — yalnızca bağ kopar.)',
    en: 'Remove "{n}" from the contract?\n(The file stays in Documents — only the link is removed.)',
    ar: 'هل تريد إزالة "{n}" من العقد؟\n(يبقى الملف في المستندات — تُقطع الصلة فقط.)',
  },
  "inforce.docs.err.order": {
    tr: "Sıra kaydedilemedi. CM yetkinizi kontrol edin.",
    en: "Could not save order. Check your CM role.",
    ar: "تعذّر حفظ الترتيب. تحقق من صلاحية مدير العقد.",
  },
  "inforce.docs.err.upload": {
    tr: "Belge yüklenemedi. CM yetkinizi ve dosya formatını kontrol edin.",
    en: "Could not upload the document. Check your CM role and the file format.",
    ar: "تعذّر رفع المستند. تحقق من صلاحية مدير العقد وصيغة الملف.",
  },
  "inforce.docs.err.appendix": {
    tr: "Ek kaydedilemedi. CM yetkinizi ve alanları kontrol edin.",
    en: "Could not save the appendix. Check your CM role and the fields.",
    ar: "تعذّر حفظ الملحق. تحقق من صلاحية مدير العقد والحقول.",
  },
  "inforce.docs.err.attach": { tr: "Dosya eklenemedi.", en: "Could not attach the file.", ar: "تعذّر إرفاق الملف." },
  "inforce.docs.err.unlink": {
    tr: "Belge kaldırılamadı. CM yetkinizi kontrol edin.",
    en: "Could not remove the document. Check your CM role.",
    ar: "تعذّرت إزالة المستند. تحقق من صلاحية مدير العقد.",
  },
  "party.employer": { tr: "İşveren", en: "Employer", ar: "صاحب العمل" },
  "party.contractor": { tr: "Yüklenici", en: "Contractor", ar: "المقاول" },
  "party.engineer": { tr: "Mühendis", en: "Engineer", ar: "المهندس" },
  "party.other": { tr: "Diğer", en: "Other", ar: "أخرى" },
  "contract.type.lump_sum": { tr: "Götürü Bedel", en: "Lump Sum", ar: "مبلغ إجمالي" },
  "contract.type.remeasure": { tr: "Birim Fiyat", en: "Remeasure", ar: "إعادة قياس" },
  "contract.type.cost_plus": { tr: "Maliyet + Kâr", en: "Cost Plus", ar: "التكلفة زائد" },
  "contract.type.target_cost": { tr: "Hedef Maliyet", en: "Target Cost", ar: "التكلفة المستهدفة" },
  "contract.type.epc": { tr: "EPC", en: "EPC", ar: "EPC" },
  "contract.type.epcm": { tr: "EPCM", en: "EPCM", ar: "EPCM" },
  "contract.type.framework": { tr: "Çerçeve Sözleşme", en: "Framework", ar: "اتفاقية إطارية" },
  "contract.type.other": { tr: "Diğer", en: "Other", ar: "أخرى" },
  "origin.client": { tr: "İşveren", en: "Client", ar: "العميل" },
  "origin.contractor": { tr: "Yüklenici", en: "Contractor", ar: "المقاول" },
  "origin.engineer": { tr: "Mühendis", en: "Engineer", ar: "المهندس" },
  "origin.variation": { tr: "Varyasyon", en: "Variation", ar: "تغيير" },
  "origin.other": { tr: "Diğer", en: "Other", ar: "أخرى" },
  "discipline.civil": { tr: "İnşaat", en: "Civil", ar: "مدني" },
  "discipline.architectural": { tr: "Mimari", en: "Architectural", ar: "معماري" },
  "discipline.structural": { tr: "Strüktür", en: "Structural", ar: "إنشائي" },
  "discipline.mechanical": { tr: "Mekanik", en: "Mechanical", ar: "ميكانيكي" },
  "discipline.electrical": { tr: "Elektrik", en: "Electrical", ar: "كهربائي" },
  "discipline.plumbing": { tr: "Tesisat", en: "Plumbing", ar: "سباكة" },
  "discipline.other": { tr: "Diğer", en: "Other", ar: "أخرى" },
  // Dashboard
  "dashboard.title": { tr: "Projeler", en: "Projects", ar: "المشاريع" },
  "dashboard.subtitle": { tr: "Devam etmek için bir proje seçin.", en: "Select a project to continue.", ar: "اختر مشروعاً للمتابعة." },
  "dashboard.newproject": { tr: "+ Yeni Proje", en: "+ New Project", ar: "+ مشروع جديد" },
  "dashboard.empty": { tr: "Henüz proje yok", en: "No projects yet", ar: "لا توجد مشاريع بعد" },
  "dashboard.emptyhint": { tr: "Başlamak için ilk projenizi oluşturun.", en: "Create your first project to get started.", ar: "ابدأ بإنشاء مشروعك الأول." },
  "project.notfound": { tr: "Proje bulunamadı.", en: "Project not found.", ar: "لم يتم العثور على المشروع." },
  "project.newhint": { tr: "Sözleşme taraflarını ve temel künyeyi girin.", en: "Enter the contracting parties and basic record.", ar: "أدخل أطراف العقد والبيانات الأساسية." },
  "project.field.name": { tr: "Proje adı", en: "Project name", ar: "اسم المشروع" },
  "project.field.value": { tr: "Sözleşme bedeli", en: "Contract value", ar: "قيمة العقد" },
  "project.field.currency": { tr: "Para birimi", en: "Currency", ar: "العملة" },
  "project.field.start": { tr: "Başlangıç", en: "Start date", ar: "تاريخ البدء" },
  "project.field.end": { tr: "Bitiş", en: "End date", ar: "تاريخ الانتهاء" },
  "project.field.type": { tr: "Sözleşme tipi", en: "Contract type", ar: "نوع العقد" },
  "project.field.typenone": { tr: "Seçilmedi", en: "Not selected", ar: "غير محدد" },
  "authoring.opening": { tr: "Taslak açılıyor…", en: "Opening draft…", ar: "جارٍ فتح المسودة…" },
  "project.err.name": { tr: "Proje adı gerekli.", en: "Project name is required.", ar: "اسم المشروع مطلوب." },
  "project.err.parties": { tr: "İşveren ve yüklenici gerekli.", en: "Employer and contractor are required.", ar: "صاحب العمل والمقاول مطلوبان." },
  "project.err.save": { tr: "Proje kaydedilemedi.", en: "Could not save the project.", ar: "تعذر حفظ المشروع." },
  "authoring.nav": { tr: "Yaz", en: "Write", ar: "كتابة" },
  "document.forbidden": { tr: "Bu belgeye erişim yetkiniz yok.", en: "You do not have access to this document.", ar: "ليس لديك صلاحية الوصول إلى هذا المستند." },
  "document.missing": { tr: "Belge bulunamadı.", en: "Document not found.", ar: "لم يتم العثور على المستند." },
  "document.openfailed": { tr: "Belge açılamadı.", en: "Could not open document.", ar: "تعذر فتح المستند." },
  // ProjectCard health badges
  "card.openletters": { tr: "Açık Yazı", en: "Open Letters", ar: "مراسلات مفتوحة" },
  "card.overduerfis": { tr: "Gecikmiş RFI", en: "Overdue RFIs", ar: "طلبات متأخرة" },
  "card.due7d": { tr: "7 Günde", en: "Due in 7d", ar: "خلال ٧ أيام" },
  // ProjectDetail
  "overview.opencorr": { tr: "Açık Yazışmalar", en: "Open Correspondence", ar: "المراسلات المفتوحة" },
  "overview.overduerfis": { tr: "Gecikmiş RFI'lar", en: "Overdue RFIs", ar: "طلبات المعلومات المتأخرة" },
  "overview.daystocompletion": { tr: "Kalan Gün", en: "Days to Completion", ar: "الأيام المتبقية" },
  "overview.activitychart": { tr: "Genel Aktivite — ±15 Gün", en: "General Activity — ±15 Days", ar: "النشاط العام — ±١٥ يوماً" },
  "overview.upcoming": { tr: "Önümüzdeki 15 Gün — Aksiyon Bende", en: "Next 15 Days — Action Required", ar: "الأيام الـ١٥ القادمة — إجراء مطلوب" },
  "overview.overdue": { tr: "Kritik Uyarılar — Gecikmiş", en: "Critical Alerts — Overdue", ar: "تنبيهات حرجة — متأخرة" },
  "overview.noaction": { tr: "Önümüzdeki 15 günde aksiyon gerektiren belge yok.", en: "No action required in the next 15 days.", ar: "لا توجد مستندات تتطلب إجراءً خلال الأيام الـ١٥ القادمة." },
  "overview.nooverdue": { tr: "Bu projede gecikmiş belge yok.", en: "No overdue items in this project.", ar: "لا توجد عناصر متأخرة في هذا المشروع." },
  "overview.openworkspace": { tr: "Workspace'i Aç →", en: "Open Workspace →", ar: "فتح مساحة العمل ←" },
  "overview.today": { tr: "Bugün", en: "Today", ar: "اليوم" },
  "overview.tomorrow": { tr: "Yarın", en: "Tomorrow", ar: "غداً" },
  "overview.workspace": { tr: "Workspace →", en: "Workspace →", ar: "مساحة العمل ←" },
  "overview.tab.alerts": { tr: "Uyarılar ve Aksiyonlar", en: "Alerts & Actions", ar: "التنبيهات والإجراءات" },
  "overview.review": { tr: "İncele →", en: "Review →", ar: "مراجعة ←" },
  "overview.daysoverdue": { tr: "{n} gün gecikmiş", en: "{n} days overdue", ar: "متأخر {n} يوماً" },
  // Activity chart. Series legends reuse the module.* names so the chart speaks
  // the same vocabulary as the sidebar.
  "chart.prebucket": { tr: "≤ -15 gün", en: "≤ -15d", ar: "≤ -15 يوم" },
  "chart.pretooltip": { tr: "Grafik başlangıcından önce gecikmiş", en: "Overdue before chart start", ar: "متأخر قبل بداية الرسم البياني" },
  "chart.prelegend": { tr: "Grafik öncesi gecikmiş", en: "Overdue before chart", ar: "متأخر قبل الرسم البياني" },
  "overview.nocorrespondence": { tr: "Henüz yazışma yok.", en: "No correspondence yet.", ar: "لا توجد مراسلات بعد." },
  "overview.norfis": { tr: "Henüz RFI yok.", en: "No RFIs yet.", ar: "لا توجد طلبات معلومات بعد." },
  "overview.nochanges": { tr: "Henüz değişiklik yok.", en: "No changes yet.", ar: "لا توجد تغييرات بعد." },
  "overview.nodeliverables": { tr: "Henüz yükümlülük yok.", en: "No deliverables yet.", ar: "لا توجد التزامات بعد." },
  "overview.noalerts": { tr: "Bekleyen uyarı yok.", en: "No pending alerts.", ar: "لا توجد تنبيهات معلّقة." },

  // ── Alerts ────────────────────────────────────────────────
  "alerts.title": { tr: "Uyarılar", en: "Alerts", ar: "التنبيهات" },
  // Deliberately not interpolated: injecting a status word produced "No Pending
  // alerts." in English and broken agreement in Turkish and Arabic. The active
  // filter is already visible in the tab above this line.
  "alerts.none": { tr: "Bu görünümde uyarı yok.", en: "No alerts in this view.", ar: "لا توجد تنبيهات في هذا العرض." },
  "alerts.actionsdetails": { tr: "Aksiyonlar & Detaylar", en: "Actions & Details", ar: "الإجراءات والتفاصيل" },
  "alerts.nosourcedocument": { tr: "Kaynak belge yok.", en: "No source document.", ar: "لا يوجد مستند مصدر." },
  "alerts.openfulldocument": { tr: "Belgenin tamamını aç", en: "Open full document", ar: "فتح المستند كاملاً" },
  "alerts.attachedfiles": { tr: "{n} ekli dosya", en: "{n} attached file(s)", ar: "{n} ملف مرفق" },
  "alerts.from": { tr: "Kaynak", en: "From", ar: "من" },
  "alerts.flagged": { tr: "İşaretlenen", en: "Flagged", ar: "تم وضع علامة" },
  "alerts.tab.note": { tr: "not", en: "note", ar: "ملاحظة" },
  "alerts.tab.assignment": { tr: "atama", en: "assignment", ar: "إسناد" },
  "alerts.role.cm": { tr: "SY", en: "CM", ar: "مدير العقد" },
  "alerts.allclear": { tr: "Şimdilik her şey yolunda.", en: "All clear for now.", ar: "كل شيء على ما يرام حالياً." },
  "alerts.sourcedocument": { tr: "KAYNAK BELGE", en: "SOURCE DOCUMENT", ar: "المستند المصدر" },
  "alerts.actions": { tr: "AKSİYONLAR", en: "ACTIONS", ar: "الإجراءات" },
  "alerts.noactions": { tr: "Henüz aksiyon yok.", en: "No actions yet.", ar: "لا توجد إجراءات بعد." },
  "alerts.addaction": { tr: "Aksiyon Ekle", en: "Add Action", ar: "إضافة إجراء" },
  "alerts.saveaction": { tr: "Aksiyonu Kaydet", en: "Save Action", ar: "حفظ الإجراء" },
  "alerts.selectrole": { tr: "Rol seçin...", en: "Select role...", ar: "اختر الدور..." },
  "alerts.role.engineer": { tr: "Mühendis", en: "Engineer", ar: "المهندس" },
  "alerts.role.dcc": { tr: "DKM", en: "DCC", ar: "مراقبة الوثائق" },
  "alerts.role.any": { tr: "Herhangi", en: "Any", ar: "أي" },
  "alerts.role.user": { tr: "Kullanıcı", en: "User", ar: "مستخدم" },
  "alerts.type.potential_impact": { tr: "Potansiyel Etki", en: "Potential Impact", ar: "أثر محتمل" },
  "alerts.type.wp_message": { tr: "WP Mesajı", en: "WP Message", ar: "رسالة برنامج العمل" },
  "alerts.type.ew_deadline": { tr: "EW Süresi", en: "EW Deadline", ar: "موعد الإنذار المبكر" },
  "alerts.field.type": { tr: "Tür", en: "Type", ar: "النوع" },
  "alerts.field.reference": { tr: "Referans", en: "Reference", ar: "المرجع" },
  "alerts.field.subject": { tr: "Konu", en: "Subject", ar: "الموضوع" },
  "alerts.field.status": { tr: "Durum", en: "Status", ar: "الحالة" },
  "alerts.field.date": { tr: "Tarih", en: "Date", ar: "التاريخ" },
  // Singular record names. Used wherever one record's type is named in prose —
  // alerts, dashboard deadline rows. The module.* family is the plural
  // navigation vocabulary and is not interchangeable with these.
  "entity.rfi": { tr: "RFI", en: "RFI", ar: "طلب معلومات" },
  "entity.correspondence": { tr: "Yazışma", en: "Correspondence", ar: "مراسلة" },
  "entity.change": { tr: "Değişiklik", en: "Change", ar: "تغيير" },
  "entity.deliverable": { tr: "Yükümlülük", en: "Deliverable", ar: "التزام" },
  "entity.dispute": { tr: "İhtilaf", en: "Dispute", ar: "نزاع" },
  "entity.document": { tr: "Belge", en: "Document", ar: "مستند" },
  "entity.system": { tr: "Sistem", en: "System", ar: "النظام" },
  // Short badges on a list row. Kept to three or four characters so they read as
  // a marker beside the subject rather than a second title.
  "rfitype.response": { tr: "YNT", en: "RES", ar: "رد" },
  "rfitype.revision": { tr: "REV", en: "REV", ar: "مراجعة" },

  // ── Chronologies ──────────────────────────────────────────
  "chrono.title": { tr: "Kronoloji", en: "Chronologies", ar: "التسلسل الزمني" },
  "chrono.none": { tr: "Henüz kronoloji yok.", en: "No chronologies yet.", ar: "لا توجد تسلسلات زمنية بعد." },
  "chrono.noevents": { tr: "Henüz olay yok.", en: "No events yet.", ar: "لا توجد أحداث بعد." },
  "chrono.narrative": { tr: "Anlatı", en: "Narrative", ar: "السرد" },
  "chrono.approvednarrative": { tr: "Onaylı Anlatı", en: "Approved Narrative", ar: "السرد المعتمد" },
  "chrono.editnarrative": { tr: "Anlatıyı Düzenle", en: "Edit Narrative", ar: "تحرير السرد" },
  // "LLM" is engineering jargon; users read this as a system-authored draft.
  "chrono.systemdraft": { tr: "Sistem Taslağı — Onay Bekliyor", en: "System Draft — Pending Approval", ar: "مسودة النظام — بانتظار الاعتماد" },
  "chrono.nonarrative": { tr: "Bu olay için anlatı yok.", en: "No narrative for this event.", ar: "لا يوجد سرد لهذا الحدث." },
  "chrono.editchronology": { tr: "Kronolojiyi Düzenle", en: "Edit Chronology", ar: "تحرير التسلسل الزمني" },
  "chrono.savechronology": { tr: "Kronolojiyi Kaydet", en: "Save Chronology", ar: "حفظ التسلسل الزمني" },
  "chrono.savechanges": { tr: "Değişiklikleri Kaydet", en: "Save Changes", ar: "حفظ التغييرات" },
  "chrono.addtotimeline": { tr: "Zaman Çizelgesine Ekle", en: "Add to Timeline", ar: "إضافة إلى الجدول الزمني" },
  "chrono.generate": { tr: "Anlatı Üret", en: "Generate Narrative", ar: "توليد السرد" },
  "chrono.llmfailed": { tr: "Anlatı üretilemedi.", en: "Could not generate the narrative.", ar: "تعذّر توليد السرد." },
  "chrono.notedispute": { tr: "Dispute Ready’de oluşturuldu", en: "Created in Dispute Ready", ar: "أُنشئ في Dispute Ready" },
  "chrono.linkedsource": { tr: "Kaynak kronolojiden aktarıldı", en: "Carried over from the source chronology", ar: "نُقل من التسلسل الزمني المصدر" },
  "chrono.pendingevents": { tr: "Bekleyen Olaylar", en: "Pending Events", ar: "أحداث معلّقة" },
  "chrono.newchronology": { tr: "Yeni Kronoloji", en: "New Chronology", ar: "تسلسل زمني جديد" },
  "chrono.timeline": { tr: "ZAMAN ÇİZELGESİ", en: "TIMELINE", ar: "الجدول الزمني" },
  "chrono.adddocuments": { tr: "ZAMAN ÇİZELGESİNE BELGE EKLE", en: "ADD DOCUMENTS TO TIMELINE", ar: "إضافة مستندات إلى الجدول الزمني" },
  "chrono.selectchronology": { tr: "Listeden bir kronoloji seçin.", en: "Select a chronology from the list.", ar: "اختر تسلسلاً زمنياً من القائمة." },
  "chrono.entertitle": { tr: "Lütfen bir başlık girin.", en: "Please enter a title.", ar: "الرجاء إدخال عنوان." },
  "chrono.keyevent": { tr: "Kilit olay", en: "Key event", ar: "حدث رئيسي" },
  "chrono.key": { tr: "KİLİT", en: "KEY", ar: "رئيسي" },
  "chrono.manualentry": { tr: "MANUEL KAYIT", en: "MANUAL ENTRY", ar: "إدخال يدوي" },
  "chrono.addmanual": { tr: "+ Sistemde olmayan kayıt ekle", en: "+ Add entry not in system", ar: "+ إضافة سجل غير موجود في النظام" },
  "chrono.cancelmanual": { tr: "Manuel kaydı iptal et", en: "Cancel manual entry", ar: "إلغاء الإدخال اليدوي" },
  "chrono.writemanually": { tr: "Elle Yaz", en: "Write Manually", ar: "الكتابة يدوياً" },
  "chrono.added": { tr: "Eklendi", en: "Added", ar: "تمت الإضافة" },
  "chrono.existing": { tr: "mevcut", en: "existing", ar: "موجود" },
  "chrono.searchadddocs": { tr: "Yukarıdan belge arayıp ekleyin.", en: "Search and add documents above.", ar: "ابحث عن المستندات وأضفها من الأعلى." },
  "chrono.removeevent": { tr: "Bu olay kaldırılsın mı? Bu işlem kayda geçer.", en: "Remove this event? This action is logged.", ar: "إزالة هذا الحدث؟ يتم تسجيل هذا الإجراء." },
  "chrono.removeeventfromchronology": { tr: "Bu olay kronolojiden kaldırılsın mı? Bu işlem kayda geçer.", en: "Remove this event from the chronology? This action is logged.", ar: "إزالة هذا الحدث من التسلسل الزمني؟ يتم تسجيل هذا الإجراء." },
  "chrono.removefailed": { tr: "Olay kaldırılamadı.", en: "Failed to remove event.", ar: "تعذّرت إزالة الحدث." },
  "chrono.narrativeupdatefailed": { tr: "Anlatı güncellenemedi.", en: "Failed to update narrative.", ar: "تعذّر تحديث السرد." },
  // Plural pair — pick with `n === 1 ? _one : _other`.
  "chrono.eventcount_one": { tr: "1 olay", en: "1 event", ar: "حدث واحد" },
  "chrono.eventcount_other": { tr: "{n} olay", en: "{n} events", ar: "{n} أحداث" },
  // Placeholders
  "chrono.ph.title": { tr: "örn. Cephe İşleri Hak Talebi Kronolojisi", en: "e.g. Facade Works Claim Chronology", ar: "مثال: التسلسل الزمني لمطالبة أعمال الواجهات" },
  "chrono.ph.search": { tr: "RFI veya yazışma ara...", en: "Search RFI or Correspondence...", ar: "ابحث عن طلب معلومات أو مراسلة..." },
  "chrono.ph.eventsubject": { tr: "Olay konusu...", en: "Event subject...", ar: "موضوع الحدث..." },
  "chrono.ph.description": { tr: "Açıklama...", en: "Description...", ar: "الوصف..." },
  "chrono.ph.narrative": { tr: "Anlatı yazın...", en: "Write narrative...", ar: "اكتب السرد..." },
  "chrono.ph.optionalnarrative": { tr: "İsteğe bağlı anlatı...", en: "Optional narrative...", ar: "سرد اختياري..." },
  // Manual event types — mirrors MANUAL_EVENT_TYPE_LABELS in types/chronology.ts.
  "chrono.evt.rfi": { tr: "RFI", en: "RFI", ar: "طلب معلومات" },
  "chrono.evt.correspondence": { tr: "Yazışma", en: "Correspondence", ar: "مراسلة" },
  "chrono.evt.notice": { tr: "Bildirim", en: "Notice", ar: "إشعار" },
  "chrono.evt.submission": { tr: "Sunum", en: "Submission", ar: "تقديم" },
  "chrono.evt.response": { tr: "Yanıt", en: "Response", ar: "رد" },
  "chrono.evt.meeting": { tr: "Toplantı / Tutanak", en: "Meeting / MOM", ar: "اجتماع / محضر" },
  "chrono.evt.inspection": { tr: "Muayene (WIR/MIR)", en: "Inspection (WIR/MIR)", ar: "فحص (WIR/MIR)" },
  "chrono.evt.work_permit": { tr: "Çalışma İzni", en: "Work Permit", ar: "تصريح عمل" },
  "chrono.evt.other": { tr: "Diğer Belge", en: "Other Document", ar: "مستند آخر" },
  "chrono.evt.dispute_step": { tr: "İhtilaf aşaması", en: "Dispute step", ar: "مرحلة النزاع" },

  // ── Intelligence / relations ──────────────────────────────
  "relation.related": { tr: "İlgili Kayıtlar", en: "Related Records", ar: "سجلات ذات صلة" },
  "relation.chain": { tr: "Zincir", en: "Chain", ar: "سلسلة" },
  "relation.content": { tr: "İçerik Benzerliği", en: "Content Similarity", ar: "تشابه المحتوى" },
  "relation.none": { tr: "İlişkili kayıt bulunamadı.", en: "No related records found.", ar: "لم يتم العثور على سجلات ذات صلة." },
  "relation.matchstrong": { tr: "Güçlü eşleşme", en: "Strong match", ar: "تطابق قوي" },
  "relation.matchmoderate": { tr: "Orta eşleşme", en: "Moderate match", ar: "تطابق متوسط" },
  "relation.matchweak": { tr: "Zayıf eşleşme", en: "Weak match", ar: "تطابق ضعيف" },

  // ── Authoring ─────────────────────────────────────────────
  "authoring.saved": { tr: "kaydedildi", en: "saved", ar: "تم الحفظ" },
  "authoring.invalidrange": { tr: "aralık geçersiz", en: "invalid range", ar: "نطاق غير صالح" },
  // Replaces the raw "409" that used to surface here.
  "authoring.conflict": { tr: "başkası düzenledi — yenileyin", en: "edited elsewhere — reload", ar: "تم التحرير في مكان آخر — أعد التحميل" },

  // ── Editor chrome ─────────────────────────────────────────
  "editor.size": { tr: "Punto", en: "Size", ar: "الحجم" },
  "editor.space": { tr: "Aralık", en: "Spacing", ar: "التباعد" },
  "editor.space.default": { tr: "Varsayılan", en: "Default", ar: "افتراضي" },
  "editor.space.sm": { tr: "Sıkı", en: "Compact", ar: "مضغوط" },
  "editor.space.md": { tr: "Rahat", en: "Comfortable", ar: "مريح" },
  "editor.space.lg": { tr: "Geniş", en: "Loose", ar: "واسع" },
  "editor.bold": { tr: "Kalın (Ctrl+B)", en: "Bold (Ctrl+B)", ar: "عريض (Ctrl+B)" },
  "editor.italic": { tr: "İtalik (Ctrl+I)", en: "Italic (Ctrl+I)", ar: "مائل (Ctrl+I)" },
  "editor.underline": { tr: "Altı çizili (Ctrl+U)", en: "Underline (Ctrl+U)", ar: "تسطير (Ctrl+U)" },
  "editor.strike": { tr: "Üstü çizili", en: "Strikethrough", ar: "يتوسطه خط" },
  "editor.h2": { tr: "Başlık 2", en: "Heading 2", ar: "عنوان ٢" },
  "editor.h3": { tr: "Başlık 3", en: "Heading 3", ar: "عنوان ٣" },
  "editor.bullet": { tr: "Madde işaretleri", en: "Bullet list", ar: "قائمة نقطية" },
  "editor.ordered": { tr: "Numaralı liste", en: "Numbered list", ar: "قائمة مرقّمة" },
  "editor.alignleft": { tr: "Sola hizala", en: "Align left", ar: "محاذاة لليسار" },
  "editor.aligncenter": { tr: "Ortala", en: "Align center", ar: "توسيط" },
  "editor.alignright": { tr: "Sağa hizala", en: "Align right", ar: "محاذاة لليمين" },
  "editor.justify": { tr: "İki yana yasla", en: "Justify", ar: "ضبط" },
  "editor.indent": { tr: "Girinti", en: "Indent", ar: "مسافة بادئة" },
  "editor.outdent": { tr: "Girintiyi azalt", en: "Outdent", ar: "إنقاص المسافة البادئة" },
  "editor.table": { tr: "Tablo", en: "Table", ar: "جدول" },
  "editor.tableinsert": { tr: "3×3 tablo ekle", en: "Insert 3×3 table", ar: "إدراج جدول ٣×٣" },
  "editor.clear": { tr: "Temizle", en: "Clear", ar: "مسح" },
  "editor.clearfmt": { tr: "Biçimi temizle", en: "Clear formatting", ar: "مسح التنسيق" },
  "editor.undo": { tr: "Geri al (Ctrl+Z)", en: "Undo (Ctrl+Z)", ar: "تراجع (Ctrl+Z)" },
  "editor.redo": { tr: "Yinele (Ctrl+Y)", en: "Redo (Ctrl+Y)", ar: "إعادة (Ctrl+Y)" },
  "editor.words": { tr: "{n} sözcük", en: "{n} words", ar: "{n} كلمة" },
  "editor.pages": { tr: "≈ {n} s", en: "≈ {n} p", ar: "≈ {n} ص" },

  // ── Authoring intelligence rail ───────────────────────────
  "ai.intent.label": { tr: "Yanıtın kâğıda yazılıp yazılmayacağı", en: "Whether the reply is written onto the letter", ar: "ما إذا كانت الإجابة تُكتب على الورقة" },
  "ai.intent.comment": { tr: "Yorumla", en: "Comment", ar: "تعليق" },
  "ai.intent.revise": { tr: "Kâğıda yaz", en: "Write on paper", ar: "اكتب على الورق" },
  "ai.tip.comment": { tr: "Mektubu tarar; kâğıda yazmaz. Seçim varsa yalnız seçimi yorumlar.", en: "Reviews the letter; does not change it. A selection is reviewed on its own.", ar: "يراجع الخطاب ولا يغيّره. إن وُجد تحديد يُراجع وحده." },
  "ai.tip.revise": { tr: "Seçim varsa yalnız seçimi, yoksa tüm gövdeyi değiştirir.", en: "Updates the selection if any, otherwise the full body.", ar: "يحدّث التحديد إن وُجد، وإلا فكامل المتن." },
  "ai.ph.comment": { tr: "Örn. ton çok mu sert, 4.1 atıfı eksik mi?", en: "e.g. too sharp? missing a 4.1 citation?", ar: "مثال: هل النبرة حادة؟ هل ينقص الاستشهاد بـ 4.1؟" },
  "ai.ph.revise": { tr: "Örn. gecikme bildirimi, nazik ton, 2 paragraf…", en: "e.g. delay notice, polite tone, 2 paragraphs…", ar: "مثال: إشعار تأخير، نبرة مهذبة، فقرتان…" },
  "ai.send": { tr: "Gönder", en: "Send", ar: "إرسال" },
  "ai.applied": { tr: "Kâğıda yazıldı", en: "Written on paper", ar: "كُتب على الورق" },
  "ai.commented": { tr: "Yorum — kâğıt değişmedi", en: "Notes — letter unchanged", ar: "ملاحظات — الخطاب لم يتغيّر" },
  "ai.reviewrequired": { tr: "İnceleme gerekli", en: "Review required", ar: "مراجعة مطلوبة" },
  "ai.objectivity": { tr: "Nesnellik uyarısı", en: "Objectivity flag", ar: "تنبيه الموضوعية" },
  "ai.noinstruction": { tr: "(talimat yok)", en: "(no instructions)", ar: "(بدون تعليمات)" },

  // ── Dispute Ready dossier ────────────────────────────────
  "dispute.new": { tr: "Yeni ihtilaf dosyası", en: "New dispute dossier", ar: "ملف نزاع جديد" },
  "dispute.newhint": { tr: "Numara sunucuda DSP-NNN olarak üretilir. Etkiler ve konular dosya sayfasında eklenir.", en: "The number is issued server-side as DSP-NNN. Add impacts and issues on the dossier page.", ar: "يصدر الرقم من الخادم بصيغة DSP-NNN. تُضاف الآثار والمسائل في صفحة الملف." },
  "dispute.kunye": { tr: "Künye", en: "Identity", ar: "بيانات الهوية" },
  "dispute.impacts": { tr: "Etkiler", en: "Impacts", ar: "الآثار" },
  "dispute.board": { tr: "Uyuşmazlık konuları", en: "Disputed issues", ar: "مسائل النزاع" },
  "dispute.claims": { tr: "Hak talepleri", en: "Claims", ar: "المطالبات" },
  "dispute.responses": { tr: "İşveren yanıtları", en: "Employer responses", ar: "ردود صاحب العمل" },
  "dispute.preparepack": { tr: "Paketi hazırla", en: "Prepare pack", ar: "إعداد الحزمة" },
  "dispute.downloadpack": { tr: "Paketi indir", en: "Download pack", ar: "تنزيل الحزمة" },
  "dispute.packat": { tr: "Paket tarihi", en: "Pack generated", ar: "تاريخ الحزمة" },
  "dispute.opensource": { tr: "Kaynağı aç", en: "Open source", ar: "فتح المصدر" },
  "dispute.openchrono": { tr: "Kronoloji modülü", en: "Chronologies module", ar: "وحدة التسلسل الزمني" },
  "dispute.chrono.revise": { tr: "Revize et", en: "Revise", ar: "مراجعة" },
  "dispute.confirm.revisechrono": { tr: "Kaynak kronoloji korunur; ihtilaf için bir kopya açılır. Devam edilsin mi?", en: "The source chronology is kept. A copy will be opened for this dispute. Continue?", ar: "يُحفظ التسلسل الزمني المصدر. ستُفتح نسخة لهذا النزاع. المتابعة؟" },
  "dispute.llm.claim": { tr: "Hak talebi üret", en: "Generate claim", ar: "توليد المطالبة" },
  "dispute.llm.response": { tr: "İşveren yanıtı üret", en: "Generate employer response", ar: "توليد رد صاحب العمل" },
  "dispute.collapse": { tr: "Daralt", en: "Collapse", ar: "طي" },
  "dispute.ph.positionsummary": { tr: "Pozisyon özeti...", en: "Position summary...", ar: "ملخص الموقف..." },
  "dispute.addissue": { tr: "Konu ekle", en: "Add issue", ar: "إضافة مسألة" },
  "dispute.noimpacts": { tr: "Henüz etki yok.", en: "No impacts yet.", ar: "لا توجد آثار بعد." },
  "dispute.field.title": { tr: "Başlık", en: "Title", ar: "العنوان" },
  "dispute.field.summary": { tr: "Özet", en: "Summary", ar: "الملخص" },
  "dispute.field.venue": { tr: "Forum / yer", en: "Venue", ar: "المكان" },
  "dispute.origin.change": { tr: "Değişiklik", en: "Change", ar: "تغيير" },
  "dispute.origin.correspondence": { tr: "Yazışma", en: "Correspondence", ar: "مراسلة" },
  "dispute.origin.mixed": { tr: "Karma", en: "Mixed", ar: "مختلط" },
  "dispute.origin.manual": { tr: "Elle", en: "Manual", ar: "يدوي" },
  "dispute.impact.cost": { tr: "Maliyet", en: "Cost", ar: "تكلفة" },
  "dispute.impact.time": { tr: "Süre", en: "Time", ar: "وقت" },
  "dispute.impact.other": { tr: "Diğer", en: "Other", ar: "أخرى" },
  "dispute.attach.system": { tr: "Kayıt", en: "Record", ar: "سجل" },
  "dispute.attach.manual": { tr: "Elle", en: "Manual", ar: "يدوي" },
  "dispute.attach.file": { tr: "Dosya", en: "File", ar: "ملف" },
  "dispute.ph.impactlabel": { tr: "Etki etiketi", en: "Impact label", ar: "تسمية الأثر" },
  "dispute.ph.amount": { tr: "Tutar", en: "Amount", ar: "المبلغ" },
  "dispute.ph.unit": { tr: "Birim", en: "Unit", ar: "الوحدة" },
  "dispute.ph.issuetitle": { tr: "Uyuşmazlık konusu", en: "Disputed issue", ar: "مسألة النزاع" },
  "dispute.ph.positiontitle": { tr: "Pozisyon başlığı", en: "Position title", ar: "عنوان الموقف" },
  "dispute.ph.manualtitle": { tr: "Belge başlığı", en: "Document title", ar: "عنوان المستند" },
  "dispute.err.title": { tr: "Başlık zorunlu.", en: "Title is required.", ar: "العنوان مطلوب." },
  "dispute.err.save": { tr: "Kayıt başarısız.", en: "Save failed.", ar: "تعذّر الحفظ." },
  "dispute.err.load": { tr: "Dosya yüklenemedi.", en: "Failed to load dossier.", ar: "تعذّر تحميل الملف." },
  "dispute.confirm.removeimpact": { tr: "Bu etki kaldırılsın mı?", en: "Remove this impact?", ar: "إزالة هذا الأثر؟" },
  "dispute.confirm.removeissue": { tr: "Bu konu ve bağlı pozisyonlar kaldırılsın mı?", en: "Remove this issue and its positions?", ar: "إزالة هذه المسألة ومواقفها؟" },
  "dispute.confirm.removeposition": { tr: "Bu pozisyon kaldırılsın mı?", en: "Remove this position?", ar: "إزالة هذا الموقف؟" },
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  dir: "ltr",
  setLang: () => {},
  toggle: () => {},
  t: (key) => key,
});

function readStoredLang(): Lang {
  const stored = localStorage.getItem("clauseiq_lang");
  return LANGS.includes(stored as Lang) ? (stored as Lang) : "en";
}

/** Keep <html lang/dir> in lockstep with React state — useEffect is too late
 *  (one paint of the previous dir) and a leftover dir=rtl from an AR session
 *  reverses the language toggle so TR looks selected while copy stays Arabic. */
function applyDocumentLang(next: Lang) {
  const nextDir = next === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = next;
  document.documentElement.dir = nextDir;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  const dir = lang === "ar" ? "rtl" : "ltr";

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem("clauseiq_lang", next);
    applyDocumentLang(next);
    setLangState(next);
  }, []);

  const toggle = useCallback(() => {
    setLangState((current) => {
      const i = LANGS.indexOf(current);
      const next = LANGS[(i + 1) % LANGS.length];
      localStorage.setItem("clauseiq_lang", next);
      applyDocumentLang(next);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  const t = useCallback((key: string): string => {
    const entry = TRANSLATIONS[key];
    if (!entry) return key;
    return entry[lang] ?? entry.en;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, dir, setLang, toggle, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
