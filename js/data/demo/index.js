/**
 * محوّل تجريبي: بيانات وهمية داخل المتصفح بدون قاعدة بيانات.
 * يعمل تلقائياً عندما لا تكون إعدادات Supabase مكتوبة في config.js، ويفيد في:
 *   - معاينة النظام على GitHub Pages قبل ربط قاعدة البيانات
 *   - إثبات أن الواجهة مستقلة عن قاعدة البيانات (نفس عقد contract.js)
 * البيانات تُحفظ في متصفحك فقط (localStorage).
 */

import { normalizeSettings } from '../../core/settings.js';
import { latinDigits } from '../../core/format.js';

const KEY = 'tsk.demo.v4';   // v4: رمز المهمة ورمز المهندس
const PASSWORD = 'demo1234';
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const err = (m) => Object.assign(new Error(m), { status: 400 });

const NAMES = [
  ['عبدالله بن سالم بن حمد الفرقاني', 'عبدالله الفرقاني', 'admin'],
  ['خالد بن سعيد بن علي البلوشي', 'خالد البلوشي', 'head'],
  ['أحمد بن محمد بن ناصر الحارثي', 'أحمد الحارثي', 'engineer'],
  ['سارة بنت خالد بن سيف الهنائية', 'سارة الهنائية', 'engineer'],
  ['مازن بن راشد بن عامر الشيدي', 'مازن الشيدي', 'engineer'],
  ['هند بنت يوسف بن سالم الحجرية', 'هند الحجرية', 'engineer'],
  ['معاذ بن حمود بن سعيد الراشدي', 'معاذ الراشدي', 'engineer'],
  ['منى بنت علي بن حمد الكندية', 'منى الكندية', 'viewer'],
];
const EMAILS = ['admin', 'head', 'ahmed', 'sara', 'mazin', 'hind', 'muadh', 'viewer'].map((x) => `${x}@demo.om`);
const REQ = ['دائرة الموارد البشرية', 'دائرة الشؤون المالية', 'مكتب المدير العام', 'دائرة التخطيط', 'دائرة الشؤون القانونية', 'قسم المشتريات', 'قسم الأرشيف', 'دائرة الخدمات المساندة'];
const EMP = ['محمد بن سعيد الكلباني', 'فاطمة بنت حمد العامرية', 'سالم بن ناصر المعمري', 'مريم بنت سيف السعدية', 'يوسف بن علي البوسعيدي', 'عائشة بنت خلفان الغافرية', 'حمد بن مبارك الهاشمي'];
const SUBJ = ['إصلاح طابعة الشبكة', 'تثبيت برنامج الأرشفة', 'إنشاء حساب بريد لموظف جديد', 'مشكلة في الاتصال بالشبكة', 'فورمات جهاز وإعادة تثبيت النظام',
  'تركيب جهاز حاسب جديد', 'تحديث برنامج مكافحة الفيروسات', 'صلاحيات مجلد مشترك', 'عطل في شاشة العرض', 'إعداد طابعة ملونة', 'استعادة ملفات محذوفة', 'ربط جهاز بالنطاق'];

