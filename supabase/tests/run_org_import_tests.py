"""اختبار حذف الهيكل واستيراده (supabase/dev/sql/21_org_import.sql) على PostgreSQL محلي مع محاكاة Supabase.
التجهيز: كما في run_org_tests.py. التشغيل: TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_org_import_tests.py"""
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
    f"insert into auth.users (id, email) values ('{U[k]}', 'imp-{k}.{U[k][:8]}@x.om');"
    f"insert into profiles (id, email, full_name, role) values ('{U[k]}', 'imp-{k}.{U[k][:8]}@x.om', 'اسم {k}', '{k}');" for k in U)
    + "update profiles set employee_id = null; truncate employee_assignments restart identity;"
      "alter table org_units disable trigger org_units_before_delete; delete from org_units;"
      "alter table org_units enable trigger org_units_before_delete; truncate org_audit restart identity;")
assert ok, out
LV = {n: sql(f"select id from org_levels where name = '{n}'")[1] for n in ('مكتب الوزير', 'مكتب الوكيل', 'مديرية', 'دائرة', 'قسم')}


def items(rows):
    return "'" + json.dumps(rows, ensure_ascii=False).replace("'", "''") + "'::jsonb"


T = [
    {'k': 'M', 'p': None, 'parent_id': None, 'name': 'مكتب الوزير', 'level_id': int(LV['مكتب الوزير']), 'sort': 1},
    {'k': 'V', 'p': 'M', 'parent_id': None, 'name': 'مكتب الوكيل', 'level_id': int(LV['مكتب الوكيل']), 'sort': 2},
    {'k': 'D1', 'p': 'V', 'parent_id': None, 'name': 'المديرية العامة للهندسة', 'level_id': int(LV['مديرية']), 'sort': 3},
    {'k': 'D1/C', 'p': 'D1', 'parent_id': None, 'name': 'دائرة التشغيل', 'level_id': int(LV['دائرة']), 'sort': 4},
    {'k': 'D1/C/S', 'p': 'D1/C', 'parent_id': None, 'name': 'قسم التنسيق', 'level_id': int(LV['قسم']), 'sort': 5},
    {'k': 'D1/S2', 'p': 'D1', 'parent_id': None, 'name': 'قسم التنسيق والمتابعة', 'level_id': int(LV['قسم']), 'sort': 6},
    {'k': 'D2', 'p': 'V', 'parent_id': None, 'name': 'المديرية العامة للإذاعة', 'level_id': int(LV['مديرية']), 'sort': 7},
    {'k': 'D2/C', 'p': 'D2', 'parent_id': None, 'name': 'دائرة التشغيل', 'level_id': int(LV['دائرة']), 'sort': 8},
]
check('رئيس القسم لا يستورد', False, f"select org_import({items(T)})", 'head', contains='صلاحية')
check('استيراد شجرة جديدة', True, f"select org_import({items(T)})::text", contains='"created": 8, "existing": 0')
check('الاسم نفسه تحت وحدتين مختلفتين', True, "select count(*) from org_units where name = 'دائرة التشغيل'", equals='2')
check('الترتيب من الملف', True, "select sort_order from org_units where name = 'المديرية العامة للإذاعة'", equals='7')
check('المسار', True, "select org_path(id) from org_units where name = 'قسم التنسيق'", equals='مكتب الوزير ← مكتب الوكيل ← المديرية العامة للهندسة ← دائرة التشغيل ← قسم التنسيق')
check('الإضافة مرة أخرى لا تكرر شيئاً', True, f"select org_import({items(T)})::text", contains='"created": 0, "existing": 8')
sql("update org_units set aliases = array['تشغيل الهندسة'] where name = 'دائرة التشغيل' and parent_id = (select id from org_units where name = 'المديرية العامة للهندسة')", 'admin')
T2 = T[:3] + [{'k': 'D1/X', 'p': 'D1', 'parent_id': None, 'name': 'تشغيل الهندسة', 'level_id': int(LV['دائرة']), 'sort': 9},
              {'k': 'D1/N', 'p': 'D1', 'parent_id': None, 'name': 'دائرة جديدة', 'level_id': int(LV['دائرة']), 'sort': 10}]
