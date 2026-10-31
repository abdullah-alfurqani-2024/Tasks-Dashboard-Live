/**
 * رسوم SVG بسيطة بدون مكتبات. كل دالة تعيد نص HTML (raw) جاهزاً للإدراج.
 * الاتجاه من اليمين لليسار: التسميات يميناً والأعمدة تمتد لليسار، والأشهر تبدأ من اليمين.
 * الألوان متغيرات CSS فتتبدّل تلقائياً مع الوضع الليلي.
 */
import { escape, raw } from '../core/dom.js';

const NUMF = new Intl.NumberFormat('en-US');
const n = (v) => NUMF.format(v);
const fill = (c) => `style="fill:${c}"`;

function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

const clip = (s, max) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

export function legend(series) {
  return raw(`<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${escape(s.name)}</span>`).join('')}</div>`);
}

/**
 * أشرطة أفقية متراكمة
 * rows: [{ label, parts: number[] }], series: [{ name, color }]
 */
export function hbars({ rows, series, labelWidth = 170, showLegend = true }) {
  if (!rows.length) return raw('<div class="empty small">لا توجد بيانات.</div>');
  const W = 640, rowH = 30, barH = 18, pad = 6, totalW = 46;
  const H = rows.length * rowH + pad * 2;
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, b) => a + b, 0)));
  const scale = (W - labelWidth - totalW - 10) / max;
  const right = W - labelWidth;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" style="direction:ltr">`;
  rows.forEach((r, i) => {
    const y = pad + i * rowH;
    const total = r.parts.reduce((a, b) => a + b, 0);
    svg += `<text class="lbl" x="${W - 4}" y="${y + rowH / 2 + 4}" text-anchor="end"><title>${escape(r.label)}</title>${escape(clip(r.label, 26))}</text>`;
    let x = right - 6;
    r.parts.forEach((v, k) => {
      if (!v) return;
      const w = Math.max(1.5, v * scale);
      x -= w;
      svg += `<rect x="${x.toFixed(1)}" y="${y + (rowH - barH) / 2}" width="${w.toFixed(1)}" height="${barH}" rx="3" ${fill(series[k].color)}><title>${escape(r.label)} — ${escape(series[k].name)}: ${n(v)}</title></rect>`;
    });
    svg += `<text x="${x - 6}" y="${y + rowH / 2 + 4}" text-anchor="end" class="lbl" style="font-weight:600">${n(total)}</text>`;
  });
  svg += '</svg>';
  return raw(`<div class="chart">${svg}</div>${showLegend && series.length > 1 ? legend(series) : ''}`);
}

/**
 * أعمدة رأسية متراكمة (للأشهر)
 * labels: string[], series: [{ name, color, values: number[] }]
 */
export function columns({ labels, series, height = 240 }) {
  if (!labels.length) return raw('<div class="empty small">لا توجد بيانات.</div>');
  const W = 640, top = 18, bottom = 30, left = 10, axisW = 36;
  const H = height;
  const plotW = W - left - axisW, plotH = H - top - bottom;
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const slot = plotW / labels.length;
  const bw = Math.min(42, slot * 0.62);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" style="direction:ltr">`;
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, y = top + plotH - (v / max) * plotH;
    svg += `<line class="grid-line" x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}"/>`;
    svg += `<text x="${W - 2}" y="${y + 4}" text-anchor="end">${n(Math.round(v))}</text>`;
  }
  const step = Math.ceil(labels.length / 12);
  labels.forEach((lab, i) => {
    // الشهر الأول في أقصى اليمين
    const cx = left + plotW - slot * (i + 0.5);
    let y = top + plotH;
    series.forEach((s) => {
      const v = s.values[i] || 0;
      if (!v) return;
      const h = (v / max) * plotH;
      y -= h;
      svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" ${fill(s.color)}><title>${escape(lab)} — ${escape(s.name)}: ${n(v)}</title></rect>`;
    });
    if (totals[i]) svg += `<text x="${cx}" y="${y - 5}" text-anchor="middle" class="lbl" style="font-size:11px">${n(totals[i])}</text>`;
    if (i % step === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${escape(lab)}</text>`;
  });
  svg += `<line class="axis" x1="${left}" x2="${left + plotW}" y1="${top + plotH}" y2="${top + plotH}"/></svg>`;
  return raw(`<div class="chart">${svg}</div>${series.length > 1 ? legend(series) : ''}`);
}

/** حلقة نسب. items: [{ label, value, color }] */
export function donut({ items, center = '', sub = '' }) {
  const total = items.reduce((s, x) => s + x.value, 0);
  if (!total) return raw('<div class="empty small">لا توجد بيانات.</div>');
  const R = 70, r = 46, C = 90;
  let a = -Math.PI / 2;
  let svg = `<svg viewBox="0 0 180 180" role="img" style="max-width:220px;margin:auto;direction:ltr">`;
  for (const it of items) {
    if (!it.value) continue;
    const frac = it.value / total;
    const tip = `<title>${escape(it.label)}: ${n(it.value)} (${Math.round(frac * 100)}%)</title>`;
    if (frac >= 0.9999) {
      svg += `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" style="fill:none;stroke:${it.color}" stroke-width="${R - r}">${tip}</circle>`;
      break;
    }
    const b = a - frac * Math.PI * 2; // عكس عقارب الساعة ليبدأ من اليمين
    const p = (ang, rad) => `${(C + rad * Math.cos(ang)).toFixed(2)} ${(C + rad * Math.sin(ang)).toFixed(2)}`;
    const large = frac > 0.5 ? 1 : 0;
    svg += `<path d="M ${p(a, R)} A ${R} ${R} 0 ${large} 0 ${p(b, R)} L ${p(b, r)} A ${r} ${r} 0 ${large} 1 ${p(a, r)} Z" ${fill(it.color)}>${tip}</path>`;
    a = b;
  }
  svg += `<text x="${C}" y="${C + 2}" text-anchor="middle" class="lbl" style="font-size:24px;font-weight:700">${escape(center)}</text>`;
  if (sub) svg += `<text x="${C}" y="${C + 22}" text-anchor="middle" style="font-size:11px">${escape(sub)}</text>`;
  svg += '</svg>';
  const leg = `<div class="legend" style="justify-content:center">${items.map((s) => `<span><i style="background:${s.color}"></i>${escape(s.label)}: <b>${n(s.value)}</b></span>`).join('')}</div>`;
  return raw(`<div class="chart">${svg}</div>${leg}`);
}
