/**
 * محوّل Oracle APEX — يطبّق عقد js/data/contract.js
 *
 * كل طلب يذهب إلى عملية APEX واحدة (Application Process: API) عبر apex.server.process،
 * فتستدعي الحزمة st_api في قاعدة البيانات، وهي التي تحدد المستخدم من جلسة APEX وتفحص صلاحيته.
 * أشكال البيانات المرسلة والمستلمة بأسماء الأعمدة نفسها في نسخة Supabase (snake_case)،
 * والتحويل إلى أشكال الواجهة (camelCase) هنا كما في js/data/supabase/index.js.
 */
import { normalizeSettings } from '../../core/settings.js';

export class ApiError extends Error {
  constructor(message, code = '') { super(message); this.code = code; }
}

const toUser = (r) => r && ({
  id: r.id, email: r.email || '', loginNo: r.login_no || '', fullName: r.full_name, shortName: r.short_name || '',
  role: r.role, isActive: !!Number(r.is_active), mustChangePassword: !!Number(r.must_change_password),
});

const toTask = (r) => ({
  id: r.id, engineerId: r.engineer_id, engineerName: r.engineer_name, engineerShort: r.engineer_short || '',
  refNo: r.ref_no || '', requester: r.requester || '', employeeName: r.employee_name || '', subject: r.subject ?? '',
  receivedDate: r.received_date, completedDate: r.completed_date, notes: r.notes || '',
  taskTypeId: r.task_type_id, taskType: r.task_type || '',
  correspondenceTypeId: r.correspondence_type_id, correspondenceType: r.correspondence_type || '',
  statusId: r.status_id, status: r.status, statusKind: r.status_kind,
  delayReason: r.delay_reason || '', durationDays: r.duration_days ?? null,
  createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at, updatedBy: r.updated_by,
  deletedAt: r.deleted_at, deletedBy: r.deleted_by, reviewReasons: r.review_reasons || [], priority: r.priority || 'normal',
});

const toLookup = (r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: !!Number(r.is_active), ...(r.kind ? { kind: r.kind } : {}) });

/** نفس taskRow في محوّل Supabase: الحقول القابلة للكتابة فقط */
function taskRow(t) {
  const row = {
    ref_no: t.refNo || null, requester: t.requester || null, employee_name: t.employeeName || null,
    subject: t.subject ?? '', received_date: t.receivedDate || null, completed_date: t.completedDate || null,
    notes: t.notes || null, task_type_id: t.taskTypeId || null, correspondence_type_id: t.correspondenceTypeId || null,
    status_id: t.statusId, delay_reason: t.delayReason || null,
  };
  if (t.engineerId) row.engineer_id = t.engineerId;
  if (t.createdBy) row.created_by = t.createdBy;
  if (t.priority !== undefined) row.priority = t.priority === 'urgent' ? 'urgent' : 'normal';
  if (t.reviewReasons !== undefined) row.review_reasons = t.reviewReasons?.length ? t.reviewReasons : null;
  return row;
}

const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));

