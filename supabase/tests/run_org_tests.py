"""اختبار الهيكل التنظيمي (supabase/dev/sql/18_org_structure.sql) على PostgreSQL محلي مع محاكاة Supabase.
التجهيز: كما في run_dev_tests.py (قاعدة td فيها setup_staging.sql ثم setup_dev.sql)
التشغيل: TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_org_tests.py"""
import os, subprocess, sys, uuid

PSQL = ['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', os.environ.get('TEST_DB', 'td'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
SCHEMA = os.environ.get('TEST_SCHEMA', 'support_tasks_dev')
U = {k: str(uuid.uuid4()) for k in ('admin', 'head', 'eng', 'viewer', 'off')}
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


def val(q, who='admin'):
    ok, out = sql(q, who)
    assert ok, out
    return out


roles = {'admin': 'admin', 'head': 'head', 'eng': 'engineer', 'viewer': 'viewer', 'off': 'engineer'}
setup = ''.join(
    f"insert into auth.users (id, email) values ('{U[k]}', 'org-{k}.{U[k][:8]}@x.om');"
    f"insert into profiles (id, email, full_name, role, is_active) values ('{U[k]}', 'org-{k}.{U[k][:8]}@x.om', 'اسم {k}', '{r}', {str(k != 'off').lower()});"
    for k, r in roles.items())
ok, out = sql("truncate org_audit, org_units restart identity cascade;"
              "delete from org_levels where name not in ('مكتب الوزير', 'مكتب الوكيل', 'مديرية', 'دائرة', 'قسم');"
              "alter table org_levels disable trigger org_levels_before_write;"
              "update org_levels set level_no = case name when 'مكتب الوزير' then 10 when 'مكتب الوكيل' then 20 when 'مديرية' then 30 when 'دائرة' then 40 else 50 end, is_active = true;"
              "alter table org_levels enable trigger org_levels_before_write;"
              "truncate org_audit restart identity;" + setup)
assert ok, out

LV = lambda n: f"(select id from org_levels where name = '{n}')"
UN = lambda n: f"(select id from org_units where name = '{n}')"


def add(name, level, parent=None):
    p = UN(parent) if parent else 'null'
    return f"insert into org_units (name, level_id, parent_id) values ('{name}', {LV(level)}, {p}) returning id"


# ---------- المستويات الأولى ----------
check('المستويات الخمسة موجودة بترتيبها', True, "select string_agg(name, '،' order by level_no) from org_levels",
      equals='مكتب الوزير،مكتب الوكيل،مديرية،دائرة،قسم')
check('الهيكل فارغ في البداية', True, 'select count(*) from org_units', equals='0')

# ---------- الصلاحيات ----------
check('رئيس القسم لا يضيف وحدة', False, add('مكتب الوزير', 'مكتب الوزير'), 'head')
check('المهندس لا يضيف وحدة', False, add('مكتب الوزير', 'مكتب الوزير'), 'eng')
check('المهندس لا يضيف مستوى', False, "insert into org_levels (name, level_no) values ('شعبة', 60)", 'eng')

# ---------- بناء الهيكل ----------
check('المدير يضيف مكتب الوزير (وحدة رئيسية)', True, add('مكتب الوزير', 'مكتب الوزير'))
check('مكتب الوكيل تحت مكتب الوزير', True, add('مكتب الوكيل', 'مكتب الوكيل', 'مكتب الوزير'))
check('مديرية تحت الوكيل', True, add('المديرية العامة لتقنية المعلومات', 'مديرية', 'مكتب الوكيل'))
check('مديرية تحت الوزير مباشرة', True, add('المديرية العامة للتدقيق', 'مديرية', 'مكتب الوزير'))
check('دائرة تحت مديرية', True, add('دائرة الدعم الفني', 'دائرة', 'المديرية العامة لتقنية المعلومات'))
check('قسم تحت دائرة', True, add('قسم الدعم الفني', 'قسم', 'دائرة الدعم الفني'))
check('قسم تحت مديرية مباشرة', True, add('قسم المتابعة', 'قسم', 'المديرية العامة لتقنية المعلومات'))
check('دائرة ثانية في المديرية', True, add('دائرة الأنظمة', 'دائرة', 'المديرية العامة لتقنية المعلومات'))
check('مديرية تحت قسم: مرفوض', False, add('مديرية خطأ', 'مديرية', 'قسم الدعم الفني'), contains='مستوى أعلى')
check('دائرة تحت دائرة (نفس المستوى): مرفوض', False, add('دائرة خطأ', 'دائرة', 'دائرة الأنظمة'), contains='مستوى أعلى')
check('اسم مكرر في المكان نفسه: مرفوض', False, add('دائرة  الأنظمة ', 'دائرة', 'المديرية العامة لتقنية المعلومات'), contains='المكان نفسه')
check('الاسم نفسه في مكان آخر: مسموح', True, add('قسم الشؤون الإدارية', 'قسم', 'دائرة الأنظمة') + ';' + add('قسم الشؤون الإدارية ', 'قسم', 'دائرة الدعم الفني'))
check('اسم فارغ: مرفوض', False, add('   ', 'قسم', 'دائرة الأنظمة'), contains='اكتب اسم الوحدة')
check('المسار الكامل', True, f"select org_path({UN('قسم الدعم الفني')})",
      equals='مكتب الوزير ← مكتب الوكيل ← المديرية العامة لتقنية المعلومات ← دائرة الدعم الفني ← قسم الدعم الفني')
check('كل ما تحت المديرية (7 وحدات مع نفسها)', True, f"select count(*) from org_subtree({UN('المديرية العامة لتقنية المعلومات')})", equals='7')

# ---------- الحقول الإضافية ----------
check('الرمز بحروف كبيرة والأسماء البديلة منظّفة', True,
      f"update org_units set code = ' it01 ', aliases = array[' م.ع.ت.م ', '', 'م.ع.ت.م', 'المديرية العامة لتقنية المعلومات', 'تقنية  المعلومات'] where id = {UN('المديرية العامة لتقنية المعلومات')} "
      "returning code || '|' || array_to_string(aliases, ',')", equals='IT01|م.ع.ت.م,تقنية المعلومات')
check('رمز مكرر: مرفوض', False, f"update org_units set code = 'IT01' where id = {UN('دائرة الأنظمة')}", contains='مستخدم لوحدة أخرى')

# ---------- القراءة ----------
for who in ('head', 'eng', 'viewer'):
    check(f'{who} يقرأ الهيكل', True, 'select count(*) from org_units', who, equals='10')
check('الحساب المعطّل لا يرى الهيكل', True, 'select count(*) from org_units', 'off', equals='0')
check('رئيس القسم لا يعدّل الوحدة (لا يتغير شيء)', True,
      f"update org_units set name = 'تغيير' where id = {UN('دائرة الأنظمة')} returning id", 'head', equals='')

# ---------- النقل ----------
check('نقل دائرة إلى مديرية أخرى (وأقسامها معها)', True,
      f"update org_units set parent_id = {UN('المديرية العامة للتدقيق')} where id = {UN('دائرة الأنظمة')};"
      f"select org_path((select id from org_units where name = 'قسم الشؤون الإدارية' and parent_id = {UN('دائرة الأنظمة')}))",
      equals='مكتب الوزير ← المديرية العامة للتدقيق ← دائرة الأنظمة ← قسم الشؤون الإدارية')
check('نقل مديرية تحت دائرة تابعة لها: مرفوض', False,
      f"update org_units set parent_id = {UN('دائرة الدعم الفني')} where id = {UN('المديرية العامة لتقنية المعلومات')}")
check('نقل وحدة تحت نفسها: مرفوض', False, f"update org_units set parent_id = id where id = {UN('دائرة الدعم الفني')}")
check('جعلها وحدة رئيسية (بلا أم): مسموح', True, f"update org_units set parent_id = null where id = {UN('المديرية العامة للتدقيق')} returning id")
check('وإعادتها تحت الوزير', True, f"update org_units set parent_id = {UN('مكتب الوزير')} where id = {UN('المديرية العامة للتدقيق')} returning id")

# ---------- تغيير مستوى الوحدة ----------
check('دائرة تحتها أقسام لا تصبح قسماً', False, f"update org_units set level_id = {LV('قسم')} where id = {UN('دائرة الدعم الفني')}", contains='تحتها وحدات')
check('قسم بلا تابعة يصبح دائرة', True, f"update org_units set level_id = {LV('دائرة')} where id = {UN('قسم المتابعة')} returning id")
check('ودائرة تحت مديرية لا تصبح مديرية', False, f"update org_units set level_id = {LV('مديرية')} where id = {UN('قسم المتابعة')}", contains='مستوى أعلى')

# ---------- التعطيل والتفعيل ----------
check('تعطيل المديرية يعطّل كل ما تحتها', True,
      f"select org_set_active({UN('المديرية العامة لتقنية المعلومات')}, false);"
      f"select count(*) from org_units where id in (select org_subtree({UN('المديرية العامة لتقنية المعلومات')})) and is_active", equals='5\n0')
check('تفعيل قسم تحت دائرة معطّلة: مرفوض', False, f"update org_units set is_active = true where id = {UN('قسم الدعم الفني')}", contains='معطّلة')
check('إضافة وحدة مفعّلة تحت معطّلة: مرفوض', False, add('قسم جديد', 'قسم', 'دائرة الدعم الفني'), contains='معطّلة')
check('تفعيل المديرية وحدها', True,
      f"select org_set_active({UN('المديرية العامة لتقنية المعلومات')}, true);"
      f"select count(*) from org_units where id in (select org_subtree({UN('المديرية العامة لتقنية المعلومات')})) and is_active", equals='1\n1')
check('تفعيل المديرية مع كل ما تحتها', True,
      f"select org_set_active({UN('المديرية العامة لتقنية المعلومات')}, true, true);"
      f"select count(*) from org_units where id in (select org_subtree({UN('المديرية العامة لتقنية المعلومات')})) and is_active", equals='4\n5')
check('رئيس القسم لا يعطّل', False, f"select org_set_active({UN('دائرة الدعم الفني')}, false)", 'head', contains='صلاحية')

# ---------- الحذف ----------
check('حذف وحدة تحتها وحدات: مرفوض', False, f"select org_delete_unit({UN('دائرة الدعم الفني')})", contains='تحتها وحدات')
check('حذف مباشر من الجدول ممنوع حتى للمدير', False,
      f"delete from org_units where id = {UN('قسم الدعم الفني')}", contains='permission denied')
check('رئيس القسم لا يحذف', False, f"select org_delete_unit({UN('قسم الدعم الفني')})", 'head', contains='صلاحية')
check('حذف وحدة بلا تابعة', True, f"select org_delete_unit({UN('قسم الدعم الفني')}); select count(*) from org_units where name = 'قسم الدعم الفني'", equals='0')

# ---------- المستويات ----------
check('مستوى جديد بين الدائرة والقسم', True, "insert into org_levels (name, level_no, head_title) values ('وحدة', 45, 'رئيس الوحدة') returning head_title", equals='رئيس الوحدة')
check('اسم مستوى مكرر: مرفوض', False, "insert into org_levels (name, level_no) values (' وحدة', 46)", contains='يوجد مستوى')
check('ترتيب يخالف الوحدات القائمة: مرفوض', False, f"update org_levels set level_no = 35 where id = {LV('قسم')}", contains='لا يمكن جعل ترتيب')
check('ترتيب لا يخالف: مسموح', True, f"update org_levels set level_no = 55 where id = {LV('قسم')} returning level_no", equals='55')
check('حذف مستوى مستخدم: مرفوض', False, f"select org_delete_level({LV('قسم')})", contains='مستخدم في')
check('مستوى معطّل لا يُستخدم لوحدة جديدة', True, f"update org_levels set is_active = false where id = {LV('وحدة')} returning id")
check('…فإضافة وحدة منه مرفوضة', False, add('وحدة خطأ', 'وحدة', 'دائرة الدعم الفني'), contains='معطّل')
check('حذف مستوى غير مستخدم', True, f"select org_delete_level({LV('وحدة')}); select count(*) from org_levels where name = 'وحدة'", equals='0')

# ---------- السجل ----------
check('السجل يسجّل الإضافة باسم المدير', True,
      f"select count(*) from org_audit where entity = 'unit' and action = 'insert' and changed_by = '{U['admin']}'", equals='10')
check('التعطيل المتسلسل مسجّل لكل وحدة', True,
      "select count(*) from org_audit where entity = 'unit' and action = 'update' and changed_fields = array['is_active'] and new_data ->> 'is_active' = 'false'", equals='5')
check('الحذف مسجّل', True, "select count(*) from org_audit where action = 'delete'", equals='2')
out = val("select count(*) from org_audit")
check('حفظ بلا تغيير لا يُسجَّل', True, f"update org_units set name = name where id = {UN('دائرة الأنظمة')}; select count(*) from org_audit", equals=out)
check('رئيس القسم لا يقرأ السجل', True, 'select count(*) from org_audit', 'head', equals='0')

print(f'\n{passed} نجح، {failed} فشل')
sys.exit(1 if failed else 0)