function seed() {
  let s = 20261031;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const users = NAMES.map(([fullName, shortName, role], i) => ({
    id: `u${i + 1}`, email: EMAILS[i], loginNo: String(1000 + i + 1), fullName, shortName, role, isActive: true, mustChangePassword: false,
    engineerCode: role === 'engineer' ? `A${String(i).padStart(2, '0')}` : '',
  }));
  const lookups = {
    taskTypes: ['مراسلة', 'طلب خدمة', 'اتصال', 'طلب مباشر', 'تكليف مباشر', 'أخرى']
      .map((name, i) => ({ id: i + 1, name, sortOrder: i + 1, isActive: true })),
    correspondenceTypes: ['المواصفات الفنية', 'التحليل والتقييم', 'أخرى'].map((name, i) => ({ id: i + 1, name, sortOrder: i + 1, isActive: true })),
    // المعرّفات 1-2 مفتوحة، 3 مكتملة، 4 مغلقة بدون إنجاز (يعتمد عليها توليد البيانات أدناه)
    statuses: [['غير مكتمل', 'open', 2], ['قائمة الانتظار', 'open', 3], ['مكتمل', 'done', 1], ['إعادة تحويل', 'cancelled', 4]]
      .map(([name, kind, sortOrder], i) => ({ id: i + 1, name, kind, sortOrder, isActive: true }))
      .sort((x, y) => x.sortOrder - y.sortOrder),
  };
  const engs = users.filter((u) => u.role === 'engineer' || u.role === 'admin');
  const tasks = [];
  const start = Date.UTC(2026, 0, 1), span = (Date.UTC(2026, 9, 30) - start) / 864e5;
  for (let i = 0; i < 420; i++) {
    const e = pick(engs);
    const rd = new Date(start + Math.floor(rnd() * span) * 864e5).toISOString().slice(0, 10);
    const age = (Date.UTC(2026, 9, 31) - Date.parse(rd)) / 864e5;
    const r = rnd();
    const statusId = age < 10 && r < 0.6 ? (r < 0.4 ? 1 : 2) : r < 0.9 ? 3 : r < 0.95 ? 2 : 4;
    const dur = Math.floor(rnd() < 0.7 ? rnd() * 4 : rnd() * 20);
    const cd = statusId >= 3 ? new Date(Math.min(Date.parse(rd) + dur * 864e5, Date.UTC(2026, 9, 31))).toISOString().slice(0, 10) : null;
    tasks.push({
      id: i + 1, engineerId: e.id, refNo: String(240000 + Math.floor(rnd() * 9999)), requester: pick(REQ), employeeName: pick(EMP),
      subject: pick(SUBJ), receivedDate: rd, completedDate: cd, notes: rnd() < 0.3 ? 'تمت المتابعة مع الموظف' : '',
      taskTypeId: 1 + Math.floor(rnd() * 6), correspondenceTypeId: 1 + Math.floor(rnd() * 3), statusId,
      delayReason: cd && dur > 7 ? 'انتظار توفر قطع الغيار' : '',
      createdAt: rd + 'T09:00:00Z', createdBy: e.id, updatedAt: rd + 'T09:00:00Z', updatedBy: e.id, deletedAt: null, deletedBy: null,
    });
  }
  // رموز المهام كما تأتي من Sheets: رمز المهندس + تسلسل بترتيب تاريخ الاستقبال (المدير بلا رمز مهندس: رمز نظام)
  const seq = {};
  [...tasks].sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.id - b.id).forEach((t) => {
    const ec = users.find((u) => u.id === t.engineerId)?.engineerCode;
    const pre = ec ? `${ec}-` : 'S-';
    seq[pre] = (seq[pre] || 0) + 1;
    t.taskCode = pre + String(seq[pre]).padStart(ec ? 4 : 5, '0');
    t.enteredAt = t.createdAt;
  });
  return { users, lookups, tasks, audit: [], settings: normalizeSettings({ allowPurgeTasks: true }), seq: { task: tasks.length, audit: 0, lookup: 100, user: users.length } };
}

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d?.tasks) return d; } catch { /* */ }
  return seed();
}

