"""اختبار الموظفين والإسناد (supabase/dev/sql/19_employees.sql) على PostgreSQL محلي مع محاكاة Supabase.
التجهيز: كما في run_org_tests.py (قاعدة td فيها setup_staging.sql ثم setup_dev.sql)
التشغيل: TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_employee_tests.py"""
import os, subprocess, sys, uuid

PSQL = ['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', os.environ.get('TEST_DB', 'td'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
SCHEMA = os.environ.get('TEST_SCHEMA', 'support_tasks_dev')
U = {k: str(uuid.uuid4()) for k in ('admin', 'head', 'eng', 'eng2')}
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


roles = {'admin': ('admin', '9001'), 'head': ('head', '9002'), 'eng': ('engineer', '11112222'), 'eng2': ('engineer', 'E-77')}
setup = ''.join(
    f"insert into auth.users (id, email) values ('{U[k]}', 'emp-{k}.{U[k][:8]}@x.om');"
    f"insert into profiles (id, email, full_name, role, login_no) values ('{U[k]}', 'emp-{k}.{U[k][:8]}@x.om', 'اسم {k}', '{r}', {'null' if not n.isdigit() else repr(n)});"
    for k, (r, n) in roles.items())
# بلا cascade: profiles تشير إلى employees، وcascade كان سيفرغ المستخدمين وكل ما يشير إليهم
ok, out = sql("update profiles set employee_id = null; truncate employee_assignments restart identity; delete from employees;"
              "alter sequence employees_id_seq restart; truncate org_audit restart identity;"
              "alter table org_units disable trigger org_units_before_delete; delete from org_units;"
              "alter table org_units enable trigger org_units_before_delete; alter sequence org_units_id_seq restart; truncate org_audit restart identity;"
              "delete from assignment_types where name not in ('أصيل', 'تكليف', 'ندب', 'قيام بالأعمال');"
              "update profiles set login_no = null where login_no in ('9001', '9002', '11112222', '5002');" + setup)
assert ok, out
LV = lambda n: f"(select id from org_levels where name = '{n}')"
ok, out = sql(
    f"insert into org_units (name, level_id) values ('مكتب الوزير', {LV('مكتب الوزير')});"
    f"insert into org_units (name, level_id, parent_id) values ('مكتب الوكيل', {LV('مكتب الوكيل')}, 1);"
    f"insert into org_units (name, level_id, parent_id) values ('مديرية التقنية', {LV('مديرية')}, 2);"
    f"insert into org_units (name, level_id, parent_id) values ('مديرية الموارد', {LV('مديرية')}, 2);"
    f"insert into org_units (name, level_id, parent_id) values ('دائرة الدعم', {LV('دائرة')}, 3);", 'admin')
assert ok, out

T = lambda n: f"(select id from assignment_types where name = '{n}')"
E = lambda c: f"(select id from employees where civil_no = '{c}')"
UN = lambda n: f"(select id from org_units where name = '{n}')"


def assign(civil, unit, typ='أصيل', start='2026-01-01', end=None, head=False):
    e = f"'{end}'" if end else 'null'
    return (f"insert into employee_assignments (employee_id, unit_id, type_id, is_head, start_date, end_date) "
            f"values ({E(civil)}, {UN(unit)}, {T(typ)}, {str(head).lower()}, '{start}', {e}) returning id")


# ---------- الأنواع ----------
check('الأنواع الأربعة بترتيبها', True, "select string_agg(name, '،' order by sort_order) from assignment_types", equals='أصيل،تكليف،ندب،قيام بالأعمال')
check('نوع «أصيل» لا يُعطَّل ولا يتغير كونه أصيلاً', True,
      f"update assignment_types set is_active = false, is_primary = false where id = {T('أصيل')} returning is_active::text || is_primary::text", equals='truetrue')
check('نوع جديد لا يكون أصيلاً', True, "insert into assignment_types (name, is_primary, sort_order) values ('إعارة', true, 5) returning is_primary", equals='f')
check('اسم نوع مكرر: مرفوض', False, "insert into assignment_types (name) values (' إعارة')", contains='يوجد نوع')
check('المهندس لا يضيف نوعاً', False, "insert into assignment_types (name) values ('انتداب')", 'eng')
check('المهندس يقرأ الأنواع', True, 'select count(*) from assignment_types', 'eng', equals='5')

# ---------- الموظفون ----------
check('إضافة موظف (أرقام عربية تتحول، والاسم يُنظَّف)', True,
      "insert into employees (civil_no, employee_no, name_ar, name_en) values ('١١١١٢٢٢٢', ' 5001 ', ' أحمد   الحارثي ', 'Ahmed') returning civil_no || '|' || employee_no || '|' || name_ar",
      equals='11112222|5001|أحمد الحارثي')
check('…وارتبط تلقائياً بالمستخدم صاحب الرقم نفسه', True, f"select employee_id from profiles where id = '{U['eng']}'", equals='1')
check('رقم مدني مكرر: مرفوض', False, "insert into employees (civil_no, name_ar) values ('11112222', 'آخر')", contains='مسجّل للموظف')
check('رقم وظيفي مكرر: مرفوض', False, "insert into employees (civil_no, employee_no, name_ar) values ('3333', '5001', 'آخر')", contains='الرقم الوظيفي 5001')
check('رقم مدني بحروف: مرفوض', False, "insert into employees (civil_no, name_ar) values ('12A4', 'آخر')", contains='أرقام فقط')
check('الاسم بالعربي مطلوب', False, "insert into employees (civil_no, name_ar) values ('4444', '  ')", contains='الاسم بالعربي')
check('موظفان آخران', True, "insert into employees (civil_no, employee_no, name_ar) values ('2222', '5002', 'سالم'), ('3333', null, 'مريم'), ('5555', null, 'خالد'); select count(*) from employees", equals='4')
check('رئيس القسم لا يرى الموظفين (المرحلة الثانية)', True, 'select count(*) from employees', 'head', equals='0')
check('المهندس لا يضيف موظفاً', False, "insert into employees (civil_no, name_ar) values ('6666', 'س')", 'eng')

# ---------- الإسناد ----------
check('إسناد أصيل في دائرة الدعم', True, assign('11112222', 'دائرة الدعم'))
check('أصيل ثانٍ متداخل: مرفوض', False, assign('11112222', 'مديرية الموارد', start='2026-03-01'), contains='إسناد أصيل في «دائرة الدعم»')
check('تكليف مع الأصيل في الوقت نفسه: مسموح', True, assign('11112222', 'مديرية الموارد', 'تكليف', '2026-02-01'))
check('التكليف نفسه مكرر متداخل: مرفوض', False, assign('11112222', 'مديرية الموارد', 'تكليف', '2026-05-01'), contains='في الفترة نفسها')
check('نهاية قبل البداية: مرفوض', False, assign('2222', 'دائرة الدعم', start='2026-05-01', end='2026-04-01'), contains='قبل تاريخ البداية')
check('رئيس أصيل للدائرة', True, assign('2222', 'دائرة الدعم', head=True))
check('رئيس أصيل ثانٍ للدائرة نفسها: مرفوض', False, assign('3333', 'دائرة الدعم', head=True), contains='رئيس في الفترة نفسها: سالم')
check('قيام بالأعمال (يصبح رئاسة تلقائياً) مع وجود الرئيس: مسموح', True,
      assign('3333', 'دائرة الدعم', 'قيام بالأعمال', '2026-06-01', '2026-06-30') + ';' +
      f"select is_head from employee_assignments where employee_id = {E('3333')}", contains='t')
check('قائم بالأعمال ثانٍ في الفترة نفسها: مرفوض', False, assign('5555', 'دائرة الدعم', 'قيام بالأعمال', '2026-06-15', '2026-07-15'), contains='يقوم بأعمال رئاسة')
check('…وبعد انتهاء الأول: مسموح', True, assign('5555', 'دائرة الدعم', 'قيام بالأعمال', '2026-07-01', '2026-07-15'))
check('إسناد قائم في وحدة معطّلة: مرفوض', False,
      f"update org_units set is_active = false where id = {UN('مديرية الموارد')};" + assign('5555', 'مديرية الموارد', 'ندب', '2026-08-01'), contains='معطّلة')
sql(f"update org_units set is_active = true where id = {UN('مديرية الموارد')}", 'admin')
check('إسناد منتهٍ في وحدة معطّلة (تاريخ قديم): مسموح', True,
      f"update org_units set is_active = false where id = {UN('مديرية الموارد')};" + assign('5555', 'مديرية الموارد', 'ندب', '2025-01-01', '2025-02-01'))
sql(f"update org_units set is_active = true where id = {UN('مديرية الموارد')}", 'admin')
check('الإسناد لا ينتقل لموظف آخر', True,
      f"update employee_assignments set employee_id = {E('5555')} where id = 1 returning employee_id", equals='1')
check('المهندس لا يضيف إسناداً', False, assign('5555', 'مديرية التقنية', 'ندب', '2026-09-01'), 'eng')
check('حذف مباشر ممنوع', False, 'delete from employee_assignments where id = 1', contains='permission denied')

# ---------- النقل ----------
check('نقل الموظف: ينتهي الأصيل في اليوم السابق ويبدأ الجديد', True,
      f"select employee_transfer({E('11112222')}, {UN('مديرية التقنية')}, '2026-04-01');"
      f"select string_agg(u.name || ':' || a.start_date || '..' || coalesce(a.end_date::text, ''), ' | ' order by a.start_date) "
      f"from employee_assignments a join org_units u on u.id = a.unit_id where a.employee_id = {E('11112222')} and a.type_id = {T('أصيل')}",
      contains='دائرة الدعم:2026-01-01..2026-03-31 | مديرية التقنية:2026-04-01..')
check('النقل إلى الوحدة نفسها: مرفوض', False, f"select employee_transfer({E('11112222')}, {UN('مديرية التقنية')}, '2026-05-01')", contains='في هذه الوحدة أصلاً')
check('النقل في يوم بداية الإسناد يصحح الوحدة بدل إسناد جديد', True,
      f"select employee_transfer({E('11112222')}, {UN('مديرية الموارد')}, '2026-04-01');"
      f"select count(*) from employee_assignments where employee_id = {E('11112222')} and type_id = {T('أصيل')}", contains='2')
check('رئيس القسم لا ينقل', False, f"select employee_transfer({E('2222')}, {UN('مديرية التقنية')}, '2026-05-01')", 'head', contains='صلاحية')

# ---------- التعطيل ----------
check('تعطيل مباشر وله إسناد قائم: مرفوض', False, f"update employees set is_active = false where id = {E('2222')}", contains='إسنادات قائمة')
check('تاريخ تعطيل بعد اليوم: مرفوض', False, f"select employee_set_active({E('2222')}, false, current_date + 5)", contains='بعد اليوم')
check('التعطيل ينهي الإسنادات القائمة', True,
      f"select employee_set_active({E('2222')}, false);"
      f"select count(*) from employee_assignments where employee_id = {E('2222')} and (end_date is null or end_date > current_date);"
      f"select is_active from employees where id = {E('2222')}", contains='0\nf')
check('إسناد قائم لموظف غير نشط: مرفوض', False, assign('2222', 'مديرية التقنية', 'ندب', '2026-10-01'), contains='غير نشط')
check('التفعيل', True, f"select employee_set_active({E('2222')}, true); select is_active from employees where id = {E('2222')}", contains='t')

# ---------- الحذف ----------
check('حذف إسناد', True, f"select assignment_delete((select id from employee_assignments where employee_id = {E('5555')} and type_id = {T('ندب')})); "
      f"select count(*) from employee_assignments where employee_id = {E('5555')} and type_id = {T('ندب')}", equals='0')
check('حذف نوع مستخدم: مرفوض', False, f"select assignment_type_delete({T('تكليف')})", contains='مستخدم في')
check('حذف «أصيل»: مرفوض', False, f"select assignment_type_delete({T('أصيل')})", contains='لا يُحذف')
check('حذف نوع غير مستخدم', True, f"select assignment_type_delete({T('إعارة')}); select count(*) from assignment_types where name = 'إعارة'", equals='0')

# ---------- الاستيراد والربط ----------
check('الاستيراد: إضافة وتحديث ودون تغيير، والفارغ لا يمسح', True,
      """select employees_import('[{"civil_no":"11112222","employee_no":"","name_ar":"أحمد الحارثي","name_en":""},
         {"civil_no":"2222","employee_no":"5002","name_ar":"سالم بن علي","name_en":"Salim"},
         {"civil_no":"٧٧٧٧","employee_no":"E-77","name_ar":"منى","name_en":"Mona"}]'::jsonb)::text""",
      contains='"created": 1, "updated": 1, "unchanged": 1')
check('…والرقم الوظيفي للأول بقي', True, f"select employee_no from employees where civil_no = '11112222'", equals='5001')
sql(f"update profiles set login_no = '5002' where id = '{U['eng2']}'")   # رقم دخوله = الرقم الوظيفي لسالم
check('ربط المستخدمين: من دخوله بالرقم الوظيفي', True,
      f"select link_users_to_employees(); select employee_id = {E('2222')} from profiles where id = '{U['eng2']}'", equals='1\nt')
check('المدير لا يكتب الربط مباشرة في جدول المستخدمين', False, f"update profiles set employee_id = null where id = '{U['eng2']}'", contains='permission denied')
check('ربط يدوي ثم فك', True,
      f"select employee_set_user({E('7777')}, '{U['eng2']}'); select employee_id from profiles where id = '{U['eng2']}';"
      f"select employee_set_user({E('7777')}, null); select coalesce(employee_id::text, 'null') from profiles where id = '{U['eng2']}'",
      contains='null')
check('موظف واحد لمستخدم واحد', False,
      f"update profiles set employee_id = {E('11112222')} where id = '{U['eng2']}'", None, contains='duplicate')
check('رئيس القسم لا يستورد', False, """select employees_import('[]'::jsonb)""", 'head', contains='صلاحية')

check('حذف وحدة لها إسنادات: مرفوض', False, f"select org_delete_unit({UN('دائرة الدعم')})", contains='إسناد موظفين')

# ---------- السجل ----------
check('السجل يشمل الموظفين والإسنادات والأنواع', True,
      "select string_agg(distinct entity, ',' order by entity) from org_audit", equals='assignment,assignment_type,employee,unit')
check('تعديل الإسناد مسجّل بحقوله', True,
      "select count(*) > 0 from org_audit where entity = 'assignment' and action = 'update' and 'end_date' = any(changed_fields)", equals='t')

print(f'\n{passed} نجح، {failed} فشل')
sys.exit(1 if failed else 0)
