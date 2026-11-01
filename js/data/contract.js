/**
 * عقد طبقة البيانات — كل «محوّل» (adapter) يجب أن يعيد كائناً بهذه الدوال وبنفس أشكال البيانات.
 * هذا الملف توثيق فقط، ولا يُستورد في التطبيق.
 *
 * ───────────── أشكال البيانات (camelCase) ─────────────
 *
 * User    { id, loginNo, email, fullName, shortName, role: 'admin'|'head'|'engineer'|'viewer',
 *           isActive, mustChangePassword }
 *
 * Task    { id, engineerId, engineerName, engineerShort,
 *           refNo, requester, employeeName, subject,
 *           receivedDate: 'YYYY-MM-DD', completedDate: 'YYYY-MM-DD'|null, notes,
 *           taskTypeId, taskType, correspondenceTypeId, correspondenceType,
 *           statusId, status, statusKind: 'open'|'done'|'cancelled',
 *           delayReason, durationDays: number|null,
 *           createdAt, createdBy, updatedAt, updatedBy, deletedAt, deletedBy }
 *
 * TaskInput  الحقول القابلة للكتابة فقط:
 *           { engineerId?, refNo, requester, employeeName, subject, receivedDate, completedDate,
 *             notes, taskTypeId, correspondenceTypeId, statusId, delayReason }
 *
 * LookupItem { id, name, sortOrder, isActive, kind? }   (kind للحالات فقط)
 * Lookups    { taskTypes: LookupItem[], correspondenceTypes: LookupItem[], statuses: LookupItem[] }
 * Settings   { editLockDays: number, delayThresholdDays: number, minPasswordLength: number, forcePasswordChange: boolean }
 * AuditEntry { id, taskId, action: 'insert'|'update'|'delete'|'restore', changedBy, changedAt,
 *              changedFields: string[]|null, oldData: object|null, newData: object|null }
 *              (مفاتيح oldData/newData بأسماء أعمدة قاعدة البيانات snake_case)
 *
 * ───────────── الدوال ─────────────
 *
 * auth.restore()                 → User|null      استعادة الجلسة المحفوظة عند فتح الصفحة
 * auth.signIn(login, password)   → User           login: الرقم المدني/الوظيفي أو البريد
 * auth.signOut()                 → void
 * auth.changePassword(newPw)     → void           ويجعل mustChangePassword = false
 * auth.onExpired(callback)       → void           تُستدعى إذا انتهت الجلسة ولم يمكن تجديدها
 *
 * tasks.list(filter)             → Task[]
 *        filter: { engineerId?, from?, to?, statusId?, taskTypeId?, correspondenceTypeId?, deleted?: 'exclude'|'only'|'include' }
 *        from/to على receivedDate، شاملة. الترتيب: الأحدث أولاً
 * tasks.create(TaskInput)        → Task
 * tasks.update(id, TaskInput)    → Task
 * tasks.remove(id)               → void           حذف ناعم (المدير فقط)
 * tasks.restore(id)              → void
 * tasks.bulkCreate(TaskInput[], onProgress(done,total)) → number
 *
 * lookups.load()                 → Lookups
 * lookups.save(kind, item)       → LookupItem     kind: 'taskTypes'|'correspondenceTypes'|'statuses'
 *                                                 item بدون id = إضافة
 *
 * users.list()                   → User[]
 * users.create({ loginNo, email?, password, fullName, shortName, role }) → User   (الرقم أو البريد على الأقل)
 * users.update(id, { loginNo?, email?, fullName?, shortName?, role?, isActive? }) → User
 * users.resetPassword(id, password) → void
 * users.resetAll({ mode: 'same'|'loginNo', password?, force, includeInactive }) → { reset, skipped: [{ name, reason }] }
 *        كل المستخدمين عدا المنفّذ
 *
 * settings.load()                → Settings
 * settings.save(Settings)        → Settings
 *
 * audit.list({ taskId?, from?, to?, limit? }) → AuditEntry[]   الأحدث أولاً
 *
 * maintenance.refreshFromProduction() → { users, tasks, at }   اختياري: نسخة التجربة فقط
 *
 * الأخطاء: كل دالة ترمي Error برسالة عربية جاهزة للعرض (e.message)
 */
export {};
