/**
 * House formatting for dates and money.
 *
 * Dates and amounts are the substance of a claim, so they must never depend on
 * the reader's browser locale. Two deliberate date shapes, one rule each:
 *   - formatDateCompact — ISO, for dense grid columns that are scanned/compared
 *   - formatDate        — "25 Aug 2026", for prose, künye rows and detail fields
 *
 * Calendar and numbering system are pinned explicitly: ar-SA would otherwise
 * resolve to the Islamic calendar and Arabic-Indic digits, which is wrong for
 * contract dates and amounts in GCC commercial practice.
 */
import type { Lang } from "../context/LanguageContext";

const LOCALES: Record<Lang, string> = {
  en: "en-GB",
  tr: "tr-TR",
  ar: "ar-SA",
};

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  calendar: "gregory",
  numberingSystem: "latn",
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO `2026-08-25` — sortable, unambiguous, for table columns. */
export function formatDateCompact(value: string | Date | null | undefined): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = toDate(value);
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

/** `25 Aug 2026` — for prose and detail fields. */
export function formatDate(value: string | Date | null | undefined, lang: Lang): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALES[lang], DATE_OPTS).format(d);
}

/** `25 Aug 2026 14:20` — for audit/künye rows where the time of record matters. */
export function formatDateTime(value: string | Date | null | undefined, lang: Lang): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALES[lang], {
    ...DATE_OPTS,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Grouped amount with an explicit currency code: `SAR 1,250,000`. */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  lang: Lang
): string {
  if (amount == null) return "—";
  const value = new Intl.NumberFormat(LOCALES[lang], {
    style: "decimal",
    numberingSystem: "latn",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency ? `${currency} ${value}` : value;
}

/** Whole days from today to `value`; negative when the date has passed. */
export function daysUntil(value: string | Date | null | undefined): number | null {
  const d = toDate(value);
  if (!d) return null;
  const midnight = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((midnight(d) - midnight(new Date())) / 86400000);
}
