/**
 * محوّل Supabase — يطبّق عقد contract.js فوق client.js
 */
import { createClient, ApiError } from './client.js';
import { normalizeSettings } from '../../core/settings.js';
import { latinDigits as latin } from '../../core/format.js';
import { CONFIG } from '../../config.js';

const TASK_COLS = 'id,engineer_id,engineer_name,engineer_short,ref_no,requester,employee_name,subject,received_date,completed_date,notes,task_type_id,task_type,correspondence_type_id,correspondence_type,status_id,status,status_kind,delay_reason,duration_days,created_at,created_by,updated_at,updated_by,deleted_at,deleted_by,review_reasons,priority';
const LOOKUP_TABLES = { taskTypes: 'task_types', correspondenceTypes: 'correspondence_types', statuses: 'task_statuses' };

const INTERNAL = '@tasks.internal';
const toUser = (r) => r && ({
  id: r.id, email: r.email?.endsWith(INTERNAL) ? '' : r.email, loginNo: r.login_no || '', fullName: r.full_name, shortName: r.short_name || '',
  role: r.role, isActive: r.is_active, mustChangePassword: r.must_change_password,
});

const toTask = (r) => ({
  id: r.id, engineerId: r.engineer_id, engineerName: r.engineer_name, engineerShort: r.engineer_short || '',
  refNo: r.ref_no || '', requester: r.requester || '', employeeName: r.employee_name || '', subject: r.subject,
  receivedDate: r.received_date, completedDate: r.completed_date, notes: r.notes || '',
  taskTypeId: r.task_type_id, taskType: r.task_type || '',
  correspondenceTypeId: r.correspondence_type_id, correspondenceType: r.correspondence_type || '',
  statusId: r.status_id, status: r.status, statusKind: r.status_kind,
  delayReason: r.delay_reason || '', durationDays: r.duration_days,
  createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at, updatedBy: r.updated_by,
  deletedAt: r.deleted_at, deletedBy: r.deleted_by, reviewReasons: r.review_reasons || [], priority: r.priority || 'normal',
});

const toLookup = (r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active, ...(r.kind ? { kind: r.kind } : {}) });

function taskRow(t) {
  const row = {
    ref_no: t.refNo || null, requester: t.requester || null, employee_name: t.employeeName || null,
    subject: t.subject ?? '', received_date: t.receivedDate || null, completed_date: t.completedDate || null,
    notes: t.notes || null, task_type_id: t.taskTypeId || null, correspondence_type_id: t.correspondenceTypeId || null,
    status_id: t.statusId, delay_reason: t.delayReason || null,
  };
  if (t.engineerId) row.engineer_id = t.engineerId;
  // الاستيراد يسجّل المهمة باسم مهندسها (تقبله قاعدة البيانات من مدير النظام فقط)
  if (t.createdBy) row.created_by = t.createdBy;
  if (t.priority !== undefined) row.priority = t.priority === 'urgent' ? 'urgent' : 'normal';
  // أسباب المراجعة: يضعها الاستيراد، ومسحها = «تمت المراجعة»
  if (t.reviewReasons !== undefined) row.review_reasons = t.reviewReasons?.length ? t.reviewReasons : null;
  return row;
}

/** فرق المنطقة الزمنية مثل '+04:00' (لتصفية السجل بأيام المنطقة المحلية) */
function utcOffset(timeZone) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date());
    const v = p.find((x) => x.type === 'timeZoneName')?.value || 'GMT';
    return v === 'GMT' ? '+00:00' : v.replace('GMT', '');
  } catch { return '+00:00'; }
}

