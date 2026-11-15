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
 *   التاريخ:          سنة/شهر/يوم               2026/10/31
 *   التاريخ والوقت:   سنة/شهر/يوم - ساعة:دقيقة:ثانية (نظام 24 ساعة)   2026/10/31 - 18:24:05
 */
export const DATE_FORMAT_HINT = 'سنة/شهر/يوم';

/** 'YYYY/MM/DD' ← 'YYYY-MM-DD' */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${y}/${m}/${d}`;
}

/** أجزاء الوقت المحلي (حسب المنطقة الزمنية للنظام) من timestamp */
export function localParts(ts) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts)).reduce((o, x) => ((o[x.type] = x.value), o), {});
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, mi: p.minute, s: p.second };
}

/** 'YYYY/MM/DD - HH:MM:SS' ← timestamp */
export function fmtDateTime(ts) {
  if (!ts) return '';
  const p = localParts(ts);
  return `${p.y}/${p.mo}/${p.d} - ${p.h}:${p.mi}:${p.s}`;
}

/** ISO (UTC) ← تاريخ 'YYYY-MM-DD' وساعة 'HH:MM' أو 'HH:MM:SS' بتوقيت النظام (CONFIG.timeZone) */
export function zonedToIso(date, time = '00:00') {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, sec = 0] = time.split(':').map(Number);
  if (![y, mo, d, h, mi, sec].every(Number.isFinite)) return '';
  const want = Date.UTC(y, mo - 1, d, h, mi, sec);
  let t = want;
  for (let i = 0; i < 2; i++) {               // مرتان تكفيان حتى مع التوقيت الصيفي
    const p = localParts(t);
    t += want - Date.UTC(+p.y, +p.mo - 1, +p.d, +p.h, +p.mi, +p.s);
  }
  return new Date(t).toISOString();
}

/** 'YYYY/MM/DD - HH:MM' بلا ثوانٍ */
export const fmtDateTimeShort = (ts) => (ts ? fmtDateTime(ts).slice(0, -3) : '');

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

/** يقرأ تاريخاً من صيغ مختلفة (Excel رقمي، YYYY/MM/DD، YYYY-MM-DD، YYYYMMDD، DD/MM/YYYY) ويعيد 'YYYY-MM-DD' أو null */
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 1 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-9) * 864e5); // الجزء العشري = الوقت
    return d.toISOString().slice(0, 10);
  }
  const s = latinDigits(v).trim();
  if (/^\d{8}$/.test(s) && /^(19|20)/.test(s)) return parseDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`);
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

/**
 * يقرأ تاريخاً ووقتاً (مثل «تاريخ الإدخال» من Google Sheets) بتوقيت النظام، ويعيد ISO (UTC) أو null.
 * رقم Excel (الجزء العشري = الوقت، بدقة الثانية)، أو نص مثل '2026-09-01 10:00:05' أو '2026/09/01 10:00'.
 * بلا وقت ← منتصف الليل.
 */
export function parseDateTime(v) {
  if (v == null || v === '') return null;
  const pad = (n) => String(n).padStart(2, '0');
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(latinDigits(v).trim())) {
    const n = Number(latinDigits(v));
    if (!Number.isFinite(n) || n < 1 || n > 80000) return null;
    const total = Math.round(n * 86400);                 // ثوانٍ منذ 1899/12/30
    const day = Math.floor(total / 86400), sec = total % 86400;
    const date = new Date(Date.UTC(1899, 11, 30) + day * 864e5).toISOString().slice(0, 10);
    return zonedToIso(date, `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`) || null;
  }
  const s = latinDigits(v).trim();
  const date = parseDate(s.split(/[ T]/)[0]);
  if (!date) return null;
  const m = s.slice(s.split(/[ T]/)[0].length).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?/i);
  if (!m) return zonedToIso(date, '00:00') || null;
  let h = Number(m[1]);
  const ap = (m[4] || '').toLowerCase();
  if ((ap === 'pm' || ap === 'م') && h < 12) h += 12;
  if ((ap === 'am' || ap === 'ص') && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59 || Number(m[3] || 0) > 59) return null;
  return zonedToIso(date, `${pad(h)}:${m[2]}:${m[3] || '00'}`) || null;
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
