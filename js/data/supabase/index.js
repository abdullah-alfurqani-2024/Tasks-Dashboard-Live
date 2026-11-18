/**
 * محوّل Supabase — يطبّق عقد contract.js فوق client.js
 */
import { createClient, ApiError } from './client.js';
import { normalizeSettings } from '../../core/settings.js';
import { latinDigits as latin } from '../../core/format.js';
import { CONFIG } from '../../config.js';

const TASK_COLS = 'id,engineer_id,engineer_name,engineer_short,ref_no,requester,employee_name,subject,received_date,completed_date,notes,task_type_id,task_type,correspondence_type_id,correspondence_type,status_id,status,status_kind,delay_reason,duration_days,created_at,created_by,updated_at,updated_by,deleted_at,deleted_by,review_reasons,priority,task_code,entered_at,imported_at';
const LOOKUP_TABLES = { taskTypes: 'task_types', correspondenceTypes: 'correspondence_types', statuses: 'task_statuses' };

const INTERNAL = '@tasks.internal';
const toUser = (r) => r && ({
  id: r.id, email: r.email?.endsWith(INTERNAL) ? '' : r.email, loginNo: r.login_no || '', fullName: r.full_name, shortName: r.short_name || '',
  engineerCode: r.engineer_code || '', employeeId: r.employee_id ?? null,
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
  // رمز المهمة (16_task_code.sql)، وتاريخ الإدخال: من Sheets للمستوردة، وإلا وقت الإضافة
  taskCode: r.task_code || '', enteredAt: r.entered_at || r.created_at, importedAt: r.imported_at || null,
});

const toLevel = (r) => ({ id: r.id, name: r.name, levelNo: r.level_no, headTitle: r.head_title || '', isActive: r.is_active });
const toUnit = (r) => ({
  id: r.id, parentId: r.parent_id, levelId: r.level_id, name: r.name, shortName: r.short_name || '', code: r.code || '',
  aliases: r.aliases || [], sortOrder: r.sort_order, isActive: r.is_active,
});
/** دوال استيراد الهيكل وحذفه غير موجودة بعد */
const orgImportMissing = (e) => {
  if (['PGRST202', '42883'].includes(e?.code)) {
    throw new ApiError('استيراد الهيكل وحذفه غير مجهّزين في قاعدة بيانات هذه النسخة: نفّذ ملف supabase/dev/sql/21_org_import.sql في SQL Editor.', e.status, e.code);
  }
  throw e;
};
const UNIT_COLS = 'id,parent_id,level_id,name,short_name,code,aliases,sort_order,is_active';
/** جداول الهيكل غير موجودة بعد (لم يُنفَّذ ملف قاعدة البيانات في هذه النسخة) */
const orgMissing = (e) => {
  // PGRST205: الجدول غير موجود، PGRST202: الدالة غير موجودة (أو قديمة في ذاكرة Supabase)
  if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(e?.code)) {
    throw new ApiError('الهيكل التنظيمي غير مجهّز في قاعدة بيانات هذه النسخة: نفّذ ملف supabase/dev/sql/18_org_structure.sql في SQL Editor.', e.status, e.code);
  }
  throw e;
};