export function createAdapter() {
  const db = load();
  let me = null;
  try { const id = sessionStorage.getItem(KEY + '.me'); me = db.users.find((u) => u.id === id && u.isActive) || null; } catch { /* */ }
  let adminId = null;
  try { adminId = sessionStorage.getItem(KEY + '.as'); } catch { /* */ }
  /** نسخة المستخدم للواجهة؛ عند التصفح بحساب آخر لا يُطلب تغيير كلمة المرور */
  const asUser = (u) => (adminId ? { ...u, actingAs: true, mustChangePassword: false } : { ...u });
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* */ } };
  const role = () => me?.role;
  const need = (...roles) => { if (!me) throw err('سجّل الدخول أولاً.'); if (!roles.includes(me.role)) throw err('لا تملك صلاحية لهذه العملية.'); };

  const view = (t) => {
    const u = db.users.find((x) => x.id === t.engineerId) || {};
    const lk = (k, id) => db.lookups[k].find((x) => x.id === id);
    const st = lk('statuses', t.statusId) || {};
    return {
      ...t, reviewReasons: t.reviewReasons || [], priority: t.priority || 'normal', engineerName: u.fullName, engineerShort: u.shortName,
      taskCode: t.taskCode || '', enteredAt: t.enteredAt || t.createdAt, importedAt: t.importedAt || null,
      taskType: lk('taskTypes', t.taskTypeId)?.name || '', correspondenceType: lk('correspondenceTypes', t.correspondenceTypeId)?.name || '',
      status: st.name, statusKind: st.kind,
      durationDays: t.completedDate && t.receivedDate ? Math.round((Date.parse(t.completedDate) - Date.parse(t.receivedDate)) / 864e5) : null,
    };
  };

  const FIELDS = { engineerId: 'engineer_id', refNo: 'ref_no', requester: 'requester', employeeName: 'employee_name', subject: 'subject', receivedDate: 'received_date',
    completedDate: 'completed_date', notes: 'notes', taskTypeId: 'task_type_id', correspondenceTypeId: 'correspondence_type_id', statusId: 'status_id', delayReason: 'delay_reason', deletedAt: 'deleted_at', reviewReasons: 'review_reasons', priority: 'priority', taskCode: 'task_code', enteredAt: 'entered_at' };
  const snake = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => FIELDS[k]).map(([k, v]) => [FIELDS[k], v ?? null]));
  function audit(taskId, action, oldT, newT, extra = null) {
    const a = oldT ? snake(oldT) : null, b = snake(newT);
    const fields = a ? Object.keys(b).filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) : null;
    if (fields && !fields.length) return;
    const pickF = (o) => (fields ? Object.fromEntries(fields.map((k) => [k, o[k] ?? null])) : o);
    db.audit.unshift({ id: ++db.seq.audit, taskId, taskCode: newT.taskCode || '', action, changedBy: me.id, changedAt: new Date().toISOString(), changedFields: fields, oldData: a ? pickF(a) : null, newData: { ...pickF(b), ...extra } });
  }

  function validate(t, flagged = false) {
    if (flagged) return; // مستوردة تنتظر المراجعة: تُحفظ كما في الملف
    const st = db.lookups.statuses.find((s) => s.id === Number(t.statusId));
    if (!t.subject?.trim()) throw err('الموضوع مطلوب.');
    if (!t.receivedDate) throw err('تاريخ الاستقبال مطلوب.');
    if (!st) throw err('الحالة مطلوبة.');
    if (st.kind === 'done' && !t.completedDate) throw err('المهمة المكتملة تحتاج «تاريخ الانتهاء».');
    if (st.kind === 'open') t.completedDate = null;
    if (t.completedDate && t.completedDate < t.receivedDate) throw err('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ الاستقبال.');
  }
  const clean = (t) => ({
    refNo: t.refNo?.trim() || '', requester: t.requester?.trim() || '', employeeName: t.employeeName?.trim() || '', subject: t.subject?.trim(),
    receivedDate: t.receivedDate, completedDate: t.completedDate || null, notes: t.notes?.trim() || '',
    taskTypeId: Number(t.taskTypeId) || null, correspondenceTypeId: Number(t.correspondenceTypeId) || null, statusId: Number(t.statusId), delayReason: t.delayReason?.trim() || '',
    ...(t.priority !== undefined ? { priority: t.priority === 'urgent' ? 'urgent' : 'normal' } : {}),
  });
  /** رمز مهمة تُنشأ في النظام: رمز المهندس + S + تسلسل (A08-S0001)، أو S-00001 لمهندس بلا رمز. لا يُعاد رقم */
  const nextCode = (engineerId) => {
    const ec = db.users.find((u) => u.id === engineerId)?.engineerCode;
    const pre = ec ? `${ec}-S` : 'S-';
    db.seq.codes ||= {};
    const used = db.tasks.filter((t) => t.taskCode?.startsWith(pre)).map((t) => Number(t.taskCode.slice(pre.length)) || 0);
    const n = Math.max(db.seq.codes[pre] || 0, ...used) + 1;
    db.seq.codes[pre] = n;
    return pre + String(n).padStart(ec ? 4 : 5, '0');
  };
  const locked = (t) => {
    const d = db.settings.editLockDays;
    const st = db.lookups.statuses.find((s) => s.id === t.statusId);
    return role() === 'engineer' && d > 0 && st?.kind === 'done' && t.completedDate && Date.parse(t.completedDate) + d * 864e5 < Date.parse(new Date().toISOString().slice(0, 10));
  };

  return {
    name: 'demo',
    demoAccounts: db.users.map((u) => ({ email: u.email, loginNo: u.loginNo, role: u.role })),
    demoPassword: PASSWORD,

    auth: {
      async restore() { await wait(50); return me ? asUser(me) : null; },
      async signIn(login, password) {
        await wait(300);
        const id = latinDigits(login).trim().toLowerCase();
        const u = db.users.find((x) => (id.includes('@') ? x.email === id : x.loginNo === id));
        if (!u || password !== (u.password || PASSWORD)) throw err('الرقم أو كلمة المرور غير صحيحة.');
        if (!u.isActive) throw err('هذا الحساب معطّل. تواصل مع مدير النظام.');
        me = u; adminId = null;
        try { sessionStorage.setItem(KEY + '.me', u.id); sessionStorage.removeItem(KEY + '.as'); } catch { /* */ }
        return asUser(u);
      },
      async signOut() { me = null; adminId = null; try { sessionStorage.removeItem(KEY + '.me'); sessionStorage.removeItem(KEY + '.as'); } catch { /* */ } },
      /** التصفح بحساب مستخدم آخر (مثل نسخة التجربة) */
      async actAs(id) {
        await wait(200);
        need('admin');
        const u = db.users.find((x) => x.id === id);
        if (!u) throw err('المستخدم غير موجود.');
        if (u.id === me.id) throw err('هذا حسابك أنت.');
        if (!u.isActive) throw err('الحساب معطّل في نسخة التجربة. فعّله أولاً.');
        adminId = me.id; me = u;
        try { sessionStorage.setItem(KEY + '.as', adminId); sessionStorage.setItem(KEY + '.me', u.id); } catch { /* */ }
        return asUser(me);
      },
      async stopActing() {
        await wait(100);
        if (adminId) me = db.users.find((x) => x.id === adminId) || null;
        adminId = null;
        try { sessionStorage.removeItem(KEY + '.as'); if (me) sessionStorage.setItem(KEY + '.me', me.id); } catch { /* */ }
        return me ? asUser(me) : null;
      },
      async changePassword(pw) {
        if (adminId) throw err('لا يمكن تغيير كلمة المرور أثناء الدخول بحساب مستخدم آخر.');
        const min = normalizeSettings(db.settings).minPasswordLength;
        if (pw.length < min) throw err(`كلمة المرور ${min} أحرف على الأقل.`);
        me.password = pw; me.mustChangePassword = false; persist();
      },
      onExpired() {},
    },

    tasks: {
      async list(f = {}) {
        await wait();
        if (!me) throw err('سجّل الدخول أولاً.');
        const del = f.deleted || 'exclude';
        return db.tasks.filter((t) => {
          if (role() === 'engineer' && t.engineerId !== me.id) return false;
          if (t.deletedAt && role() !== 'admin') return false;
          if (del === 'exclude' && t.deletedAt) return false;
          if (del === 'only' && !t.deletedAt) return false;
          if (f.engineerId && t.engineerId !== f.engineerId) return false;
          if (f.statusId && t.statusId !== Number(f.statusId)) return false;
          if (f.taskTypeId && t.taskTypeId !== Number(f.taskTypeId)) return false;
          if (f.correspondenceTypeId && t.correspondenceTypeId !== Number(f.correspondenceTypeId)) return false;
          if ((f.from || f.to) && !t.receivedDate) return false;
          if (f.from && t.receivedDate < f.from) return false;
          if (f.to && t.receivedDate > f.to) return false;
          if (f.review && !t.reviewReasons?.length) return false;
          return true;
        }).map(view).sort((a, b) => (b.receivedDate || '9999').localeCompare(a.receivedDate || '9999') || b.id - a.id);
      },
      async create(input) {
        await wait();
        need('admin', 'head', 'engineer');
        const t = clean(input);
        validate(t);
        const now = new Date().toISOString();
        const engineerId = role() === 'engineer' ? me.id : input.engineerId || me.id;
        const row = { id: ++db.seq.task, engineerId, ...t, taskCode: nextCode(engineerId), enteredAt: now, createdAt: now, createdBy: me.id, updatedAt: now, updatedBy: me.id, deletedAt: null, deletedBy: null };
        db.tasks.push(row);
        audit(row.id, 'insert', null, row);
        persist();
        return view(row);
      },
      async update(id, input) {
        await wait();
        const row = db.tasks.find((t) => t.id === id);
        if (!row || row.deletedAt) throw err('المهمة غير موجودة.');
        if (role() === 'engineer' && row.engineerId !== me.id) throw err('لا تملك صلاحية تعديل هذه المهمة.');
        if (role() === 'viewer') throw err('لا تملك صلاحية لهذه العملية.');
        if (locked(row)) throw err(`المهمة مقفلة: مضى على إنجازها أكثر من ${db.settings.editLockDays} يوم. اطلب من مدير النظام أو رئيس القسم تعديلها.`);
        const t = clean(input);
        validate(t, input.reviewReasons !== undefined ? !!input.reviewReasons?.length : !!row.reviewReasons?.length);
        const before = { ...row };
        Object.assign(row, t, { updatedAt: new Date().toISOString(), updatedBy: me.id });
        if (input.engineerId && role() !== 'engineer') row.engineerId = input.engineerId;
        // أسباب المراجعة: يضعها الاستيراد فقط، والمسح = «تمت المراجعة»
        if (input.reviewReasons !== undefined) {
          const next = input.reviewReasons?.length ? input.reviewReasons : null;
          if (next && role() !== 'admin' && JSON.stringify(next) !== JSON.stringify(before.reviewReasons || null)) throw err('أسباب المراجعة يضعها الاستيراد فقط.');
          row.reviewReasons = next;
        }
        audit(id, 'update', before, row);
        persist();
        return view(row);
      },
      async reviewCount() {
        await wait(20);
        if (!me) return 0;
        return db.tasks.filter((t) => t.reviewReasons?.length && !t.deletedAt && (role() !== 'engineer' || t.engineerId === me.id)).length;
      },
      async remove(id) {
        need('admin');
        const row = db.tasks.find((t) => t.id === id);
        const before = { ...row };
        row.deletedAt = new Date().toISOString(); row.deletedBy = me.id;
        audit(id, 'delete', before, row); persist();
      },
      async restore(id) {
        need('admin');
        const row = db.tasks.find((t) => t.id === id);
        const before = { ...row };
        row.deletedAt = null; row.deletedBy = null;
        audit(id, 'restore', before, row); persist();
      },
      /** تحديث الاستيراد: [{ id, ...TaskInput }] */
      async bulkUpdate(list, onProgress) {
        need('admin');
        let n = 0;
        for (const { id, ...input } of list) {
          const row = db.tasks.find((t) => t.id === id);
          if (!row || row.deletedAt) throw err(`تعذّر تحديث المهمة ${input.taskCode || `#${id}`}: لا صلاحية أو أنها حُذفت.`);
          const t = clean(input);
          validate(t, !!input.reviewReasons?.length);
          const before = { ...row }, now = new Date().toISOString();
          Object.assign(row, t, { engineerId: input.engineerId || row.engineerId, reviewReasons: input.reviewReasons?.length ? input.reviewReasons : null,
            enteredAt: input.enteredAt && Date.parse(input.enteredAt) !== Date.parse(row.enteredAt || '') ? input.enteredAt : row.enteredAt, importedAt: input.imported ? now : row.importedAt, updatedAt: now, updatedBy: me.id,
            importedData: input.importedData !== undefined ? input.importedData : row.importedData ?? null });
          audit(id, 'update', before, row, input.imported ? { via_import: true } : null);
          if (++n % 100 === 0) { onProgress?.(n, list.length); await wait(10); }
        }
        onProgress?.(n, list.length);
        persist();
        return n;
      },
      async importBase() {
        need('admin');
        return new Map(db.tasks.filter((t) => t.importedData).map((t) => [t.id, t.importedData]));
      },
      async saveImportBase(list) {
        need('admin');
        let n = 0;
        for (const { id, data } of list) {
          const row = db.tasks.find((t) => t.id === id);
          if (row && JSON.stringify(row.importedData ?? null) !== JSON.stringify(data)) { row.importedData = data; n++; }
        }
        persist();
        return n;
      },
      async bulkCreate(list, onProgress) {
        need('admin', 'head');
        let n = 0;
        for (const input of list) {
          const t = clean(input);
          validate(t, !!input.reviewReasons?.length);
          const now = new Date().toISOString();
          const code = input.taskCode?.trim().toUpperCase() || nextCode(input.engineerId);
          if (db.tasks.some((x) => x.taskCode === code)) throw err(`رمز المهمة ${code} موجود مسبقاً.`);
          db.tasks.push({ id: ++db.seq.task, engineerId: input.engineerId, ...t, reviewReasons: input.reviewReasons?.length ? input.reviewReasons : null, taskCode: code, enteredAt: input.enteredAt || now, importedAt: input.imported ? now : null, importedData: input.importedData ?? null, createdAt: now, createdBy: input.createdBy || me.id, updatedAt: now, updatedBy: input.createdBy || me.id, deletedAt: null, deletedBy: null });
          if (++n % 100 === 0) { onProgress?.(n, list.length); await wait(10); }
        }
        onProgress?.(n, list.length);
        persist();
        return n;
      },
    },

    lookups: {
      async load() { await wait(40); return JSON.parse(JSON.stringify(db.lookups)); },
      async save(kind, item) {
        need('admin', 'head');
        const list = db.lookups[kind];
        const name = item.name.trim();
        if (!name) throw err('الاسم مطلوب.');
        if (list.some((x) => x.name === name && x.id !== item.id)) throw err('هذه القيمة موجودة مسبقاً.');
        let row = list.find((x) => x.id === item.id);
        if (!row) { row = { id: ++db.seq.lookup }; list.push(row); }
        Object.assign(row, { name, sortOrder: Number(item.sortOrder) || 0, isActive: item.isActive !== false });
        if (kind === 'statuses') row.kind = item.kind || 'open';
        list.sort((a, b) => a.sortOrder - b.sortOrder);
        persist();
        return { ...row };
      },
    },

    users: {
      async list() { await wait(40); return db.users.map(({ password, ...u }) => ({ ...u })); },
      async create(u) {
        need('admin');
        const email = (u.email || '').trim().toLowerCase();
        const loginNo = (u.loginNo || '').trim();
        if (!loginNo) throw err('الرقم المدني أو الوظيفي مطلوب.');
        if (email && db.users.some((x) => x.email === email)) throw err('هذا البريد مسجّل مسبقاً.');
        if (loginNo && db.users.some((x) => x.loginNo === loginNo)) throw err('هذا الرقم مسجّل لمستخدم آخر.');
        const st = normalizeSettings(db.settings);
        if (!u.password) u = { ...u, password: loginNo };
        if ((u.password || '').length < st.minPasswordLength) throw err(`كلمة المرور ${st.minPasswordLength} أحرف على الأقل.`);
        const row = { id: `u${++db.seq.user}`, email, loginNo, fullName: u.fullName.trim(), shortName: u.shortName?.trim() || '', role: u.role, isActive: true, mustChangePassword: st.forcePasswordChange, password: u.password };
        db.users.push(row); persist();
        const { password, ...out } = row; return out;
      },
      async update(id, u) {
        need('admin');
        const row = db.users.find((x) => x.id === id);
        if (id === me.id && ((u.role && u.role !== 'admin') || u.isActive === false)) throw err('لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.');
        if (!(u.loginNo !== undefined ? (u.loginNo || '').trim() : row.loginNo)) throw err('الرقم المدني أو الوظيفي مطلوب. أضف رقم هذا المستخدم أولاً.');
        if (u.email !== undefined) {
          const email = u.email.trim().toLowerCase();
          if (email && db.users.some((x) => x.email === email && x.id !== id)) throw err('هذا البريد مسجّل مسبقاً.');
          row.email = email;
        }
        if (u.loginNo !== undefined) {
          const no = (u.loginNo || '').trim();
          if (no && db.users.some((x) => x.loginNo === no && x.id !== id)) throw err('هذا الرقم مسجّل لمستخدم آخر.');
          row.loginNo = no;
        }
        for (const k of ['fullName', 'shortName', 'role', 'isActive']) if (u[k] !== undefined) row[k] = u[k];
        persist();
        const { password, ...out } = row; return out;
      },
      async setEngineerCode(id, code) {
        need('admin');
        const c = (code || '').trim().toUpperCase();
        if (c && !/^[A-Z]+[0-9]+$/.test(c)) throw err('رمز المهندس حروف إنجليزية ثم أرقام، مثل A08.');
        if (c && db.users.some((u) => u.engineerCode === c && u.id !== id)) throw err(`رمز المهندس ${c} مستخدم لحساب آخر.`);
        db.users.find((u) => u.id === id).engineerCode = c;
        persist();
        return c || null;
      },
      async learnEngineerCodes() {
        need('admin');
        let n = 0;
        for (const u of db.users.filter((x) => !x.engineerCode)) {
          const pre = [...new Set(db.tasks.filter((t) => t.engineerId === u.id && /^[A-Z]+[0-9]+-[0-9]+$/.test(t.taskCode || '')).map((t) => t.taskCode.split('-')[0]))];
          if (pre.length === 1 && !db.users.some((x) => x.engineerCode === pre[0])) { u.engineerCode = pre[0]; n++; }
        }
        persist();
        return n;
      },
      async resetAll(o) {
        need('admin');
        const st = normalizeSettings(db.settings);
        if (o.mode !== 'loginNo' && (o.password || '').length < st.minPasswordLength) throw err(`كلمة المرور ${st.minPasswordLength} أحرف على الأقل.`);
        let reset = 0; const skipped = [];
        for (const u of db.users) {
          if (u.id === me.id) continue;
          if (st.syncUserId && u.id === st.syncUserId) { skipped.push({ name: u.fullName, reason: 'حساب مزامنة التجربة (يُستثنى دائماً)' }); continue; }
          if (!u.isActive && !o.includeInactive) { skipped.push({ name: u.fullName, reason: 'حساب معطّل' }); continue; }
          const pw = o.mode === 'loginNo' ? u.loginNo : o.password;
          if (!pw) { skipped.push({ name: u.fullName, reason: 'ليس له رقم' }); continue; }
          if (pw.length < st.minPasswordLength) { skipped.push({ name: u.fullName, reason: `رقمه أقصر من ${st.minPasswordLength} خانات` }); continue; }
          u.password = pw; u.mustChangePassword = o.force !== false; reset++;
        }
        persist();
        return { reset, skipped };
      },
      async resetPassword(id, pw) {
        need('admin');
        const st = normalizeSettings(db.settings);
        if (pw.length < st.minPasswordLength) throw err(`كلمة المرور ${st.minPasswordLength} أحرف على الأقل.`);
        const row = db.users.find((x) => x.id === id);
        row.password = pw; row.mustChangePassword = st.syncUserId === id ? false : st.forcePasswordChange; persist();
        return { ok: true, sync: st.syncUserId === id };
      },
    },

    settings: {
      async load() { return normalizeSettings(db.settings); },
      async save(s) {
        need('admin');
        db.settings = normalizeSettings(s);
        persist(); return { ...db.settings };
      },
    },

    audit: {
      async list(f = {}) {
        need('admin', 'head');
        return db.audit.filter((a) => (!f.taskId || a.taskId === Number(f.taskId))
          && (!f.from || a.changedAt.slice(0, 10) >= f.from) && (!f.to || a.changedAt.slice(0, 10) <= f.to)).slice(0, f.limit || 500);
      },
    },

    /** إعادة البيانات التجريبية لحالتها الأولى */
    maintenance: {
      async purgeAllTasks() {
        await wait(200);
        need('admin');
        if (!normalizeSettings(db.settings).allowPurgeTasks) throw err('حذف كل المهام موقوف. فعّل «السماح بحذف كل المهام» من الإعدادات أولاً.');
        const n = db.tasks.length;
        db.tasks = []; db.audit = []; db.seq.task = 0; db.seq.audit = 0; persist();
        return { tasks: n, at: new Date().toISOString() };
      },
    },

    resetDemo() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY + '.me'); sessionStorage.removeItem(KEY + '.as'); } catch { /* */ } location.reload(); },
  };
}