export function createAdapter(config) {
  let onExpired = () => {};
  let actingTimer = 0;
  let me = null;

  /** طلب إلى الخادم: action + بيانات JSON ← data أو خطأ برسالة عربية */
  function call(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const server = window.apex?.server;
      if (!server) { reject(new ApiError('تعذّر الاتصال بخادم APEX. أعد تحميل الصفحة.')); return; }
      server.process(config.apex.process, { x01: action, p_clob_01: JSON.stringify(payload ?? {}) }, { dataType: 'text', loadingIndicator: null })
        .done((text) => {
          let d = null;
          try { d = JSON.parse(text); } catch { /* ليس JSON: صفحة دخول أو خطأ من APEX */ }
          if (d && d.st === 1) { resolve(d.data); return; }
          if (d && d.st === 0) {
            if (d.expired === 'acting') onExpired('acting');
            else if (d.expired) onExpired();
            reject(new ApiError(d.error, d.expired || ''));
            return;
          }
          // ردّ من APEX نفسه (لا من st_api): غالباً انتهت الجلسة
          const msg = String(d?.error || d?.message || text || '');
          if (!d || /session|جلسة|login/i.test(msg)) { onExpired(); reject(new ApiError('انتهت الجلسة، سجّل الدخول من جديد.', 'session')); return; }
          reject(new ApiError(msg));
        })
        .fail((xhr, status, err) => {
          if (xhr?.status === 401 || xhr?.status === 403) { onExpired(); reject(new ApiError('انتهت الجلسة، سجّل الدخول من جديد.', 'session')); return; }
          reject(new ApiError(xhr?.status ? `خطأ من الخادم (${xhr.status}). حاول مرة أخرى.` : 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.'));
        });
    });
  }

  function setMe(r) {
    me = toUser(r);
    if (r.schema) config.supabase.schema = r.schema;   // للعرض في «معلومات النظام»
    me.realId = r.real_id;
    clearTimeout(actingTimer);
    if (r.acting) {
      // التصفح بحساب مستخدم آخر: لا نطلب تغيير كلمة مروره (هي له، لا لمن يتصفح)، وينتهي بعد ساعة
      me.actingAs = true;
      me.mustChangePassword = false;
      const ms = Date.parse(r.acting_expires_at) - Date.now();
      if (ms > 0 && ms < 2 * 3600e3) actingTimer = setTimeout(() => onExpired('acting'), ms + 500);
    }
    return me;
  }

  const adapter = {
    name: 'apex',

    auth: {
      async restore() {
        try { return setMe(await call('me')); } catch { return null; }
      },
      async signIn() {
        // الدخول من صفحة APEX رقم 9999 (انظر js/pages/login.js)
        location.replace(config.apex.logoutUrl || location.pathname);
        return new Promise(() => {});
      },
      async signOut() {
        me = null;
        clearTimeout(actingTimer);
        if (config.apex.logoutUrl) location.replace(config.apex.logoutUrl);
      },
      async actAs(id) { return setMe(await call('act_as', { id })); },
      async stopActing() { return setMe(await call('stop_acting')); },
      async changePassword(password) {
        await call('change_password', { password });
        if (me) me.mustChangePassword = false;
      },
      onExpired(fn) { onExpired = fn; },
    },

    tasks: {
      async list(f = {}) {
        const rows = await call('tasks_list', {
          engineerId: str(f.engineerId), statusId: str(f.statusId), taskTypeId: str(f.taskTypeId),
          correspondenceTypeId: str(f.correspondenceTypeId), from: str(f.from), to: str(f.to),
          deleted: f.deleted || 'exclude', review: !!f.review,
        });
        return (rows || []).map(toTask);
      },
      async create(t) { return toTask(await call('task_create', { task: taskRow(t) })); },
      async update(id, t) { return toTask(await call('task_update', { id, task: taskRow(t) })); },
      async reviewCount() { return (await call('review_count')).count; },
      async remove(id) { await call('task_remove', { id }); },
      async restore(id) { await call('task_restore', { id }); },
      async bulkCreate(list, onProgress) {
        const size = 200;
        let done = 0;
        for (let i = 0; i < list.length; i += size) {
          const chunk = list.slice(i, i + size).map(taskRow);
          await call('tasks_bulk_create', { list: chunk });
          done += chunk.length;
          onProgress?.(done, list.length);
        }
        return done;
      },
    },

    lookups: {
      async load() {
        const r = await call('lookups_load');
        return {
          taskTypes: (r.taskTypes || []).map(toLookup),
          correspondenceTypes: (r.correspondenceTypes || []).map(toLookup),
          statuses: (r.statuses || []).map(toLookup),
        };
      },
      async save(kind, item) {
        const r = await call('lookup_save', {
          kind,
          item: { id: item.id || null, name: item.name.trim(), sort_order: Number(item.sortOrder) || 0, is_active: item.isActive !== false, kind: item.kind || 'open' },
        });
        return toLookup(r);
      },
    },

    users: {
      async list() { return ((await call('users_list')) || []).map(toUser); },
      async create(u) {
        return toUser(await call('user_create', {
          login_no: u.loginNo || null, email: u.email || '', password: u.password, full_name: u.fullName, short_name: u.shortName, role: u.role,
        }));
      },
      async update(id, u) {
        const body = { id };
        if (u.fullName !== undefined) body.full_name = u.fullName;
        if (u.email !== undefined) body.email = u.email;
        if (u.loginNo !== undefined) body.login_no = u.loginNo || null;
        if (u.shortName !== undefined) body.short_name = u.shortName;
        if (u.role !== undefined) body.role = u.role;
        if (u.isActive !== undefined) body.is_active = !!u.isActive;
        return toUser(await call('user_update', body));
      },
      async resetPassword(id, password) { return call('user_reset_password', { id, password }); },
      async resetAll(o) {
        return call('users_reset_all', { mode: o.mode === 'loginNo' ? 'login_no' : 'same', password: o.password, force: !!o.force, include_inactive: !!o.includeInactive });
      },
    },

    settings: {
      async load() {
        const m = await call('settings_load');
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
        await call('settings_save', {
          settings: {
            edit_lock_days: n.editLockDays, delay_threshold_days: n.delayThresholdDays,
            min_password_length: n.minPasswordLength, force_password_change: n.forcePasswordChange,
            allow_purge_tasks: n.allowPurgeTasks, announcement: n.announcement,
            announcement_type: n.announcementType, announcement_expires_at: n.announcementExpiresAt,
            sync_user_id: n.syncUserId,
          },
        });
        return this.load();
      },
    },

    maintenance: {
      /** «تحديث بيانات التجربة من الإنتاج»: يقرأ نظام Supabase (الإنتاج) ويستبدل به بيانات APEX
       *  o: { mode: 'login_no'|'same', password, force } */
      async refreshFromProduction(o = {}) {
        const { migrateFromSupabase } = await import('./migrate.js');
        return migrateFromSupabase({ call, me, config, options: o });
      },
      /** حذف كل المهام وسجلها نهائياً ← { tasks, at } */
      async purgeAllTasks() { return call('purge_all_tasks'); },
    },

    audit: {
      async list(f = {}) {
        const rows = await call('audit_list', { taskId: str(f.taskId), from: str(f.from), to: str(f.to), limit: f.limit || 500 });
        return (rows || []).map((r) => ({
          id: r.id, taskId: r.task_id, action: r.action, changedBy: r.changed_by, changedAt: r.changed_at,
          changedFields: r.changed_fields, oldData: r.old_data, newData: r.new_data,
        }));
      },
    },
  };
  return adapter;
}
