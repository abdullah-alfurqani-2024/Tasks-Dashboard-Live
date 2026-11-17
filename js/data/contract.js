/**
 * عقد طبقة البيانات — كل «محوّل» (adapter) يجب أن يعيد كائناً بهذه الدوال وبنفس أشكال البيانات.
 * هذا الملف توثيق فقط، ولا يُستورد في التطبيق.
 *
 * ───────────── أشكال البيانات (camelCase) ─────────────
 *
 * User    { id, loginNo, email, fullName, shortName, role: 'admin'|'head'|'engineer'|'viewer',
 *           isActive, mustChangePassword, engineerCode, employeeId }   engineerCode: رمز المهندس (A08) أو ''؛ employeeId: سجله الوظيفي أو null
 *
 * Task    { id, engineerId, engineerName, engineerShort,
 *           refNo, requester, employeeName, subject,
 *           receivedDate: 'YYYY-MM-DD', completedDate: 'YYYY-MM-DD'|null, notes,
 *           taskTypeId, taskType, correspondenceTypeId, correspondenceType,
 *           statusId, status, statusKind: 'open'|'done'|'cancelled',
 *           delayReason, durationDays: number|null,
 *           createdAt, createdBy, updatedAt, updatedBy, deletedAt, deletedBy, reviewReasons: string[], priority,
 *           taskCode, enteredAt, importedAt }
 *           taskCode: رمز ثابت لا يتكرر (A08-0177 من Sheets، A08-S0001 من النظام)؛ enteredAt: تاريخ الإدخال
 *           (من Sheets للمستوردة، وإلا = createdAt)؛ importedAt: آخر كتابة من الاستيراد أو null
 *
 * TaskInput  الحقول القابلة للكتابة فقط:
 *           { engineerId?, refNo, requester, employeeName, subject, receivedDate, completedDate,
 *             notes, taskTypeId, correspondenceTypeId, statusId, delayReason, priority?, reviewReasons?,
 *             taskCode?, enteredAt?, imported? }   (الثلاثة الأخيرة للاستيراد فقط؛ الرمز يُعطى تلقائياً إن لم يُرسل)
 *
 * LookupItem { id, name, sortOrder, isActive, kind? }   (kind للحالات فقط)
 * Lookups    { taskTypes: LookupItem[], correspondenceTypes: LookupItem[], statuses: LookupItem[] }
 * Settings   { editLockDays: number, delayThresholdDays: number, minPasswordLength: number, forcePasswordChange: boolean }
 * OrgLevel { id, name, levelNo, headTitle, isActive }          levelNo: ترتيب المستوى، الأصغر أعلى في الهيكل
 * OrgUnit  { id, parentId: number|null, levelId, name, shortName, code, aliases: string[], sortOrder, isActive }   code: الرمز الرسمي (اختياري)، sortOrder: ترتيب العرض
 * Employee { id, civilNo, employeeNo, nameAr, nameEn, isActive }   civilNo: الرقم المدني (المعرّف، لا يتكرر)
 * AssignmentType { id, name, isPrimary, impliesHead, sortOrder, isActive }   isPrimary: «أصيل» (واحد فقط)
 * Assignment { id, employeeId, unitId, typeId, isHead, startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD'|null, notes }
 *              endDate فارغ = قائم. القائم اليوم: startDate <= اليوم و(endDate فارغ أو >= اليوم)
 * OrgAuditEntry { id, entity: 'level'|'unit'|'employee'|'assignment'|'assignment_type', entityId, action: 'insert'|'update'|'delete', changedBy, changedAt,
 *                 changedFields: string[]|null, oldData, newData }   (مفاتيح snake_case كما في قاعدة البيانات)
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
 * auth.onExpired(callback)       → void           تُستدعى إذا انتهت الجلسة ولم يمكن تجديدها ('acting' = انتهى الدخول بحساب آخر)
 * auth.actAs(userId)            → User           (التجربة، المدير) التصفح بحساب مستخدم آخر؛ User.actingAs = true
 * auth.stopActing()             → User           العودة لحساب المدير
 *
 * tasks.list(filter)             → Task[]
 *        filter: { engineerId?, from?, to?, statusId?, taskTypeId?, correspondenceTypeId?, deleted?: 'exclude'|'only'|'include' }
 *        from/to على receivedDate، شاملة. الترتيب: الأحدث أولاً
 * tasks.create(TaskInput)        → Task
 * tasks.update(id, TaskInput)    → Task
 * tasks.remove(id)               → void           حذف ناعم (المدير فقط)
 * tasks.restore(id)              → void
 * tasks.bulkCreate(TaskInput[], onProgress(done,total)) → number
 * tasks.bulkUpdate([{ id, ...TaskInput }], onProgress(done,total)) → number   (تحديث الاستيراد)
 *
 * lookups.load()                 → Lookups
 * lookups.save(kind, item)       → LookupItem     kind: 'taskTypes'|'correspondenceTypes'|'statuses'
 *                                                 item بدون id = إضافة
 *
 * users.list()                   → User[]
 * users.create({ loginNo, email?, password, fullName, shortName, role }) → User   (الرقم أو البريد على الأقل)
 * users.update(id, { loginNo?, email?, fullName?, shortName?, role?, isActive? }) → User
 * users.setEngineerCode(id, code) → code|null    (المدير؛ الفارغ يمسح)
 * users.learnEngineerCodes()     → number         (المدير، بعد الاستيراد: من ليس له رمز يأخذه من رموز مهامه)
 * users.resetPassword(id, password) → void
 * users.resetAll({ mode: 'same'|'loginNo', password?, force, includeInactive }) → { reset, skipped: [{ name, reason }] }
 *        كل المستخدمين عدا المنفّذ
 *
 * settings.load()                → Settings
 * settings.save(Settings)        → Settings
 *
 * audit.list({ taskId?, from?, to?, limit? }) → AuditEntry[]   الأحدث أولاً
 *
 * org.load()                     → { levels: OrgLevel[], units: OrgUnit[] }   الهيكل كله (مئات الوحدات، طلب واحد)
 * org.saveLevel(level)           → OrgLevel       بدون id = إضافة (المدير)
 * org.deleteLevel(id)            → void           المستوى غير المستخدم فقط
 * org.saveUnit(unit)             → OrgUnit        بدون id = إضافة؛ تغيير parentId = نقل (مع كل ما تحتها). التفعيل عبر setActive
 * org.setActive(id, active, subtree?) → number    التعطيل يشمل ما تحتها دائماً؛ التفعيل للوحدة وحدها أو مع ما تحتها
 * org.deleteUnit(id)             → void           الوحدة التي ليس تحتها وحدات فقط
 * org.audit({ limit? })          → OrgAuditEntry[]   الأحدث أولاً (المدير)
 *        القواعد (قاعدة البيانات تفرضها): الأم في مستوى أعلى، لا دوران، لا مفعّلة تحت معطّلة، الاسم لا يتكرر بين الأخوات
 *
 * employees.list()               → Employee[]                       (المدير)
 * employees.save(employee)       → Employee         بدون id = إضافة. التفعيل والتعطيل عبر setActive
 * employees.setActive(id, active, date?) → number   التعطيل ينهي إسناداته القائمة في date (اليوم افتراضياً)
 * employees.assignments({ employeeId? }) → Assignment[]   كل الإسنادات (الحالية والسابقة)
 * employees.saveAssignment(a)    → Assignment       بدون id = إضافة
 * employees.deleteAssignment(id) → void             لتصحيح خطأ في الإدخال
 * employees.transfer({ employeeId, unitId, date, isHead }) → number   نقل الأصيل: ينتهي القائم في اليوم السابق
 * employees.types()              → AssignmentType[]
 * employees.saveType(t)          → AssignmentType
 * employees.deleteType(id)       → void             غير المستخدم فقط، و«أصيل» لا يُحذف
 * employees.import(rows, onProgress) → { created, updated, unchanged, linked }
 *        rows: [{ civilNo, employeeNo, nameAr, nameEn }]، إضافة أو تحديث حسب الرقم المدني، والفارغ لا يمسح
 * employees.linkUsers()          → number           ربط المستخدمين بسجلاتهم: رقم الدخول = الرقم المدني أو الوظيفي
 * employees.setUser(employeeId, userId|null) → void
 *        القواعد: أصيل واحد للموظف في أي يوم، رئيس أصيل واحد للوحدة ومن يقوم بأعمالها واحد، لا إسناد قائم في وحدة معطّلة أو لموظف غير نشط
 *
 * maintenance.refreshFromProduction() → { users, tasks, at }   اختياري: نسخة التجربة فقط
 *
 * الأخطاء: كل دالة ترمي Error برسالة عربية جاهزة للعرض (e.message)
 */
export {};
