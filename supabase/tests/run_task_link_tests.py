"""اختبار ربط المهام بالهيكل والموظفين (supabase/dev/sql/23_task_links.sql) على PostgreSQL محلي مع محاكاة Supabase.
التجهيز: كما في run_dev_tests.py. التشغيل: TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_task_link_tests.py"""
import json, os, subprocess, sys, uuid

PSQL = ['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', os.environ.get('TEST_DB', 'td'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
SCHEMA = os.environ.get('TEST_SCHEMA', 'support_tasks_dev')
U = {k: str(uuid.uuid4()) for k in ('admin', 'eng')}
passed = failed = 0


def sql(q, who=None):
    pre = f"set search_path = {SCHEMA}, public;\n"
    if who:
        pre += f"set role authenticated; set request.jwt.claim.sub = '{U[who]}';\n"
    r = subprocess.run(PSQL, input=pre + q, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())


def check(name, ok_expected, q, who='eng', contains=None, equals=None):
    global passed, failed
    ok, out = sql(q, who)
    good = ok == ok_expected and (contains is None or contains in out) and (equals is None or out == equals)
    passed += good
    failed += not good
    print(('✅' if good else '❌'), name, '' if good else f'\n    → ok={ok} out={out[:400]}')
    return out


roles = {'admin': 'admin', 'eng': 'engineer'}
ok, out = sql(
    "truncate task_audit, tasks restart identity cascade; truncate task_code_seq; update app_settings set updated_by = null;"
    "delete from app_settings where key = 'allow_unlisted';"
    "update profiles set employee_id = null; truncate employee_assignments restart identity; delete from employees;"
    "alter table org_units disable trigger org_units_before_delete; delete from org_units;"
    "alter table org_units enable trigger org_units_before_delete; truncate org_audit restart identity;"
    "delete from profiles;"
    + ''.join(f"insert into auth.users (id, email) values ('{U[k]}', 'tl-{k}.{U[k][:8]}@x.om');"
              f"insert into profiles (id, email, full_name, role) values ('{U[k]}', 'tl-{k}@x.om', 'اسم {k}', '{r}');" for k, r in roles.items()))
assert ok, out
LV = lambda n: f"(select id from org_levels where name = '{n}')"
ok, out = sql(
    f"insert into org_units (name, level_id, aliases) values ('مديرية أ', {LV('مديرية')}, '{{م.أ}}');"
    f"insert into org_units (name, level_id, parent_id) values ('دائرة ب', {LV('دائرة')}, (select id from org_units where name = 'مديرية أ'));"
    f"insert into org_units (name, level_id, parent_id) values ('قسم ج', {LV('قسم')}, (select id from org_units where name = 'دائرة ب'));"
    f"insert into org_units (name, level_id, parent_id, is_active) values ('قسم معطل', {LV('قسم')}, (select id from org_units where name = 'دائرة ب'), false);"
    "insert into employees (civil_no, employee_no, name_ar) values ('101', '501', 'سالم'), ('102', '502', 'خالد');"
    "insert into employees (civil_no, employee_no, name_ar, is_active) values ('103', '503', 'متقاعد', false);"
    "insert into employee_assignments (employee_id, unit_id, type_id, start_date) values ((select id from employees where civil_no = '101'),"
    " (select id from org_units where name = 'قسم ج'), (select id from assignment_types where is_primary), '2026-01-01');", 'admin')
assert ok, out
UNIT = {n: sql(f"select id from org_units where name = '{n}'")[1] for n in ('مديرية أ', 'دائرة ب', 'قسم ج', 'قسم معطل')}
EMP = {n: sql(f"select id from employees where name_ar = '{n}'")[1] for n in ('سالم', 'خالد', 'متقاعد')}
OPEN = sql("select id from task_statuses where kind = 'open' order by sort_order limit 1")[1]
UN = lambda n: UNIT[n]
EM = lambda n: EMP[n]


def ins(cols, vals, ret='id'):
    return (f"insert into tasks (subject, received_date, status_id, {cols}) values ('م', '2026-03-01', {OPEN}, {vals}) returning {ret}"
            if cols else f"insert into tasks (subject, received_date, status_id) values ('م', '2026-03-01', {OPEN}) returning {ret}")


V = lambda tid, cols: f"select {cols} from v_tasks where id = {tid}"

# ---------- الإدخال ----------
check('بلا جهة ولا موظف: مرفوض', False, ins('', ''), contains='أحدهما على الأقل')
t1 = check('نص حر للجهة (الإعداد مفعّل افتراضياً)', True, ins('requester', "'جهة خارج الهيكل'"))
check('…وتحتاج ربطاً', True, V(t1, 'needs_link'), equals='t')
t2 = check('الجهة من الهيكل: اسمها يُكتب', True, ins('requester_unit_id, requester', f"{UN('قسم ج')}, 'أي نص'"))
check('…ولا تحتاج ربطاً', True, V(t2, "requester || '|' || needs_link"), equals='قسم ج|false')
t3 = check('الموظف وحده: اسمه ووحدته في تاريخ المهمة', True, ins('employee_id', EM('سالم')))
check('…', True, V(t3, f"employee_name || '|' || (requester_unit_id = {UN('قسم ج')}) || '|' || requester || '|' || needs_link"),
      equals='سالم|true|قسم ج|false')
t4 = check('الموظف قبل إسناده: بلا جهة', True,
           f"insert into tasks (subject, received_date, status_id, employee_id) values ('م', '2025-06-01', {OPEN}, {EM('سالم')}) returning id")
check('…', True, V(t4, "coalesce(requester, '-') || '|' || needs_link"), equals='-|false')
t5 = check('الموظف مع جهة محددة: تبقى الجهة المختارة', True, ins('employee_id, requester_unit_id', f"{EM('سالم')}, {UN('دائرة ب')}"))
check('…', True, V(t5, 'requester'), equals='دائرة ب')
check('وحدة معطّلة: مرفوضة', False, ins('requester_unit_id', UN('قسم معطل')), contains='معطّلة')
check('موظف غير نشط: مرفوض', False, ins('employee_id', EM('متقاعد')), contains='غير نشط')
t6 = check('اسم موظف حر', True, ins('employee_name', "'زائر'"))
check('…يحتاج ربطاً', True, V(t6, 'needs_link'), equals='t')

# ---------- التعديل ----------
check('إرجاع اسم الوحدة كما يظهر: الربط يبقى', True,
      f"update tasks set requester = 'قسم ج', subject = 'م2' where id = {t2} returning (requester_unit_id is not null)::text", equals='true')
check('كتابة نص آخر: يُفك الربط', True,
      f"update tasks set requester = 'نص آخر' where id = {t2} returning coalesce(requester_unit_id::text, '-')", equals='-')
check('تعديل اسم الموظف المربوط إلى نص آخر: يُفك الربط', True,
      f"update tasks set employee_name = 'سالم بن علي' where id = {t3} returning coalesce(employee_id::text, '-')", equals='-')
check('مسح الحقلين معاً: مرفوض', False, f"update tasks set requester = null, requester_unit_id = null, employee_name = null, employee_id = null where id = {t3}",
      contains='أحدهما على الأقل')
ok, _ = sql(f"alter table tasks disable trigger user; insert into tasks (engineer_id, subject, received_date, status_id) values ('{U['eng']}', 'قديمة', '2026-01-01', {OPEN}); alter table tasks enable trigger user;")
OLD = sql("select id from tasks where subject = 'قديمة'")[1]
check('مهمة قديمة بلا الحقلين: تعديل غيرهما مسموح', True, f"update tasks set subject = 'قديمة 2' where id = {OLD} returning id")

# ---------- الإعداد موقوف ----------
sql("insert into app_settings (key, value) values ('allow_unlisted', 'false') on conflict (key) do update set value = excluded.value", 'admin')
check('موقوف: جهة بنص حر مرفوضة', False, ins('requester', "'جهة حرة'"), contains='من الهيكل')
check('موقوف: موظف بنص حر مرفوض', False, ins('employee_name', "'زائر'"), contains='قائمة الموظفين')
check('موقوف: من القائمة مسموح', True, ins('requester_unit_id', UN('قسم ج')))
check('موقوف: النص الحر القديم يبقى عند تعديل غيره', True, f"update tasks set subject = 'م3' where id = {t1} returning id")
check('موقوف: الاستيراد يحفظ النص كما في الملف', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, requester, imported_at) values ('{U['eng']}', 'مستوردة', '2026-03-01', {OPEN}, 'من الملف', now()) returning id",
      'admin')
check('الاستيراد بلا الحقلين: مسموح', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, imported_at) values ('{U['eng']}', 'مستوردة 2', '2026-03-01', {OPEN}, now()) returning id", 'admin')
sql("update app_settings set value = 'true' where key = 'allow_unlisted'", 'admin')

# ---------- دليل الموظفين ----------
d = check('دليل الموظفين للمهندس', True, "select employee_directory()::text")
check('…بلا الرقم المدني', True, "select (employee_directory()::text like '%101%')::text", equals='false')
check('…فيه الإسناد', True, "select jsonb_array_length(employee_directory() -> 'assignments')", equals='1')
check('جدول الموظفين نفسه للمدير فقط', True, "select count(*) from employees", equals='0')

# ---------- الربط الجماعي ----------
check('نصوص الربط لمدير النظام فقط', False, "select tasks_link_texts()", contains='صلاحية')
sql(f"update tasks set requester = 'م.أ', requester_unit_id = null where id = {t4}", 'admin')
txt = check('النصوص غير المربوطة', True, "select tasks_link_texts()::text", 'admin', contains='"text": "م.أ"')
before = sql(f"select updated_at || '|' || (select count(*) from task_audit where task_id = {t4}) from tasks where id = {t4}")[1]
j = lambda items: json.dumps([{'kind': k, 'text': t, 'id': i} for k, t, i in items], ensure_ascii=False)
UID = lambda n: int(sql(f"select id from org_units where name = '{n}'")[1])
EID = lambda n: int(sql(f"select id from employees where name_ar = '{n}'")[1])
check('الربط: مهام النص نفسه', True, f"select tasks_link_apply('{j([('unit', 'م.أ', UID('مديرية أ')), ('employee', 'زائر', EID('خالد'))])}')::text", 'admin',
      equals='{"units": 1, "employees": 1}')
check('…آخر تعديل والسجل لا يتغيران', True,
      f"select updated_at || '|' || (select count(*) from task_audit where task_id = {t4}) from tasks where id = {t4}", None, equals=before)
check('…النص القديم يبقى، والعرض باسم الوحدة', True,
      f"select t.requester || '|' || v.requester || '|' || v.requester_text from tasks t join v_tasks v on v.id = t.id where t.id = {t4}", equals='م.أ|مديرية أ|م.أ')
check('…اسم الموظف الحر يبقى كما كُتب', True, V(t6, "employee_name || '|' || needs_link"), equals='زائر|false')
check('ربط بوحدة غير موجودة: مرفوض', False, f"select tasks_link_apply('{j([('unit', 'س', 999999)])}')", 'admin', contains='غير موجود')
check('المهندس لا يربط جماعياً', False, f"select tasks_link_apply('{j([('unit', 'س', UID('قسم ج'))])}')", contains='صلاحية')
check('إعادة تسمية الوحدة: تظهر في المهام', True,
      f"update org_units set name = 'المديرية أ' where name = 'مديرية أ'; select requester from v_tasks where id = {t4}", 'admin', equals='المديرية أ')

# ---------- الحذف ----------
sql(f"insert into org_units (name, level_id, parent_id) values ('قسم هـ', {LV('قسم')}, {UNIT['دائرة ب']})", 'admin')
check('مهمة لقسم جديد', True, ins('requester_unit_id', f"(select id from org_units where name = 'قسم هـ')"))
check('وحدة مستخدمة في مهام لا تُحذف', False, f"select org_delete_unit({UID('قسم هـ')})", 'admin', contains='الجهة الطالبة في')
before = sql(f"select string_agg(updated_at::text, ',' order by id) || '|' || (select count(*) from task_audit) from tasks")[1]
check('حذف كل الموظفين: يُفك ربط المهام', True, "select employees_purge() ->> 'employees'; select count(*) from tasks where employee_id is not null", 'admin',
      equals='3\n0')
check('حذف الهيكل: يُفك ربط المهام', True, "select org_purge() ->> 'units'; select count(*) from tasks where requester_unit_id is not null", 'admin',
      contains='\n0')
check('…آخر تعديل والسجل لا يتغيران', True, f"select string_agg(updated_at::text, ',' order by id) || '|' || (select count(*) from task_audit) from tasks",
      None, equals=before)
check('…والنص يبقى ويحتاج ربطاً', True, V(t5, "requester || '|' || employee_name || '|' || needs_link"), equals='دائرة ب|سالم|true')

print(f'\n{passed} نجح، {failed} فشل')
sys.exit(1 if failed else 0)
