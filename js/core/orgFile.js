/**
 * قراءة ملف الهيكل بشكل «عمود لكل مستوى» (كل صف مسار من الأعلى إلى الأسفل).
 * يستخدمه استيراد الهيكل (صفحة الهيكل) وإسناد الموظفين من ملف الهيكل (صفحة الموظفين)، فتُقرأ الصفوف بالقواعد نفسها:
 *   - الخلية الفارغة أو «0» أو الأرقام فقط = فارغة؛ مسمى المسؤول («الوزير») ليس وحدة
 *   - «مكتب مدير …» و«مدير مكتب …» في المستويات الدنيا ليست وحدات (خيار office)
 *   - القيمة باسم مستوى («مكتب الوزير») تأخذ ذلك المستوى
 *   - المستوى الأعلى الناقص يُكمَل إن كانت الوحدة لا تظهر في الملف إلا تحت مسار واحد
 */
import { normalizeAr, searchKey } from './format.js';
import { readXlsx } from '../lib/xlsx.js';
import { parseCsv } from '../lib/csv.js';

/** عناوين إنجليزية شائعة ← اسم المستوى */
const EN = [[/directorate|general\s*directorate/i, 'مديرية'], [/department/i, 'دائرة'], [/section|division|unit/i, 'قسم']];
export const OFFICE = /^(مكتب مدير|مدير مكتب)\s/;   // «مكتب مدير دائرة …»: موظفو مدير الدائرة نفسه، لا قسم
export const cell = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
export const hasLetters = (v) => /[A-Za-z؀-ۿ]/.test(v);

/** مستوى العمود من عنوانه ← id المستوى أو '' */
export function guessLevel(levels, h) {
  const t = cell(h);
  if (!t) return '';
  for (const [re, name] of EN) if (re.test(t)) { const l = levels.find((x) => x.name === name); if (l) return l.id; }
  const k = searchKey(t);
  let best = null;
  for (const l of levels) {
    const lk = searchKey(l.name);
    if (k === lk || k.includes(lk) || lk.includes(k)) if (!best || l.name.length > best.name.length) best = l;
  }
  return best?.id || '';
}

/** قراءة xlsx أو csv ← [{ rows }] (الأوراق غير الفارغة) */
export async function readSheets(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return [{ rows: parseCsv(await file.text()) }];
  if (/\.xlsx$/i.test(file.name)) return (await readXlsx(await file.arrayBuffer())).filter((s) => s.rows.length);
  throw new Error('نوع الملف غير مدعوم. استخدم xlsx أو csv.');
}

/** أول ورقة وصف عناوين فيه عمود مستوى (في أول 20 صفاً) ← { sheet, hi } أو null */
export function findHeader(levels, sheets, test = (r) => r.some((c) => guessLevel(levels, c))) {
  for (const s of sheets) {
    const hi = s.rows.slice(0, 20).findIndex(test);
    if (hi >= 0) return { sheet: s, hi };
  }
  return null;
}

/**
 * صفوف الملف ← مسار كل صف
 * cols: [[رقم العمود، id المستوى]]؛ rows: صفوف البيانات بعد العناوين؛ hi: رقم صف العناوين (للعرض)
 * ← { rows: [{ line, i, path: [{ v, levelId }], raw, inferred?: نص, skip?: سبب }], ignoredOffice: Set, levelOf }
 */
export function rowPaths(levels, { cols, rows, hi = 0, office = true }) {
  const lv = (id) => levels.find((l) => l.id === Number(id));
  const sorted = [...cols].filter(([, l]) => l).sort((a, b) => lv(a[1]).levelNo - lv(b[1]).levelNo);
  const byName = new Map(levels.map((l) => [normalizeAr(l.name), l]));
  const titles = new Set(levels.map((l) => normalizeAr(l.headTitle)).filter(Boolean));
  const ignoredOffice = new Set();
  const parsed = rows.map((r, i) => {
    const cells = sorted.map(([ci, levelId], j) => {
      let v = cell(r[ci]);
      if (!hasLetters(v)) v = '';
      if (v && titles.has(normalizeAr(v))) v = '';
      if (v && j > 0 && office && OFFICE.test(v)) { ignoredOffice.add(v); v = ''; }
      const own = v ? byName.get(normalizeAr(v)) : null;
      return v ? { v, levelId: own ? own.id : Number(levelId) } : null;
    });
    return { line: hi + 2 + i, i, cells, raw: sorted.map(([ci]) => cell(r[ci])).filter(Boolean) };
  });
  // المسار السابق لكل قيمة، لإكمال الأعلى الناقص
  const prefixes = new Map();
  for (const p of parsed) {
    p.cells.forEach((c, j) => {
      if (!c || !p.cells.slice(0, j).some(Boolean)) return;
      const k = `${j}|${normalizeAr(c.v)}`;
      const pre = p.cells.slice(0, j).filter(Boolean);
      if (!prefixes.has(k)) prefixes.set(k, new Map());
      prefixes.get(k).set(pre.map((x) => normalizeAr(x.v)).join('›'), pre);
    });
  }
  const out = parsed.map((p) => {
    const path = p.cells.filter(Boolean);
    const res = { line: p.line, i: p.i, raw: p.raw, path };
    if (!path.length) {
      if (p.raw.length) res.skip = 'لا وحدة في الصف (فارغ، أو مسمى وظيفي، أو «مكتب مدير …»)';
      return res;
    }
    const j0 = p.cells.findIndex(Boolean);
    if (j0 > 0) {
      const opts = prefixes.get(`${j0}|${normalizeAr(path[0].v)}`);
      if (opts && opts.size === 1) {
        const pre = [...opts.values()][0];
        res.inferred = pre.map((x) => x.v).join(' ← ');
        res.path = [...pre, ...path];
      } else {
        res.skip = opts ? 'المستوى الأعلى فارغ، والوحدة تظهر تحت أكثر من وحدة' : 'المستوى الأعلى فارغ، ولا يُعرف مكانها';
        res.path = [];
      }
    }
    return res;
  });
  return { rows: out, ignoredOffice, cols: sorted, levelOf: lv };
}

/**
 * مسار من الملف ← وحدة في الهيكل الحالي: الوحدة العليا بالاسم ومستواها في أي مكان من الشجرة
 * (لأن الوحدات العليا قد تكون نُقلت تحت غيرها)، ثم النزول بالأسماء (أو الأسماء البديلة)
 * ← { unit } أو { why }
 */
export function resolvePath(M, path) {
  const same = (u, v) => normalizeAr(u.name) === normalizeAr(v) || (u.aliases || []).some((a) => normalizeAr(a) === normalizeAr(v));
  const firsts = M.units.filter((u) => u.levelId === path[0].levelId && same(u, path[0].v));
  if (!firsts.length) return { why: `«${path[0].v}» غير موجودة في الهيكل` };
  if (firsts.length > 1) return { why: `«${path[0].v}» موجودة في أكثر من مكان في الهيكل` };
  let u = firsts[0];
  for (const c of path.slice(1)) {
    const next = M.childrenOf(u.id).find((x) => same(x, c.v));
    if (!next) return { why: `«${c.v}» غير موجودة تحت «${u.name}»` };
    u = next;
  }
  return { unit: u };
}
