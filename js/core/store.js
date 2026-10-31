/**
 * حالة التطبيق المشتركة: المستخدم الحالي، القوائم، الإعدادات، والصلاحيات
 */
import { db } from '../data/index.js';

export const state = {
  user: null,        // { id, email, fullName, shortName, role, isActive, mustChangePassword }
  lookups: null,     // { taskTypes, correspondenceTypes, statuses }
  settings: null,    // { editLockDays, delayThresholdDays }
  users: null,       // قائمة المستخدمين (للمدير ورئيس القسم والمشاهد)
};

export const ROLE_LABELS = { admin: 'مدير النظام', head: 'رئيس القسم', engineer: 'مهندس', viewer: 'مشاهد' };
export const STATUS_KIND_LABELS = { open: 'مفتوحة', done: 'مكتملة', cancelled: 'ملغاة' };

/** مصفوفة الصلاحيات في الواجهة (قاعدة البيانات تفرض نفس القواعد بشكل مستقل) */
const MATRIX = {
  'tasks.create':     ['admin', 'head', 'engineer'],
  'tasks.editAny':    ['admin', 'head'],
  'tasks.viewAll':    ['admin', 'head', 'viewer'],
  'tasks.delete':     ['admin'],
  'tasks.assign':     ['admin', 'head'],
  'tasks.bypassLock': ['admin', 'head'],
  'users.manage':     ['admin'],
  'lists.manage':     ['admin', 'head'],
  'settings.manage':  ['admin'],
  'audit.view':       ['admin', 'head'],
  'import.run':       ['admin'],
};

export function can(action) {
  const r = state.user?.role;
  return !!r && (MATRIX[action] || []).includes(r);
}

export function isLocked(task) {
  if (!task || can('tasks.bypassLock')) return false;
  const days = state.settings?.editLockDays || 0;
  if (!days || task.statusKind !== 'done' || !task.completedDate) return false;
  const limit = new Date(task.completedDate + 'T00:00:00Z');
  limit.setUTCDate(limit.getUTCDate() + days);
  const now = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  return now > limit;
}

/** هل يستطيع المستخدم الحالي تعديل هذه المهمة؟ */
export function canEditTask(task) {
  if (!task || task.deletedAt) return false;
  if (can('tasks.editAny')) return true;
  return state.user?.role === 'engineer' && task.engineerId === state.user.id && !isLocked(task);
}

export async function loadReference({ force = false } = {}) {
  const jobs = [];
  if (force || !state.lookups) jobs.push(db.lookups.load().then((l) => (state.lookups = l)));
  if (force || !state.settings) jobs.push(db.settings.load().then((s) => (state.settings = s)));
  if ((force || !state.users) && can('tasks.viewAll')) jobs.push(db.users.list().then((u) => (state.users = u)));
  await Promise.all(jobs);
}

export function engineers({ includeInactive = false } = {}) {
  const list = state.users || (state.user ? [state.user] : []);
  return list
    .filter((u) => (includeInactive || u.isActive) && u.role !== 'viewer')
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar'));
}

export const userName = (id) => state.users?.find((u) => u.id === id)?.fullName || (state.user?.id === id ? state.user.fullName : '—');

export function activeItems(kind, keepId) {
  return (state.lookups?.[kind] || []).filter((x) => x.isActive || x.id === keepId);
}

export function resetState() {
  state.user = null; state.lookups = null; state.settings = null; state.users = null;
}
