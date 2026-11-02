"""اختبار ملفات SQL والصلاحيات على PostgreSQL محلي مع محاكاة Supabase.
التشغيل: python3 run_tests.py  (يتطلب خادماً على المنفذ 5544 — انظر README)"""
import json, os, subprocess, sys, uuid

PSQL = ['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', os.environ.get('TEST_DB', 't'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
U = {k: str(uuid.uuid4()) for k in ('admin', 'head', 'eng1', 'eng2', 'viewer', 'off')}
passed = failed = 0


def sql(q, who=None):
    pre = "set search_path = support_tasks, public;\n"
    if who:
        pre += f"set role authenticated; set request.jwt.claim.sub = '{U[who]}';\n"
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
    f"insert into support_tasks.profiles (id, email, full_name, role, is_active) values ('{U[k]}', '{k}@x.om', 'اسم {k}', '{r}', {'false' if k == 'off' else 'true'});"
    for k, r in roles.items())
ok, out = sql("drop schema if exists support_tasks_staging cascade; truncate support_tasks.task_audit, support_tasks.tasks restart identity cascade; update support_tasks.app_settings set updated_by = null; delete from support_tasks.profiles; delete from auth.users; delete from support_tasks.task_types where name = 'كاميرات'; update support_tasks.app_settings set value = '0' where key = 'edit_lock_days';" + setup)
assert ok, out

ST = "(select id from support_tasks.task_statuses where name = '%s')"
OPEN, DONE = ST % 'غير مكتمل', ST % 'مكتمل'

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

# ---------- الرقم المدني/الوظيفي (07_login_no.sql) ----------
# الرقم يُكتب عبر دالة admin-users (مفتاح الخادم)، فالاختبار هنا للقيود نفسها
check('إضافة رقم لمستخدم (من الخادم)', True,
      f"update profiles set login_no = '0012345' where id = '{U['eng1']}' returning login_no", None, '0012345')
check('الرقم لا يتكرر', False,
      f"update profiles set login_no = '0012345' where id = '{U['eng2']}'", None, None)
check('الرقم أرقام فقط', False,
      f"update profiles set login_no = '12a45' where id = '{U['eng2']}'", None, None)
check('الرقم حتى 20 خانة', False,
      f"update profiles set login_no = '123456789012345678901' where id = '{U['eng2']}'", None, None)
check('المستخدم لا يغيّر الرقم من الواجهة مباشرة', False,
      f"update profiles set login_no = '999' where id = '{U['eng1']}'", 'eng1', None)
check('المدير لا يغيّر الرقم إلا عبر الدالة', False,
      f"update profiles set login_no = '999' where id = '{U['eng2']}'", 'admin', None)

# ---------- حذف كل المهام في الإنتاج (09_purge_tasks.sql) ----------
sql("insert into app_settings (key, value) values ('allow_purge_tasks', 'true') on conflict (key) do update set value = 'true'")
n_before = sql('select count(*) from support_tasks.tasks')[1]
check('حذف الكل (إنتاج): المهندس مرفوض', False, 'select purge_all_tasks()', 'eng1', 'لمدير النظام')
check('حذف الكل (إنتاج): رئيس القسم مرفوض', False, 'select purge_all_tasks()', 'head', 'لمدير النظام')
check('المدير يوقف الإعداد', True, "update app_settings set value = 'false' where key = 'allow_purge_tasks' returning key", 'admin', 'allow_purge_tasks')
check('حذف الكل (إنتاج): موقوف بالإعداد', False, 'select purge_all_tasks()', 'admin', 'موقوف')
check('حذف الكل (إنتاج): لم يُحذف شيء', True, 'select count(*) from support_tasks.tasks', None, n_before)
check('المدير يفعّل الإعداد', True, "update app_settings set value = 'true' where key = 'allow_purge_tasks' returning key", 'admin', 'allow_purge_tasks')
check('حذف الكل (إنتاج): مسموح للمدير', True, "select purge_all_tasks()->>'tasks'", 'admin', n_before)
check('حذف الكل (إنتاج): الجداول فارغة', True,
      'select (select count(*) from support_tasks.tasks) + (select count(*) from support_tasks.task_audit)', None, '0')
check('بعد الحذف: إضافة مهمة في الإنتاج تبدأ من 1', True,
      f"insert into tasks (subject, received_date, status_id) values ('بعد الحذف', '2026-11-02', {OPEN}) returning id", 'eng1', '1')
check('بعد الحذف: السجل يعمل', True, 'select count(*) from support_tasks.task_audit', None, '1')
sql(f"insert into tasks (engineer_id, subject, received_date, status_id) values ('{U['eng2']}', 'ثانية', '2026-11-02', {OPEN})")

# ---------- مهام تحتاج مراجعة (10_review.sql) ----------
rid = check('المدير (الاستيراد) يضيف مهمة مع أسباب المراجعة', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, review_reasons) values ('{U['eng1']}', 'مراجعة', '2026-11-01', {OPEN}, array['تاريخ الاستقبال غير مفهوم «x»']) returning id", 'admin')
check('العرض يحتوي أسباب المراجعة', True, f"select review_reasons[1] from v_tasks where id = {rid}", 'eng1', 'غير مفهوم')
check('المهندس لا يضيف أسباب مراجعة', False,
      f"insert into tasks (subject, received_date, status_id, review_reasons) values ('x', '2026-11-01', {OPEN}, array['y'])", 'eng1', 'الاستيراد')
check('المهندس لا يغيّر الأسباب', False, f"update tasks set review_reasons = array['أخرى'] where id = {rid}", 'eng1', 'الاستيراد')
check('المهندس يعدّل مهمته والأسباب باقية', True, f"update tasks set notes = 'أصلحتها' where id = {rid} returning array_length(review_reasons, 1)", 'eng1', '1')
check('المهندس يضغط «تمت المراجعة»', True, f"update tasks set review_reasons = null where id = {rid} returning coalesce(array_length(review_reasons, 1), 0)", 'eng1', '0')
check('المصفوفة الفارغة تُحفظ null', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, review_reasons) values ('{U['eng1']}', 'فارغة', '2026-11-01', {OPEN}, '{{}}') returning review_reasons is null", 'admin', 't')
check('سجل التعديلات يسجّل المراجعة', True,
      f"select count(*) > 0 from task_audit where task_id = {rid} and 'review_reasons' = any(changed_fields)", None, 't')

# ---------- الاستيراد كما في الملف (11_import_as_is.sql) ----------
raw = check('مستوردة كما هي: بلا تاريخ استقبال، مكتملة بلا انتهاء، موضوع فارغ', True,
      f"insert into tasks (engineer_id, subject, received_date, completed_date, status_id, review_reasons) values ('{U['eng1']}', '', null, null, {DONE}, array['تاريخ الاستقبال فارغ']) returning id", 'admin')
check('مستوردة كما هي: الانتهاء قبل الاستقبال', True,
      f"insert into tasks (engineer_id, subject, received_date, completed_date, status_id, review_reasons) values ('{U['eng1']}', 'س', '2026-02-03', '2026-02-01', {DONE}, array['الانتهاء قبل الاستقبال']) returning id", 'admin')
check('مستوردة كما هي: غير مكتملة ويبقى تاريخ انتهائها', True,
      f"insert into tasks (engineer_id, subject, received_date, completed_date, status_id, review_reasons) values ('{U['eng1']}', 'س', '2026-02-03', '2026-02-05', {OPEN}, array['غير مكتملة ولها تاريخ انتهاء']) returning completed_date", 'admin', '2026-02-05')
check('بلا مراجعة: تاريخ الاستقبال مطلوب', False,
      f"insert into tasks (subject, received_date, status_id) values ('x', null, {OPEN})", 'eng1', 'تاريخ الاستقبال')
check('تمت المراجعة وهي ناقصة: مرفوض', False, f"update tasks set review_reasons = null where id = {raw}", 'eng1', None)
check('المهندس يصلحها ثم «تمت المراجعة»', True,
      f"update tasks set subject = 'مصلحة', received_date = '2026-03-01', completed_date = '2026-03-02', review_reasons = null where id = {raw} returning subject", 'eng1', 'مصلحة')

# ---------- المهمة المستوردة باسم مهندسها (12_import_owner.sql) ----------
imp = check('الاستيراد: المهمة تُسجَّل باسم المهندس', True,
      f"insert into tasks (engineer_id, created_by, subject, received_date, status_id) values ('{U['eng2']}', '{U['eng2']}', 'مستوردة', '2026-04-01', {OPEN}) returning id", 'admin')
check('الاستيراد: أُدخلت بواسطة المهندس', True, f"select created_by = '{U['eng2']}' and updated_by = '{U['eng2']}' from tasks where id = {imp}", None, 't')
check('الاستيراد: سطر الإضافة في السجل باسم المهندس', True,
      f"select changed_by = '{U['eng2']}' from task_audit where task_id = {imp} and action = 'insert'", None, 't')
check('الاستيراد: من أدخلها فعلاً محفوظ في السجل', True,
      f"select new_data->>'entered_by' = '{U['admin']}' from task_audit where task_id = {imp} and action = 'insert'", None, 't')
check('المهندس لا يُدخل باسم غيره', True,
      f"insert into tasks (created_by, subject, received_date, status_id) values ('{U['eng2']}', 'محاولة', '2026-04-01', {OPEN}) returning created_by = '{U['eng1']}'", 'eng1', 't')
check('رئيس القسم لا يُدخل باسم غيره', True,
      f"insert into tasks (engineer_id, created_by, subject, received_date, status_id) values ('{U['eng2']}', '{U['eng2']}', 'من الرئيس', '2026-04-01', {OPEN}) returning created_by = '{U['head']}'", 'head', 't')
check('الإدخال العادي من المدير باسمه', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id) values ('{U['eng2']}', 'عادية', '2026-04-01', {OPEN}) returning created_by = '{U['admin']}'", 'admin', 't')

# ---------- نسخة التجربة: الإعداد والنسخ وحذف كل المهام ----------
setup_stg = open(os.path.join(os.path.dirname(__file__), '..', 'staging', 'setup_staging.sql'), encoding='utf-8').read()
ok, out = sql(setup_stg)
passed += ok; failed += not ok
print('✅' if ok else '❌', 'تنفيذ setup_staging.sql', '' if ok else out[:300])
sql(open(os.path.join(os.path.dirname(__file__), '..', 'staging', 'link_production.sql'), encoding='utf-8').read())
prod_n = sql('select count(*) from support_tasks.tasks where deleted_at is null')[1]
# نسخة الإنتاج كما تبنيها دالة refresh-staging (هنا من سكيما الإنتاج في نفس القاعدة لغرض الاختبار)
def snapshot(keep='[]', admin_role="role", force='false'):
    return f"""support_tasks_staging.apply_production_snapshot(jsonb_build_object(
      'keep', '{keep}'::jsonb, 'force', {force},
      'users', (select jsonb_agg(jsonb_build_object('id', id, 'source_id', id, 'email', email, 'login_no', login_no, 'full_name', full_name,
                 'short_name', short_name, 'role', case when role = 'admin' then {admin_role}::text else role::text end, 'is_active', is_active)) from support_tasks.profiles),
      'lookups', jsonb_build_object(
         'task_types', (select jsonb_agg(to_jsonb(x)) from support_tasks.task_types x),
         'correspondence_types', (select jsonb_agg(to_jsonb(x)) from support_tasks.correspondence_types x),
         'task_statuses', (select jsonb_agg(to_jsonb(x)) from support_tasks.task_statuses x)),
      'settings', (select jsonb_agg(jsonb_build_object('key', key, 'value', value)) from support_tasks.app_settings),
      'tasks', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from support_tasks.tasks t where deleted_at is null)))"""
SNAP_KEEP = snapshot(keep=json.dumps([U['admin']]), admin_role="'viewer'")
SNAP_VIEWER = snapshot(admin_role="'viewer'")
check('النسخ: المتصفح (مدير) لا يستطيع استدعاء دالة الكتابة', False, f"select {snapshot()}", 'admin', None)
check('النسخ: دالة refresh-staging (مفتاح الخادم) تنسخ المهام', True, f"set role service_role; select {snapshot()}->>'tasks'", None, prod_n)
check('النسخ: المهام مربوطة بمهندسيها في التجربة', True,
      "select count(*) from support_tasks_staging.tasks t join support_tasks_staging.profiles p on p.id = t.engineer_id where p.source_id is not null", None, prod_n)
check('النسخ: أسباب المراجعة تُنسخ', True,
      "select (select count(*) from support_tasks_staging.tasks where review_reasons is not null) = (select count(*) from support_tasks.tasks where review_reasons is not null and deleted_at is null)", None, 't')
check('النسخ: من ينفّذ يبقى مديراً حتى لو تغيّر دوره في الإنتاج', True,
      f"set role service_role; select {SNAP_KEEP}; reset role; select role from support_tasks_staging.profiles where id = '{U['admin']}'", None, 'admin')
check('النسخ: غير المنفّذ يأخذ دوره من الإنتاج', True,
      f"set role service_role; select {SNAP_VIEWER}; reset role; select role from support_tasks_staging.profiles where id = '{U['admin']}'", None, 'viewer')
sql(f"set role service_role; select {snapshot()}")
sql("insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'old@x.om') on conflict do nothing; "
    "insert into support_tasks_staging.profiles (id, email, full_name, role) values ('99999999-9999-9999-9999-999999999999', 'old@x.om', 'قديم', 'engineer') on conflict do nothing")
check('النسخ: مستخدم التجربة الذي لا نظير له في الإنتاج يُعطَّل', True,
      f"set role service_role; select {snapshot()}->>'deactivated'; reset role; select is_active from support_tasks_staging.profiles where email = 'old@x.om'", None, 'f')
check('حذف الكل: المهندس مرفوض', False, 'select support_tasks_staging.purge_all_tasks()', 'eng1', 'لمدير النظام')
check('حذف الكل: الزائر بلا دخول مرفوض', False, 'set role anon; select support_tasks_staging.purge_all_tasks()', None, None)
sql("insert into support_tasks_staging.app_settings (key, value) values ('allow_purge_tasks', 'false') on conflict (key) do update set value = 'false'")
check('حذف الكل: المدير (التجربة لا تحتاج الإعداد)', True, "select support_tasks_staging.purge_all_tasks()->>'tasks'", 'admin', prod_n)
check('حذف الكل: لم يبق شيء في التجربة', True,
      'select (select count(*) from support_tasks_staging.tasks) + (select count(*) from support_tasks_staging.task_audit)', None, '0')
check('حذف الكل: الإنتاج لم يتأثر', True, 'select count(*) from support_tasks.tasks', None, prod_n)
check('حذف الكل: ملف التجربة لا يحتوي دالة الإنتاج', True, f"select {int('support_tasks.purge_all_tasks' in setup_stg)}", None, '0')
check('بعد الحذف: إضافة مهمة تبدأ من 1', True,
      f"set search_path = support_tasks_staging, public; insert into tasks (subject, received_date, status_id) select 'جديدة', '2026-11-01', id from task_statuses where kind = 'open' limit 1 returning id", 'eng1', '1')
check('النسخ يعمل بعد الحذف', True, f"set role service_role; select {snapshot()}->>'tasks'", None, prod_n)

print(f'\n{passed} ناجح، {failed} فاشل')
sys.exit(1 if failed else 0)