export function createAdapter(config) {
  const c = createClient(config.supabase);
  const tz = utcOffset(config.timeZone);
  const fn = config.supabase.adminFunction || 'admin-users';
  let me = null;

  async function loadMe() {
    const uid = c.session?.user?.id;
    if (!uid) return null;
    const rows = await c.select('profiles', { id: `eq.${uid}`, select: '*' });
    if (!rows.length) {
      if (c.acting) { c.stopActing(); throw new ApiError(`المستخدم غير موجود في نسخة ${CONFIG.envName}.`); }
      await c.signOut();
      throw new ApiError('حسابك غير مسجّل في النظام. تواصل مع مدير النظام.');
    }
    me = toUser(rows[0]);
    if (c.acting) {
      // التصفح بحساب مستخدم آخر: لا نطلب تغيير كلمة مروره (هي له، لا لمن يتصفح)
      me.actingAs = true;
      me.mustChangePassword = false;
    }
    if (!me.isActive) {
      if (c.acting) { c.stopActing(); throw new ApiError(`هذا الحساب معطّل في نسخة ${CONFIG.envName}.`); }
      await c.signOut();
      throw new ApiError('هذا الحساب معطّل. تواصل مع مدير النظام.');
    }
    return me;
  }

  const getTask = async (id) => {
    const rows = await c.select('v_tasks', { id: `eq.${id}`, select: TASK_COLS });
    return rows[0] ? toTask(rows[0]) : null;
  };

  return {
    name: 'supabase',

    auth: {
      async restore() {
        if (!(await c.ensureSession())) return null;
        try { return await loadMe(); } catch { return null; }
      },
      async signIn(login, password) {
        const id = latin(login).trim().toLowerCase();
        if (id.includes('@')) await c.signIn(id, password);
        else await c.signInVia(config.supabase.loginFunction || 'auth-login', id, password);
        return loadMe();
      },
      async signOut() { me = null; await c.signOut(); },
      /** التجربة والتطوير فقط: التصفح بحساب مستخدم آخر دون كلمة مروره */
      async actAs(id) {
        const r = await c.invoke(fn, { action: 'impersonate', id });
        c.startActing(r.session);
        try { return await loadMe(); } catch (e) { c.stopActing(); throw e; }
      },
      /** العودة لحساب المدير */
      async stopActing() {
        c.stopActing();
        return loadMe();
      },
      async changePassword(password) {
        await c.updatePassword(password);
        await c.rpc('mark_password_changed');
        if (me) me.mustChangePassword = false;
      },
      onExpired(fn) { c.setOnExpired(fn); },
    },

    tasks: {
      async list(f = {}) {
        const q = { select: TASK_COLS, order: 'received_date.desc,id.desc' };
        const and = [];
        if (f.engineerId) q.engineer_id = `eq.${f.engineerId}`;
        if (f.statusId) q.status_id = `eq.${f.statusId}`;
        if (f.taskTypeId) q.task_type_id = `eq.${f.taskTypeId}`;
        if (f.review) q.review_reasons = 'not.is.null';
        if (f.correspondenceTypeId) q.correspondence_type_id = `eq.${f.correspondenceTypeId}`;
        if (f.from) and.push(`received_date.gte.${f.from}`);
        if (f.to) and.push(`received_date.lte.${f.to}`);
        if (and.length) q.and = `(${and.join(',')})`;
        const del = f.deleted || 'exclude';
        if (del === 'exclude') q.deleted_at = 'is.null';
        else if (del === 'only') q.deleted_at = 'not.is.null';
        return (await c.selectAll('v_tasks', q)).map(toTask);
      },
      async create(t) {
        const [row] = await c.insert('tasks', taskRow(t));
        return getTask(row.id);
      },
      async update(id, t) {
        const rows = await c.update('tasks', { id: `eq.${id}` }, taskRow(t));
        if (!rows.length) throw new ApiError('لا تملك صلاحية تعديل هذه المهمة، أو أنها حُذفت.');
        return getTask(id);
      },
      /** عدد المهام التي تحتاج مراجعة (المهندس: مهامه فقط حسب الصلاحيات) */
      async reviewCount() {
        const rows = await c.selectAll('tasks', { select: 'id', review_reasons: 'not.is.null', deleted_at: 'is.null' });
        return rows.length;
      },
      async remove(id) { await c.rpc('soft_delete_task', { p_id: id }); },
      async restore(id) { await c.rpc('restore_task', { p_id: id }); },
      async bulkCreate(list, onProgress) {
        const size = 300;
        let done = 0;
        for (let i = 0; i < list.length; i += size) {
          const chunk = list.slice(i, i + size).map(taskRow);
          await c.insert('tasks', chunk, { returning: false });
          done += chunk.length;
          onProgress?.(done, list.length);
        }
        return done;
      },
    },

    lookups: {
      async load() {
        const [a, b, s] = await Promise.all(Object.values(LOOKUP_TABLES).map((t) =>
          c.select(t, { select: '*', order: 'sort_order.asc,name.asc' })));
        return { taskTypes: a.map(toLookup), correspondenceTypes: b.map(toLookup), statuses: s.map(toLookup) };
      },
      async save(kind, item) {
        const table = LOOKUP_TABLES[kind];
        const row = { name: item.name.trim(), sort_order: Number(item.sortOrder) || 0, is_active: item.isActive !== false };
        if (kind === 'statuses') row.kind = item.kind || 'open';
        const rows = item.id
          ? await c.update(table, { id: `eq.${item.id}` }, row)
          : await c.insert(table, row);
        return toLookup(rows[0]);
      },
    },

    users: {
      async list() {
        return (await c.select('profiles', { select: '*', order: 'full_name.asc' })).map(toUser);
      },
      async create(u) {
        const r = await c.invoke(fn, {
          action: 'create', login_no: u.loginNo || null, email: u.email || '', password: u.password, full_name: u.fullName, short_name: u.shortName, role: u.role,
        });
        return toUser(r.user);
      },
      async update(id, u) {
        const body = { action: 'update', id };
        if (u.fullName !== undefined) body.full_name = u.fullName;
        if (u.email !== undefined) body.email = u.email;
        if (u.loginNo !== undefined) body.login_no = u.loginNo || null;
        if (u.shortName !== undefined) body.short_name = u.shortName;
        if (u.role !== undefined) body.role = u.role;
        if (u.isActive !== undefined) body.is_active = u.isActive;
        const r = await c.invoke(fn, body);
        return toUser(r.user);
      },
      async resetPassword(id, password) {
        return c.invoke(fn, { action: 'reset_password', id, password });
      },
      /** opts: { mode: 'same'|'loginNo', password?, force, includeInactive } ← { reset, skipped: [{name, reason}] } */
      async resetAll(o) {
        return c.invoke(fn, { action: 'reset_all', mode: o.mode === 'loginNo' ? 'login_no' : 'same', password: o.password, force: o.force, include_inactive: o.includeInactive });
      },
    },

    settings: {
      async load() {
        const rows = await c.select('app_settings', { select: 'key,value' });
        const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        return normalizeSettings({
          editLockDays: m.edit_lock_days, delayThresholdDays: m.delay_threshold_days,
          minPasswordLength: m.min_password_length, forcePasswordChange: m.force_password_change,
          allowPurgeTasks: m.allow_purge_tasks, announcement: m.announcement,
          announcementType: m.announcement_type, announcementExpiresAt: m.announcement_expires_at,
          syncUserId: m.sync_user_id,
        });
      },
      async save(s) {
        const n = normalizeSettings(s);
        await c.upsert('app_settings', [
          { key: 'edit_lock_days', value: n.editLockDays },
          { key: 'delay_threshold_days', value: n.delayThresholdDays },
          { key: 'min_password_length', value: n.minPasswordLength },
          { key: 'force_password_change', value: n.forcePasswordChange },
          { key: 'allow_purge_tasks', value: n.allowPurgeTasks },
          { key: 'announcement', value: n.announcement },
          { key: 'announcement_type', value: n.announcementType },
          { key: 'announcement_expires_at', value: n.announcementExpiresAt },
          { key: 'sync_user_id', value: n.syncUserId },
        ], 'key');
        return this.load();
      },
    },

    maintenance: {
      /** نسختا التجربة والتطوير فقط: نسخ بيانات الإنتاج (مشروع مستقل) إليها عبر دالة refresh-staging أو refresh-dev
       *  o: { mode: 'login_no'|'same', password, force } */
      async refreshFromProduction(o = {}) {
        const r = await c.invoke(config.supabase.refreshFunction || 'refresh-staging', { mode: o.mode, password: o.password || undefined, force: !!o.force });
        return { users: r.users, created: r.created, tasks: r.tasks, skippedTasks: r.skipped_tasks, deactivated: r.deactivated, notes: r.notes || [], at: r.at };
      },
      /** حذف كل المهام وسجلها نهائياً ← { tasks }. في الإنتاج يحتاج إعداد «السماح بحذف كل المهام» */
      async purgeAllTasks() {
        const r = await c.rpc('purge_all_tasks');
        return { tasks: r.tasks, at: r.at };
      },
    },

    audit: {
      async list(f = {}) {
        const q = { select: '*', order: 'changed_at.desc,id.desc', limit: String(f.limit || 500) };
        const and = [];
        if (f.taskId) q.task_id = `eq.${f.taskId}`;
        if (f.from) and.push(`changed_at.gte.${f.from}T00:00:00${tz}`);
        if (f.to) and.push(`changed_at.lte.${f.to}T23:59:59.999${tz}`);
        if (and.length) q.and = `(${and.join(',')})`;
        const rows = await c.select('task_audit', q);
        return rows.map((r) => ({
          id: r.id, taskId: r.task_id, action: r.action, changedBy: r.changed_by, changedAt: r.changed_at,
          changedFields: r.changed_fields, oldData: r.old_data, newData: r.new_data,
        }));
      },
    },
  };
}
