/**
 * دليل الجهات والموظفين لحقلي «الجهة الطالبة» و«اسم الموظف» في المهام:
 * الهيكل (db.org.load) ودليل الموظفين بلا الرقم المدني (db.employees.directory)، يُحمَّلان مرة ويُحفظان للجلسة.
 * صفحتا الهيكل والموظفين تستدعيان invalidateDirectory() بعد أي تعديل.
 *
 * directory() ← Promise<{ M, emps, emp: Map, unitAt(empId, date), searchUnits(q), searchEmployees(q), unitLabel(id) }>
 */
import { db } from '../data/index.js';
import { buildModel, pathText, fullPath, treeOrder } from './orgModel.js';
import { searchKey, queryWords, normalizeAr, today } from './format.js';

let P = null;

export function invalidateDirectory() { P = null; }

export function directory({ fresh = false } = {}) {
  if (!P || fresh) {
    P = Promise.all([db.org.load(), db.employees.directory()]).then(([org, d]) => build(org, d));
    P.catch(() => { P = null; });
  }
  return P;
}

function build(org, d) {
  const M = buildModel(org);
  const emps = d.employees;
  const emp = new Map(emps.map((e) => [e.id, e]));
  const asg = new Map();
  for (const a of d.assignments) { if (!asg.has(a.employeeId)) asg.set(a.employeeId, []); asg.get(a.employeeId).push(a); }

  /** وحدة الموظف في تاريخ: الأصيل أولاً ثم غيره، والأحدث بداية */
  function unitAt(empId, date = today()) {
    const list = (asg.get(empId) || []).filter((a) => a.startDate <= date && (!a.endDate || a.endDate >= date));
    list.sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || y.startDate.localeCompare(x.startDate));
    return list[0] ? M.unit.get(list[0].unitId) || null : null;
  }

  // الوحدات النشطة بترتيب الشجرة، ونص البحث: الاسم والاختصار والرمز والأسماء البديلة والمسار
  const order = treeOrder(M).map(({ u }) => u).filter((u) => u.isActive);
  const unitKey = new Map(order.map((u) => [u.id, `${M.searchText.get(u.id)} ${searchKey(fullPath(M, u))}`]));
  const exactUnit = new Map();
  for (const u of order) for (const n of [u.name, u.shortName, ...u.aliases].filter(Boolean)) {
    const k = normalizeAr(n);
    exactUnit.set(k, exactUnit.has(k) && exactUnit.get(k) !== u.id ? 0 : u.id);   // 0: الاسم لأكثر من وحدة
  }

  /** بحث الوحدات: الاسم المطابق أولاً، ثم ما يبدأ به، ثم ما يحتويه */
  function searchUnits(q, max = 40) {
    const words = queryWords(q);
    if (!words.length) return [];
    const k0 = searchKey(q);
    const hits = order.filter((u) => words.every((w) => unitKey.get(u.id).includes(w)));
    const rank = (u) => {
      const n = searchKey(u.name);
      return n === k0 || u.aliases.some((a) => searchKey(a) === k0) ? 0 : n.startsWith(k0) ? 1 : 2;
    };
    return hits.map((u, i) => [u, rank(u), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).slice(0, max).map(([u]) => u);
  }

  /** الوحدة باسم مطابق تماماً (الاسم أو الاختصار أو اسم بديل) إن كانت واحدة */
  const unitByName = (text) => {
    const id = exactUnit.get(normalizeAr(text || ''));
    return id ? M.unit.get(id) : null;
  };

  const empKey = new Map(emps.map((e) => [e.id, `${searchKey(e.nameAr)} ${e.employeeNo.toLowerCase()}`]));
  const empByName = new Map();
  for (const e of emps) if (e.isActive) { const k = normalizeAr(e.nameAr); empByName.set(k, empByName.has(k) ? 0 : e.id); }

  function searchEmployees(q, max = 40) {
    const words = queryWords(q);
    if (!words.length) return [];
    const k0 = searchKey(q);
    const hits = emps.filter((e) => e.isActive && words.every((w) => empKey.get(e.id).includes(w)));
    const rank = (e) => (e.employeeNo && e.employeeNo === q.trim() ? 0 : searchKey(e.nameAr).startsWith(k0) ? 1 : 2);
    return hits.map((e, i) => [e, rank(e), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).slice(0, max).map(([e]) => e);
  }
  const empByExactName = (text) => {
    const id = empByName.get(normalizeAr(text || ''));
    return id ? emp.get(id) : null;
  };

  const unitLabel = (id) => { const u = M.unit.get(id); return u ? { name: u.name, path: pathText(M, u), level: M.level.get(u.levelId)?.name || '' } : null; };

  return { M, emps, emp, unitAt, searchUnits, unitByName, searchEmployees, empByExactName, unitLabel };
}

/* ───────────── المستخدمة مؤخراً (لكل مستخدم في هذا المتصفح) ───────────── */
const RKEY = (kind, uid) => `tasks.recent.${kind}.${uid}`;
export function recent(kind, uid) {
  try { return JSON.parse(localStorage.getItem(RKEY(kind, uid)) || '[]').filter(Number.isInteger); } catch { return []; }
}
export function pushRecent(kind, uid, id) {
  if (!id) return;
  try { localStorage.setItem(RKEY(kind, uid), JSON.stringify([id, ...recent(kind, uid).filter((x) => x !== id)].slice(0, 8))); } catch { /* */ }
}
