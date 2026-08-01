import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "tr" | "en";

interface LanguageContextValue {
  lang: Lang;
  toggle: () => void;
  t: (key: string) => string;
}

const TRANSLATIONS: Record<string, Record<Lang, string>> = {
  // Nav
  "nav.projects": { tr: "Projeler", en: "Projects" },
  "nav.overview": { tr: "Genel Bakış", en: "Overview" },
  "nav.workspace": { tr: "Çalışma Alanı", en: "Workspace" },
  "nav.signout": { tr: "Çıkış", en: "Sign out" },
  // Sidebar
  "module.general": { tr: "Genel", en: "General" },
  "module.correspondence": { tr: "Yazışmalar", en: "Correspondence" },
  "module.rfis": { tr: "RFI'lar", en: "RFIs" },
  "module.changes": { tr: "Değişiklikler", en: "Changes" },
  "module.deliverables": { tr: "Teslimler", en: "Deliverables" },
  "module.chronologies": { tr: "Kronoloji", en: "Chronologies" },
  "module.documents": { tr: "Belgeler", en: "Documents" },
  "module.config": { tr: "Ayarlar", en: "Config" },
  "module.system": { tr: "Sistem", en: "System" },
  // General
  "general.title": { tr: "Genel Arama", en: "General Search" },
  "general.placeholder": { tr: "Kelime veya ifade yazın...", en: "Search by keyword..." },
  "general.searching": { tr: "Aranıyor...", en: "Searching..." },
  "general.noresults": { tr: "Sonuç bulunamadı.", en: "No results found." },
  // Filters
  "filter.all": { tr: "Tümü", en: "All" },
  "filter.allstatus": { tr: "Tüm Durumlar", en: "All Status" },
  "filter.alldirections": { tr: "Tüm Yönler", en: "All Directions" },
  "filter.alldisciplines": { tr: "Tüm Disiplinler", en: "All Disciplines" },
  "filter.allorigins": { tr: "Tüm Kaynak", en: "All Origins" },
  "filter.incoming": { tr: "← Gelen", en: "← Incoming" },
  "filter.outgoing": { tr: "Giden →", en: "Outgoing →" },
  "filter.issuedate": { tr: "İşlenen Tarih", en: "Issue Date" },
  "filter.duedate": { tr: "Son Tarih", en: "Due Date" },
  "filter.submitteddate": { tr: "Gönderim Tarihi", en: "Submitted Date" },
  "filter.createddate": { tr: "Oluşturma Tarihi", en: "Created Date" },
  "filter.date": { tr: "Tarih", en: "Date" },
  "filter.search": { tr: "Ara...", en: "Search..." },
  // Status
  "status.open": { tr: "Açık", en: "Open" },
  "status.draft": { tr: "Taslak", en: "Draft" },
  "status.under_review": { tr: "İncelemede", en: "Under Review" },
  "status.approved": { tr: "Onaylandı", en: "Approved" },
  "status.published": { tr: "Yayınlandı", en: "Published" },
  "status.closed": { tr: "Kapalı", en: "Closed" },
  "status.overdue": { tr: "Gecikmiş", en: "Overdue" },
  "status.pending": { tr: "Bekliyor", en: "Pending" },
  "status.in_progress": { tr: "Devam Ediyor", en: "In Progress" },
  "status.responded": { tr: "Yanıtlandı", en: "Responded" },
  "status.rejected": { tr: "Reddedildi", en: "Rejected" },
  // Table headers
  "col.no": { tr: "No.", en: "No." },
  "col.subject": { tr: "Konu", en: "Subject" },
  "col.direction": { tr: "Yön", en: "Direction" },
  "col.date": { tr: "Tarih", en: "Date" },
  "col.deadline": { tr: "Son Tarih", en: "Deadline" },
  "col.status": { tr: "Durum", en: "Status" },
  "col.discipline": { tr: "Disiplin", en: "Discipline" },
  "col.submitted": { tr: "Gönderildi", en: "Submitted" },
  "col.due": { tr: "Son Tarih", en: "Due" },
  "col.title": { tr: "Başlık", en: "Title" },
  "col.origin": { tr: "Kaynak", en: "Origin" },
  "col.category": { tr: "Kategori", en: "Category" },
  "col.duedate": { tr: "Son Tarih", en: "Due Date" },
  // Actions
  "action.newcorrespondence": { tr: "+ Yeni Yazışma", en: "+ New Correspondence" },
  "action.newrfi": { tr: "+ Yeni RFI", en: "+ New RFI" },
  "action.newchange": { tr: "+ Yeni Değişiklik", en: "+ New Change" },
  "action.newdeliverable": { tr: "+ Yeni Teslimat", en: "+ New Deliverable" },
  "action.register": { tr: "Kayıt Et", en: "Register" },
  "action.create": { tr: "Oluştur", en: "Create" },
  "action.addresponse": { tr: "↩ Yanıt Ekle", en: "↩ Add Response" },
  "action.addrevision": { tr: "↺ Revize Ekle", en: "↺ Add Revision" },
  "action.writeresponse": { tr: "↩ Yanıt Yaz", en: "↩ Write Response" },
  "action.addfollowup": { tr: "+ Followup Ekle", en: "+ Add Followup" },
  // States
  "state.loading": { tr: "Yükleniyor...", en: "Loading..." },
  "state.comingsoon": { tr: "Yakında burada olacak.", en: "Coming soon." },
  "state.nocorrespondence": { tr: "Yazışma bulunamadı.", en: "No correspondence found." },
  "state.norfis": { tr: "RFI bulunamadı.", en: "No RFIs found." },
  "state.nochanges": { tr: "Değişiklik bulunamadı.", en: "No changes found." },
  "state.nodeliverables": { tr: "Teslimat bulunamadı.", en: "No deliverables found." },
  "state.precompletion": { tr: "Tamamlama Öncesi", en: "Pre-completion" },
  // Login
  "login.title": { tr: "Oturum Aç", en: "Sign In" },
  "login.subtitle": { tr: "Devam etmek için giriş yapın.", en: "Sign in to continue." },
  "login.email": { tr: "E-POSTA", en: "EMAIL" },
  "login.password": { tr: "ŞİFRE", en: "PASSWORD" },
  "login.remember": { tr: "E-posta adresimi hatırla", en: "Remember my email" },
  "login.button": { tr: "Giriş Yap", en: "Sign In" },
  "login.loading": { tr: "Giriş yapılıyor...", en: "Signing in..." },
  "brand.tagline": {
    tr: "Sözleşme & Operasyonel Zeka",
    en: "Contract & Operational Intelligence",
  },
  "brand.motto": {
    tr: "Hassasiyet. Uyum. Kontrol.",
    en: "Precision. Compliance. Control.",
  },
  "brand.motto_body": {
    tr: "Her bildirim, her süre, her yazışma — sözleşmesel hassasiyetle yönetilir.",
    en: "Every notice, every deadline, every correspondence — managed with contractual precision.",
  },
  "brand.footer": { tr: "ClauseIQ · 2026", en: "ClauseIQ · 2026" },
  "inforce.loading": { tr: "Yükleniyor...", en: "Loading..." },
  "inforce.error": {
    tr: "Yürürlük bilgisi yüklenemedi.",
    en: "Could not load in-force resolution.",
  },
  // Dashboard
  "dashboard.title": { tr: "Projeler", en: "Projects" },
  "dashboard.subtitle": { tr: "Devam etmek için bir proje seçin.", en: "Select a project to continue." },
  "dashboard.newproject": { tr: "+ Yeni Proje", en: "+ New Project" },
  // ProjectDetail
  "overview.opencorr": { tr: "Açık Yazışmalar", en: "Open Correspondence" },
  "overview.overduerfis": { tr: "Gecikmiş RFI'lar", en: "Overdue RFIs" },
  "overview.daystocompletion": { tr: "Kalan Gün", en: "Days to Completion" },
  "overview.activitychart": { tr: "Genel Aktivite — ±15 Gün", en: "General Activity — ±15 Days" },
  "overview.upcoming": { tr: "Önümüzdeki 15 Gün — Aksiyon Bende", en: "Next 15 Days — Action Required" },
  "overview.overdue": { tr: "Kritik Uyarılar — Gecikmiş", en: "Critical Alerts — Overdue" },
  "overview.noaction": { tr: "Önümüzdeki 15 günde aksiyon gerektiren belge yok.", en: "No action required in the next 15 days." },
  "overview.nooverdue": { tr: "Bu projede gecikmiş belge yok.", en: "No overdue items in this project." },
  "overview.openworkspace": { tr: "Workspace'i Aç →", en: "Open Workspace →" },
  "overview.today": { tr: "Bugün", en: "Today" },
  "overview.tomorrow": { tr: "Yarın", en: "Tomorrow" },
  "overview.workspace": { tr: "Workspace →", en: "Workspace →" },
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  toggle: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem("clauseiq_lang") as Lang) ?? "en"
  );

  const toggle = () => setLang((l) => {
    const next = l === "en" ? "tr" : "en";
    localStorage.setItem("clauseiq_lang", next);
    return next;
  });

  const t = (key: string): string => {
    const entry = TRANSLATIONS[key];
    if (!entry) return key;
    return entry[lang];
  };

  return (
    <LanguageContext.Provider value={{ lang, toggle, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
