/**
 * التواريخ والأرقام. التواريخ في النظام نصوص 'YYYY-MM-DD' (بدون وقت) لتجنب مشاكل المنطقة الزمنية.
 */
import { CONFIG } from '../config.js';

const NUM = new Intl.NumberFormat('en-US');
export const num = (n) => (n == null || Number.isNaN(n) ? '—' : NUM.format(n));
export const pct = (n) => (n == null || !Number.isFinite(n) ? '—' : `${Math.round(n * 100)}%`);
export const dec1 = (n) => (n == null || !Number.isFinite(n) ? '—' : (Math.round(n * 10) / 10).toString());

/** تاريخ اليوم في المنطقة الزمنية للنظام */
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}

/* ───────────── صيغ العرض الموحّدة في كل النظام ─────────────
 *   التاريخ:          يوم/شهر/سنة               31/10/2026
 *   التاريخ والوقت:   يوم/شهر/سنة - ساعة:دقيقة:ثانية (نظام 24 ساعة)   31/10/2026 - 18:24:05
 */
export const DATE_FORMAT_HINT = 'يوم/شهر/سنة';

/** 'DD/MM/YYYY' ← 'YYYY-MM-DD' */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** أجزاء الوقت المحلي (حسب المنطقة الزمنية للنظام) من timestamp */
export function localParts(ts) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts)).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, mi: p.minute, s: p.second };
}

/** 'DD/MM/YYYY - HH:MM:SS' ← timestamp */
export function fmtDateTime(ts) {
  if (!ts) return '';
  const p = localParts(ts);
  return `${p.d}/${p.mo}/${p.y} - ${p.h}:${p.mi}:${p.s}`;
}

/** 'YYYY-MM-DD HH:MM:SS' بالوقت المحلي (للتصدير إلى Excel) ← timestamp */
export function localIsoDateTime(ts) {
  if (!ts) return '';
  const p = localParts(ts);
  return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}`;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** فترات جاهزة للفلاتر */
export function periodRange(key, from = '', to = '') {
  const t = today();
  const [y, m] = t.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const monthStart = (yy, mm) => `${yy}-${pad(mm)}-01`;
  const monthEnd = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  switch (key) {
    case 'today': return { from: t, to: t };
    case 'week': return { from: addDays(t, -6), to: t };
    case 'month': return { from: monthStart(y, m), to: monthEnd(y, m) };
    case 'last-month': { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return { from: monthStart(yy, mm), to: monthEnd(yy, mm) }; }
    case 'quarter': { const q = Math.floor((m - 1) / 3); return { from: monthStart(y, q * 3 + 1), to: monthEnd(y, q * 3 + 3) }; }
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'last-year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'custom': return { from, to };
    default: return { from: '', to: '' };
  }
}

export const PERIODS = [
  ['today', 'اليوم'], ['week', 'آخر 7 أيام'], ['month', 'هذا الشهر'], ['last-month', 'الشهر الماضي'],
  ['quarter', 'هذا الربع'], ['year', 'هذه السنة'], ['last-year', 'السنة الماضية'], ['all', 'كل الفترات'], ['custom', 'فترة محددة'],
];

/** تحويل الأرقام العربية الهندية إلى لاتينية */
export const latinDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

/** يقرأ تاريخاً من صيغ مختلفة (Excel رقمي، DD/MM/YYYY، YYYY-MM-DD) ويعيد 'YYYY-MM-DD' أو null */
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 1 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-9) * 864e5); // الجزء العشري = الوقت
    return d.toISOString().slice(0, 10);
  }
  const s = latinDigits(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
  } else return null;
  y = Number(y); mo = Number(mo); d = Number(d);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** مقارنة نصوص عربية بعد التوحيد (أ إ آ ← ا، ة ← ه، ى ← ي) */
export function normalizeAr(s) {
  return latinDigits(s).toLowerCase()
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // رموز خفية تأتي مع النسخ واللصق
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىیي]/g, 'ي').replace(/ک/g, 'ك') // ی و ک من لوحة المفاتيح الفارسية
    .replace(/\s+/g, ' ').trim();
}

/** «3 أيام» / «يوم واحد» / «15 يوماً» */
export function daysAr(n) {
  if (n == null) return '—';
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}