check('المطابقة بالاسم البديل، وإضافة الجديد فقط', True, f"select org_import({items(T2)})::text", contains='"created": 1, "existing": 4')
check('إضافة تحت وحدة موجودة (parent_id)', True,
      f"select org_import({items([{'k': 'Z', 'p': None, 'parent_id': None, 'name': 'x', 'level_id': 1, 'sort': 1}][:0] + [{'k': 'Q', 'p': None, 'parent_id': 0, 'name': 'قسم مباشر', 'level_id': int(LV['قسم']), 'sort': 1}]).replace('\"parent_id\": 0', '\"parent_id\": ' + sql('select id from org_units where name = $$المديرية العامة للإذاعة$$')[1])})::text",
      contains='"created": 1')
check('قواعد الهيكل مطبقة: مديرية تحت قسم مرفوضة، ولا يُحفظ شيء', False,
      f"select org_import({items([{'k': 'A', 'p': None, 'parent_id': None, 'name': 'وحدة أ', 'level_id': int(LV['قسم']), 'sort': 1}, {'k': 'B', 'p': 'A', 'parent_id': None, 'name': 'مديرية خطأ', 'level_id': int(LV['مديرية']), 'sort': 2}])})",
      contains='مستوى أعلى')
check('…ووحدة أ لم تُحفظ', True, "select count(*) from org_units where name = 'وحدة أ'", equals='0')
check('ترتيب خاطئ في القائمة مرفوض', False, f"select org_import({items([{'k': 'B', 'p': 'A', 'parent_id': None, 'name': 'ب', 'level_id': int(LV['قسم']), 'sort': 1}])})", contains='قبل الوحدة الأعلى')

# إسناد على وحدة ثم حذف الهيكل
sql("insert into employees (civil_no, name_ar) values ('4040', 'موظف اختبار الهيكل') on conflict do nothing", 'admin')
check('إسناد موظف على وحدة', True,
      "insert into employee_assignments (employee_id, unit_id, type_id, start_date) select (select id from employees where civil_no = '4040'), "
      "(select id from org_units where name = 'قسم التنسيق'), (select id from assignment_types where is_primary), '2026-01-01' returning 1", equals='1')
check('الحذف العادي لوحدة فيها تابعة ما زال مرفوضاً', False, "select org_delete_unit((select id from org_units where name = 'مكتب الوزير'))", contains='تحتها وحدات')
check('رئيس القسم لا يحذف الهيكل', False, 'select org_purge()', 'head', contains='صلاحية')
check('الاستبدال: حذف ثم استيراد في عملية واحدة', True, f"select org_import({items(T)}, true)::text",
      contains='"created": 8, "existing": 0, "purged_units": 10, "purged_assignments": 1')
check('…والموظف باقٍ بلا إسناد', True, "select count(*) from employees where civil_no = '4040'; select count(*) from employee_assignments", equals='1\n0')
check('…والسجل: سطر الحذف ثم الإضافات', True, "select count(*) from org_audit where entity = 'unit' and action = 'delete'; select count(*) from org_audit where action = 'insert' and entity = 'unit'", equals='1\n8')
check('استبدال فاشل لا يحذف الهيكل', False,
      f"select org_import({items([{'k': 'B', 'p': 'A', 'parent_id': None, 'name': 'ب', 'level_id': int(LV['قسم']), 'sort': 1}])}, true)")
check('…والهيكل باقٍ', True, 'select count(*) from org_units', equals='8')
check('حذف الهيكل', True, "select org_purge()::text; select count(*) from org_units",
      contains='"units": 8')
check('…والمستويات والأنواع باقية', True, 'select (select count(*) from org_levels) > 0 and (select count(*) from assignment_types) > 0', equals='t')

print(f'\n{passed} نجح، {failed} فشل')
sys.exit(1 if failed else 0)
