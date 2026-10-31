"""اختبار ملفات SQL والصلاحيات على PostgreSQL محلي مع محاكاة Supabase.
التشغيل: python3 run_tests.py  (يتطلب خادماً على المنفذ 5544 — انظر README)"""
import subprocess, sys, uuid

PSQL = ['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', 't', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
U = {k: str(uuid.uuid4()) for k in ('admin', 'head', 'eng1', 'eng2', 'viewer', 'off')}
passed = failed = 0


def sql(q, who=None):
    pre = ''
    if who:
        pre = f"set role authenticated; set request.jwt.claim.sub = '{U[who]}';\n"
    r = subprocess.run(PSQL, input=pre + q, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())


def check(name, ok_expected, q, who=None, contains=None):
    global passed, failed
    ok, out = sql(q, who)
    good = ok == ok_expected and (contains is None or contains in out)
    passed += good
    failed += not good
    print(('✅' if good else '❌'), name, '' if good else f'\n    → ok={ok} out={out[:300]}')
    return out


# ---------- إعداد المستخدمين ----------
roles = {'admin': 'admin', 'head': 'head', 'eng1': 'engineer', 'eng2': 'engineer', 'viewer': 'viewer', 'off': 'engineer'}
setup = ''.join(
    f"insert into auth.users (id, email) values ('{U[k]}', '{k}@x.om');"
    f"insert into public.profiles (id, email, full_name, role, is_active) values ('{U[k]}', '{k}@x.om', 'اسم {k}', '{r}', {'false' if k == 'off' else 'true'});"
    for k, r in roles.items())
ok, out = sql("truncate public.task_audit, public.tasks restart identity cascade; delete from public.profiles; delete from auth.users; delete from public.task_types where name = 'كاميرات'; update public.app_settings set value = '0' where key = 'edit_lock_days';" + setup)
assert ok, out

ST = "(select id from public.task_statuses where name = '%s')"
OPEN, DONE = ST % 'قيد التنفيذ', ST % 'مكتمل'

# ---------- المهام ----------
check('مهندس يضيف مهمة لنفسه', True,
      f"insert into tasks (subject, received_date, status_id) values ('طابعة', '2026-10-01', {OPEN}) returning engineer_id", 'eng1', U['eng1'])
check('مهندس يحاول الإضافة باسم غيره ← تُسجَّل باسمه هو', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id) values ('{U['eng2']}', 'شبكة', '2026-10-02', {OPEN}) returning engineer_id", 'eng1', U['eng1'])
check('مهندس 2 يضيف مهمة', True,
      f"insert into tasks (subject, received_date, status_id) values ('بريد', '2026-10-03', {OPEN})", 'eng2')
check('المشاهد لا يضيف', False,
      f"insert into tasks (subject, received_date, status_id) values ('x', '2026-10-03', {OPEN})", 'viewer')
check('حساب معطّل لا يضيف', False,
      f"insert into tasks (subject, received_date, status_id) values ('x', '2026-10-03', {OPEN})", 'off')
check('رئيس القسم يضيف لمهندس', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id) values ('{U['eng2']}', 'من الرئيس', '2026-10-04', {OPEN}) returning engineer_id", 'head', U['eng2'])

check('مهندس 1 يرى مهامه فقط (2)', True, "select count(*) from v_tasks", 'eng1', '2')
check('مهندس 2 يرى مهامه فقط (2)', True, "select count(*) from v_tasks", 'eng2', '2')
check('المشاهد يرى الكل (4)', True, "select count(*) from v_tasks", 'viewer', '4')
check('رئيس القسم يرى الكل (4)', True, "select count(*) from v_tasks", 'head', '4')
check('الحساب المعطّل لا يرى شيئاً', True, "select count(*) from v_tasks", 'off', '0')
check('anon لا يقرأ', False, "set role anon; select count(*) from tasks")

check('مكتملة بلا تاريخ انتهاء ← مرفوضة', False,
      f"update tasks set status_id = {DONE} where id = 1", 'eng1', 'تاريخ الانتهاء')
check('تاريخ انتهاء قبل الاستقبال ← مرفوض', False,
      f"update tasks set status_id = {DONE}, completed_date = '2026-09-01' where id = 1", 'eng1')
check('إكمال المهمة', True,
      f"update tasks set status_id = {DONE}, completed_date = '2026-10-05' where id = 1 returning duration_days", 'eng1', '4')
check('مهندس لا يعدّل مهمة غيره (0 صفوف)', True, "update tasks set subject = 'x' where id = 3 returning id", 'eng1', '')
check('مهندس لا ينقل مهمته لغيره', False, f"update tasks set engineer_id = '{U['eng2']}' where id = 1", 'eng1')
check('مهندس لا يحذف (حذف ناعم مباشر)', False, "update tasks set deleted_at = now() where id = 1", 'eng1')
check('مهندس لا يستدعي دالة الحذف', False, "select soft_delete_task(1)", 'eng1', 'الحذف')
check('الحذف الفعلي ممنوع حتى للمدير', False, "delete from tasks where id = 1", 'admin', 'permission denied')
check('رئيس القسم يعدّل مهمة مهندس', True, "update tasks set notes = 'ملاحظة الرئيس' where id = 3 returning id", 'head', '3')
check('رئيس القسم لا يحذف', False, "select soft_delete_task(3)", 'head')

# ---------- قفل التعديل ----------
check('مستخدم غير المدير لا يغيّر الإعدادات', True,
      "update app_settings set value = '3' where key = 'edit_lock_days' returning key", 'head', '')
check('المدير يضبط القفل 3 أيام', True,
      "update app_settings set value = '3' where key = 'edit_lock_days' returning key", 'admin', 'edit_lock_days')
check('مهمة أُنجزت قبل أكثر من 3 أيام مقفلة على المهندس', False,
      "update tasks set notes = 'تعديل' where id = 1", 'eng1', 'مقفلة')
check('المدير يعدّل المقفلة', True, "update tasks set notes = 'تعديل المدير' where id = 1 returning id", 'admin', '1')
sql("update app_settings set value = '0' where key = 'edit_lock_days'")
check('بدون قفل يعود التعديل', True, "update tasks set notes = 'بعد إلغاء القفل' where id = 1 returning id", 'eng1', '1')

# ---------- الحذف الناعم ----------
check('المدير يحذف حذفاً ناعماً', True, "select soft_delete_task(2)", 'admin')
check('المهندس لا يرى المحذوفة', True, "select count(*) from v_tasks", 'eng1', '1')
check('المشاهد لا يرى المحذوفة', True, "select count(*) from v_tasks", 'viewer', '3')
check('المدير يرى المحذوفة', True, "select count(*) from v_tasks where deleted_at is not null", 'admin', '1')
check('المدير يسترجع', True, "select restore_task(2); select count(*) from v_tasks where deleted_at is null", 'admin', '4')

# ---------- سجل التعديلات ----------
check('السجل: إضافة/تعديل/حذف/استرجاع', True,
      "select string_agg(distinct action, ',' order by action) from task_audit", 'admin', 'delete,insert,restore,update')
check('السجل يحفظ الحقول المتغيرة', True,
      "select changed_fields::text from task_audit where task_id = 1 and action = 'update' order by id limit 1", 'admin', 'completed_date')
check('المهندس لا يرى السجل', True, "select count(*) from task_audit", 'eng1', '0')
check('رئيس القسم يرى السجل', True, "select count(*) > 0 from task_audit", 'head', 't')

# ---------- القوائم والمستخدمون ----------
check('رئيس القسم يضيف نوع مهمة', True, "insert into task_types (name) values ('كاميرات') returning name", 'head', 'كاميرات')
check('المهندس لا يضيف نوع مهمة', False, "insert into task_types (name) values ('x')", 'eng1')
check('المهندس يقرأ القوائم', True, "select count(*) > 0 from task_statuses", 'eng1', 't')
check('المهندس يرى ملفه فقط', True, "select count(*) from profiles", 'eng1', '1')
check('المشاهد يرى أسماء المستخدمين', True, "select count(*) from profiles", 'viewer', '6')
check('المهندس لا يغيّر دوره', True, "update profiles set role = 'admin' where id = auth.uid() returning id", 'eng1', '')
check('المدير لا يعطّل نفسه', False, "update profiles set is_active = false where id = auth.uid()", 'admin', 'بنفسك')
check('المدير يغيّر دور مستخدم', True, f"update profiles set role = 'head' where id = '{U['eng2']}' returning role", 'admin', 'head')
check('المستخدم يؤكد تغيير كلمة المرور', True,
      "select mark_password_changed(); select must_change_password from profiles where id = auth.uid()", 'eng1', 'f')

print(f'\n{passed} ناجح، {failed} فاشل')
sys.exit(1 if failed else 0)
