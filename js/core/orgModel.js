/**
 * نموذج الهيكل التنظيمي في الذاكرة: يُبنى من القائمة المسطّحة (org.load) ويستخدمه كل ما يعرض الهيكل
 * (صفحة الهيكل، والموظفون، ولاحقاً الجهة الطالبة)
 */
import { searchKey } from './format.js';

export function buildModel({ levels, units }) {
  const level = new Map(levels.map((l) => [l.id, l]));
  const unit = new Map(units.map((u) => [u.id, u]));
  const kids = new Map();
  for (const u of units) {
    const k = u.parentId || 0;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(u);
  }
  for (const list of kids.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ar'));
  const childrenOf = (id) => kids.get(id || 0) || [];
  const ancestors = (u) => { const a = []; for (let p = unit.get(u.parentId); p && a.length < 50; p = unit.get(p.parentId)) a.unshift(p); return a; };
  const subtree = (id) => { const out = [id]; for (let i = 0; i < out.length; i++) for (const c of childrenOf(out[i])) out.push(c.id); return out; };
  const levelNo = (u) => level.get(u.levelId)?.levelNo ?? 0;
  const searchText = new Map(units.map((u) => [u.id, searchKey([u.name, u.shortName, u.code, ...(u.aliases || [])].join(' '))]));
  return { levels, units, level, unit, childrenOf, ancestors, subtree, levelNo, searchText };
}

export const pathText = (M, u) => M.ancestors(u).map((a) => a.name).join(' ← ');


/** المسار الكامل حتى الوحدة نفسها */
export const fullPath = (M, u) => [...M.ancestors(u), u].map((a) => a.name).join(' ← ');

/** الوحدات بترتيب الشجرة (الأعلى ثم ما تحتها)، عدا ما في except */
export function treeOrder(M, except = new Set()) {
  const out = [];
  const walk = (pid, depth) => { for (const c of M.childrenOf(pid)) { if (!except.has(c.id)) { out.push({ u: c, depth }); walk(c.id, depth + 1); } } };
  walk(0, 0);
  return out;
}
