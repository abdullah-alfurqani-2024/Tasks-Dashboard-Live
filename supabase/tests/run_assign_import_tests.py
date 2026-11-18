"""اختبار الإسناد الجماعي (supabase/dev/sql/22_assign_import.sql) على PostgreSQL محلي مع محاكاة Supabase.
التجهيز: كما في run_org_tests.py. التشغيل: TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_assign_import_tests.py"""
import json, os, subprocess, sys, uuid

PSQL = ['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', os.environ.get('TEST_DB', 'td'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
SCHEMA = os.environ.get('TEST_SCHEMA', 'support_tasks_dev')
U = {k: str(uuid.uuid4()) for k in ('admin', 'head')}
passed = failed = 0


def sql(q, who=None):
    pre = f"set search_path = {SCHEMA}, public;\n"
    if who:
        pre += f"set role authenticated; set request.jwt.claim.sub = '{U[who]}';\n"
    r = subprocess.run(PSQL, input=pre + q, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())


def check(name, ok_expected, q, who='admin', contains=None, equals=None):
    global passed, failed
    ok, out = sql(q, who)
    good = ok == ok_expected and (contains is None or contains in out) and (equals is None or out == equals)
    passed += good
    failed += not good
    print(('✅' if good else '❌'), name, '' if good else f'\n    → ok={ok} out={out[:400]}')
    return out


ok, out = sql(''.join(
    f"insert into auth.users (id, email) values ('{U[k]}', 'asg-{k}.{U[k][:8]}@x.om');"
    f"insert into profiles (id, email, full_name, role) values ('{U[k]}', 'asg-{k}.{U[k][:8]}@x.om', 'اسم {k}', '{k}');" for k in U)
    + "update profiles set employee_id = null; truncate employee_assignments restart identity; delete from employees;"
      "alter table org_units disable trigger org_units_before_delete; delete from org_units;"
      "alter table org_units enable trigger org_units_before_delete; truncate org_audit restart identity;")
assert ok, out
LV = lambda n: f"(select id from org_levels where name = '{n}')"
ok, out = sql(
    f"insert into org_units (name, level_id) values ('مديرية أ', {LV('مديرية')});"
    f"insert into org_units (name, level_id, parent_id) values ('دائرة ب', {LV('دائرة')}, (select id from org_units where name = 'مديرية أ'));"
    f"insert into org_units (name, level_id, parent_id) values ('قسم ج', {LV('قسم')}, (select id from org_units where name = 'دائرة ب'));"
    f"insert into org_units (name, level_id, parent_id) values ('قسم د', {LV('قسم')}, (select id from org_units where name = 'دائرة ب'));"
    "insert into employees (civil_no, employee_no, name_ar) select (100 + g)::text, (500 + g)::text, 'موظف ' || g from generate_series(1, 6) g;", 'admin')
assert ok, out
E = lambda n: int(sql(f"select id from employees where employee_no = '{500 + n}'")[1])
Un = lambda n: int(sql(f"select id from org_units where name = '{n}'")[1])


def bulk(items, date='2026-01-01', transfer=True, who='admin'):
    j = json.dumps([{'employee_id': e, 'unit_id': u, 'is_head': h} for e, u, h in items], ensure_ascii=False)
    return f"select employees_assign_bulk('{j}'::jsonb, '{date}', {str(transfer).lower()})::text"


check('رئيس القسم لا يُسند', False, bulk([(E(1), Un('قسم ج'), False)], who='head'), 'head', contains='صلاحية')
check('إسناد جديد مع رئاسة', True, bulk([(E(1), Un('قسم ج'), True), (E(2), Un('قسم ج'), False), (E(3), Un('دائرة ب'), True)]),
      contains='"created": 3')
check('…والرؤساء', True, "select count(*) from employee_assignments where is_head", equals='2')
check('رئيس ثانٍ للقسم نفسه: يُسند بلا رئاسة ويُذكر التعارض', True, bulk([(E(4), Un('قسم ج'), True)]),
      contains='"head_conflicts": [{"error": "للوحدة «قسم ج» رئيس')
check('…وأُسند فعلاً', True, f"select is_head from employee_assignments where employee_id = {E(4)}", equals='f')
check('الوحدة نفسها: لا تغيير', True, bulk([(E(2), Un('قسم ج'), False)]), contains='"unchanged": 1')
check('الوحدة نفسها مع رئاسة جديدة', True, bulk([(E(3), Un('دائرة ب'), True)]), contains='"unchanged": 1')
check('وحدة أخرى بلا نقل: يُترك', True, bulk([(E(2), Un('قسم د'), False)], '2026-03-01', False), contains='"skipped": 1')
check('وحدة أخرى مع نقل', True, bulk([(E(2), Un('قسم د'), True)], '2026-03-01', True), contains='"transferred": 1')
check('…والقديم انتهى في اليوم السابق', True,
      f"select string_agg(coalesce(end_date::text, '-'), ',' order by start_date) from employee_assignments where employee_id = {E(2)}", equals='2026-02-28,-')
sql(f"update org_units set is_active = false where id = {Un('قسم د')}", 'admin')
check('وحدة معطّلة: يفشل هو وحده ويُذكر', True, bulk([(E(5), Un('قسم د'), False), (E(6), Un('قسم ج'), False)], '2026-04-01'),
      contains='"failed": [{"error": "الوحدة «قسم د» معطّلة.')
check('…والآخر أُسند', True, f"select count(*) from employee_assignments where employee_id = {E(6)}", equals='1')
check('تاريخ فارغ مرفوض', False, "select employees_assign_bulk('[]'::jsonb, null, true)", contains='تاريخ بداية الإسناد')

print(f'\n{passed} نجح، {failed} فشل')
sys.exit(1 if failed else 0)