const toEmployee = (r) => ({
  id: r.id, civilNo: r.civil_no || '', employeeNo: r.employee_no || '', nameAr: r.name_ar, nameEn: r.name_en || '', isActive: r.is_active,
  needsReview: !!r.needs_review, reviewNotes: r.review_notes || '',
});
const toAType = (r) => ({ id: r.id, name: r.name, isPrimary: r.is_primary, impliesHead: r.implies_head, sortOrder: r.sort_order, isActive: r.is_active });
const toAssignment = (r) => ({
  id: r.id, employeeId: r.employee_id, unitId: r.unit_id, typeId: r.type_id, isHead: r.is_head,
  startDate: r.start_date, endDate: r.end_date, notes: r.notes || '',
});
const EMP_COLS = 'id,civil_no,employee_no,name_ar,name_en,is_active,needs_review,review_notes';
const ASG_COLS = 'id,employee_id,unit_id,type_id,is_head,start_date,end_date,notes';
/** جداول الموظفين غير موجودة بعد */
const empMissing = (e) => {
  if (['PGRST205', 'PGRST202', '42P01', '42883'].includes(e?.code)) {
    throw new ApiError('الموظفون غير مجهّزين في قاعدة بيانات هذه النسخة: نفّذ ملف supabase/dev/sql/19_employees.sql ثم 20_employees_review.sql في SQL Editor.', e.status, e.code);
  }
  if (e?.code === '42703' || e?.code === 'PGRST204') {   // عمود غير موجود: 20 لم يُنفَّذ
    throw new ApiError('نفّذ ملف supabase/dev/sql/20_employees_review.sql في SQL Editor (أعمدة «تحتاج مراجعة»).', e.status, e.code);
  }
  throw e;
};

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
  // الاستيراد فقط (مدير النظام): الرمز وتاريخ الإدخال من الملف، و«مستوردة» (قاعدة البيانات تختمها بوقت الكتابة)
  if (t.taskCode) row.task_code = t.taskCode;
  if (t.enteredAt) row.entered_at = t.enteredAt;
  if (t.imported) row.imported_at = new Date().toISOString();
  // مرجع الاستيراد: قيم الملف لهذه المهمة (للدمج حسب الحقل في الاستيراد التالي، 17_import_merge.sql)
  if (t.importedData !== undefined) row.imported_data = t.importedData;
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
      /** مراجع الاستيراد (قيم الملف عند آخر استيراد) ← Map(id → object). مدير النظام */
      async importBase() {
        const rows = await c.selectAll('tasks', { select: 'id,imported_data', imported_data: 'not.is.null' });
        return new Map(rows.map((r) => [r.id, r.imported_data]));
      },
      /** حفظ المراجع وحدها دون تعديل المهام: [{ id, data }] ← عدد ما تغيّر */
      async saveImportBase(list, onProgress) {
        let n = 0;
        for (let i = 0; i < list.length; i += 500) {
          n += await c.rpc('save_import_base', { p: list.slice(i, i + 500) });
          onProgress?.(Math.min(i + 500, list.length), list.length);
        }
        return n;
      },
      /** تحديث مهام كثيرة (الاستيراد): [{ id, ...TaskInput }] ← عدد المحدَّثة. ٤ طلبات معاً */
      async bulkUpdate(list, onProgress) {
        let done = 0, i = 0;
        const worker = async () => {
          while (i < list.length) {
            const { id, ...t } = list[i++];
            const rows = await c.update('tasks', { id: `eq.${id}` }, taskRow(t));
            if (!rows.length) throw new ApiError(`تعذّر تحديث المهمة ${t.taskCode || `#${id}`}: لا صلاحية أو أنها حُذفت.`);
            done++;
            onProgress?.(done, list.length);
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
        return done;
      },
      async bulkCreate(list, onProgress) {
        const size = 300;
        let done = 0;
        for (let i = 0; i < list.length; i += size) {
          // PostgREST يشترط المفاتيح نفسها في كل صفوف الدفعة: ما ينقص صفاً (مثل task_code للصف بلا رمز) يُرسل null،
          // وقاعدة البيانات تعطيه قيمته (الرمز التالي، تاريخ الإدخال = الآن)
          const part = list.slice(i, i + size).map(taskRow);
          const keys = [...new Set(part.flatMap(Object.keys))];
          const chunk = part.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
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

    org: {
      async load() {
        try {
          const [l, u] = await Promise.all([
            c.select('org_levels', { select: 'id,name,level_no,head_title,is_active', order: 'level_no.asc,name.asc' }),
            c.selectAll('org_units', { select: UNIT_COLS, order: 'sort_order.asc,name.asc,id.asc' }),
          ]);
          return { levels: l.map(toLevel), units: u.map(toUnit) };
        } catch (e) { return orgMissing(e); }
      },
      async saveLevel(l) {
        const row = { name: l.name, level_no: Number(l.levelNo), head_title: l.headTitle || null, is_active: l.isActive !== false };
        const rows = l.id ? await c.update('org_levels', { id: `eq.${l.id}` }, row) : await c.insert('org_levels', row);
        if (!rows.length) throw new ApiError('لا تملك صلاحية تعديل الهيكل.');
        return toLevel(rows[0]);
      },
      async deleteLevel(id) { await c.rpc('org_delete_level', { p_id: id }).catch(orgMissing); },
      async saveUnit(u) {
        const row = {
          parent_id: u.parentId || null, level_id: u.levelId, name: u.name, short_name: u.shortName || null, code: u.code || null,
          aliases: u.aliases || [], sort_order: Number(u.sortOrder) || 0,
        };
        const rows = u.id ? await c.update('org_units', { id: `eq.${u.id}`, select: UNIT_COLS }, row) : await c.insert('org_units', row);
        if (!rows.length) throw new ApiError('لا تملك صلاحية تعديل الهيكل، أو أن الوحدة حُذفت.');
        return toUnit(rows[0]);
      },
      async setActive(id, active, subtree = false) {
        return c.rpc('org_set_active', { p_id: id, p_active: !!active, p_subtree: !!subtree }).catch(orgMissing);
      },
      async deleteUnit(id) { await c.rpc('org_delete_unit', { p_id: id }).catch(orgMissing); },
      async import(items, replace = false) {
        const r = await c.rpc('org_import', {
          p: items.map((i) => ({ k: i.k, p: i.p || null, parent_id: i.parentId || null, name: i.name, level_id: i.levelId, sort: i.sort || 0 })),
          p_replace: !!replace,
        }).catch(orgImportMissing);
        return { created: r.created, existing: r.existing, purgedUnits: r.purged_units, purgedAssignments: r.purged_assignments };
      },
      async purge() { return c.rpc('org_purge').catch(orgImportMissing); },
      async audit(f = {}) {
        const rows = await c.select('org_audit', { select: '*', order: 'changed_at.desc,id.desc', limit: String(f.limit || 300) });
        return rows.map((r) => ({
          id: r.id, entity: r.entity, entityId: r.entity_id, action: r.action, changedBy: r.changed_by, changedAt: r.changed_at,
          changedFields: r.changed_fields, oldData: r.old_data, newData: r.new_data,
        }));
      },
    },

    employees: {
      async list() {
        return (await c.selectAll('employees', { select: EMP_COLS, order: 'name_ar.asc,id.asc' }).catch(empMissing)).map(toEmployee);
      },
      async save(e) {
        const row = { civil_no: e.civilNo || null, employee_no: e.employeeNo || null, name_ar: e.nameAr, name_en: e.nameEn || null,
          needs_review: !!e.needsReview, review_notes: e.reviewNotes || null };
        const rows = await (e.id ? c.update('employees', { id: `eq.${e.id}`, select: EMP_COLS }, row) : c.insert('employees', row)).catch(empMissing);
        if (!rows.length) throw new ApiError('لا تملك صلاحية تعديل الموظفين.');
        return toEmployee(rows[0]);
      },
      async setActive(id, active, date) {
        return c.rpc('employee_set_active', { p_id: id, p_active: !!active, ...(date ? { p_date: date } : {}) });
      },
      async assignments(f = {}) {
        const q = { select: ASG_COLS, order: 'start_date.desc,id.desc' };
        if (f.employeeId) q.employee_id = `eq.${f.employeeId}`;
        return (await c.selectAll('employee_assignments', q).catch(empMissing)).map(toAssignment);
      },
      async saveAssignment(a) {
        const row = { unit_id: a.unitId, type_id: a.typeId, is_head: !!a.isHead, start_date: a.startDate, end_date: a.endDate || null, notes: a.notes || null };
        if (!a.id) row.employee_id = a.employeeId;
        const rows = a.id ? await c.update('employee_assignments', { id: `eq.${a.id}`, select: ASG_COLS }, row) : await c.insert('employee_assignments', row);
        if (!rows.length) throw new ApiError('لا تملك صلاحية تعديل الإسنادات.');
        return toAssignment(rows[0]);
      },
      async deleteAssignment(id) { await c.rpc('assignment_delete', { p_id: id }); },
      async transfer(t) {
        return c.rpc('employee_transfer', { p_employee: t.employeeId, p_unit: t.unitId, p_date: t.date, p_is_head: !!t.isHead });
      },
      async types() {
        return (await c.select('assignment_types', { select: '*', order: 'sort_order.asc,name.asc' }).catch(empMissing)).map(toAType);
      },
      async saveType(t) {
        const row = { name: t.name, implies_head: !!t.impliesHead, sort_order: Number(t.sortOrder) || 0, is_active: t.isActive !== false };
        const rows = t.id ? await c.update('assignment_types', { id: `eq.${t.id}` }, row) : await c.insert('assignment_types', row);
        if (!rows.length) throw new ApiError('لا تملك صلاحية تعديل الأنواع.');
        return toAType(rows[0]);
      },
      async deleteType(id) { await c.rpc('assignment_type_delete', { p_id: id }); },
      /** دفعات من 250 (كل دفعة طلب مستقل تحت مهلة Supabase) ← المجموع */
      async import(rows, onProgress) {
        const sum = { created: 0, updated: 0, unchanged: 0, review: 0, linked: 0 };
        const N = 250;
        for (let i = 0; i < rows.length; i += N) {
          const part = rows.slice(i, i + N).map((r) => ({ civil_no: r.civilNo || null, employee_no: r.employeeNo || null, name_ar: r.nameAr || null, name_en: r.nameEn || null, review: r.review || null }));
          const r = await c.rpc('employees_import', { p: part }).catch(empMissing);
          for (const k of Object.keys(sum)) sum[k] += r[k] || 0;
          onProgress?.(Math.min(i + N, rows.length), rows.length);
        }
        return sum;
      },
      async linkUsers() { return c.rpc('link_users_to_employees').catch(empMissing); },
      async purge() { return c.rpc('employees_purge').catch(empMissing); },
      async setUser(employeeId, userId) { await c.rpc('employee_set_user', { p_employee: employeeId, p_user: userId || null }); },
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
      /** رمز المهندس (A08): مدير النظام فقط. الفارغ يمسحه */
      async setEngineerCode(id, code) {
        return c.rpc('set_engineer_code', { p_id: id, p_code: code || null });
      },
      /** بعد الاستيراد: المهندس الذي ليس له رمز يأخذه من رموز مهامه ← عدد من أُعطوا رموزاً */
      async learnEngineerCodes() {
        return c.rpc('learn_engineer_codes');
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
        // رمز كل مهمة (للعرض بجانب رقمها)، والمحذوفة نهائياً تبقى برقمها
        const ids = [...new Set(rows.map((r) => r.task_id))];
        const codes = new Map();
        for (let i = 0; i < ids.length; i += 200) {
          for (const t of await c.select('tasks', { select: 'id,task_code', id: `in.(${ids.slice(i, i + 200).join(',')})` })) codes.set(t.id, t.task_code || '');
        }
        return rows.map((r) => ({
          id: r.id, taskId: r.task_id, taskCode: codes.get(r.task_id) || r.new_data?.task_code || '', action: r.action, changedBy: r.changed_by, changedAt: r.changed_at,
          changedFields: r.changed_fields, oldData: r.old_data, newData: r.new_data,
        }));
      },
    },
  };
}
