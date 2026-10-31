/** حسابات لوحة المؤشرات والتقارير (على قائمة مهام جاهزة) */
import { daysBetween, MONTHS } from '../core/format.js';

/**
 * مؤشرات عامة.
 * متأخرة = مفتوحة ومضى على استلامها أكثر من delayDays يوماً.
 * المنجزة بعد المهلة = مكتملة ومدتها أكبر من delayDays.
 */
export function summarize(tasks, { delayDays = 7, today }) {
  const s = { total: tasks.length, done: 0, open: 0, cancelled: 0, delayed: 0, lateDone: 0, durSum: 0, durN: 0 };
  for (const t of tasks) {
    if (t.statusKind === 'done') {
      s.done++;
      if (t.durationDays != null) { s.durSum += t.durationDays; s.durN++; if (t.durationDays > delayDays) s.lateDone++; }
    } else if (t.statusKind === 'cancelled') s.cancelled++;
    else {
      s.open++;
      if (today && daysBetween(t.receivedDate, today) > delayDays) s.delayed++;
    }
  }
  const base = s.total - s.cancelled;
  s.rate = base ? s.done / base : null;
  s.avgDuration = s.durN ? s.durSum / s.durN : null;
  return s;
}

export const isDelayed = (t, delayDays, today) => t.statusKind === 'open' && daysBetween(t.receivedDate, today) > delayDays;

/** تجميع حسب مفتاح: [{ key, label, total, done, open, cancelled, rate, avgDuration }] مرتبة تنازلياً */
export function groupCount(tasks, keyFn, labelFn) {
  const m = new Map();
  for (const t of tasks) {
    const k = keyFn(t) ?? '';
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, label: labelFn(t) || 'غير محدد', total: 0, done: 0, open: 0, cancelled: 0, durSum: 0, durN: 0 }));
    g.total++;
    if (t.statusKind === 'done') { g.done++; if (t.durationDays != null) { g.durSum += t.durationDays; g.durN++; } } else if (t.statusKind === 'cancelled') g.cancelled++;
    else g.open++;
  }
  return [...m.values()].map((g) => ({
    ...g, rate: g.total - g.cancelled ? g.done / (g.total - g.cancelled) : null, avgDuration: g.durN ? g.durSum / g.durN : null,
  })).sort((a, b) => b.total - a.total);
}

/** توزيع شهري بين تاريخين (أو من البيانات نفسها)، آخر 24 شهراً بحد أقصى */
export function monthly(tasks, from, to) {
  if (!tasks.length && !(from && to)) return [];
  const dates = tasks.map((t) => t.receivedDate).sort();
  const a = (from || dates[0]).slice(0, 7), b = (to || dates[dates.length - 1]).slice(0, 7);
  let [y, m] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  let months = [];
  while ((y < y2 || (y === y2 && m <= m2)) && months.length < 600) {
    months.push({ key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTHS[m - 1]}${a.slice(0, 4) !== b.slice(0, 4) ? ' ' + String(y).slice(2) : ''}`, total: 0, done: 0, open: 0, cancelled: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  months = months.slice(-24); // آخر 24 شهراً فقط
  const idx = new Map(months.map((x, i) => [x.key, i]));
  for (const t of tasks) {
    const i = idx.get(t.receivedDate.slice(0, 7));
    if (i == null) continue;
    const g = months[i];
    g.total++;
    g[t.statusKind === 'done' ? 'done' : t.statusKind === 'cancelled' ? 'cancelled' : 'open']++;
  }
  return months;
}
