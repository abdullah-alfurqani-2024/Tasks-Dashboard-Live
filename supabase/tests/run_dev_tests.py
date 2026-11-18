"""اختبار رمز المهمة ودمج الاستيراد (16_task_code.sql و17_import_merge.sql) على PostgreSQL محلي مع محاكاة Supabase.
التجهيز (قاعدة مستقلة td، مثل مشروع Tasks-Test):
  $P -c "create database td"
  $P -d td -f supabase/tests/00_supabase_stub.sql
  $P -d td -f supabase/staging/setup_staging.sql
  $P -d td -f supabase/dev/setup_dev.sql
التشغيل (لكل سكيما): TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_dev_tests.py
  TEST_SCHEMA: support_tasks_dev (الافتراضي) أو support_tasks_staging أو support_tasks
  (الإنتاج بلا استقبال نسخة الإنتاج، فتُتخطى اختباراته)"""
import os, subprocess, sys, uuid

PSQL = ['psql', '-h', '/var/tmp/pgtest', '-p', '5544', '-U', 'postgres', '-d', os.environ.get('TEST_DB', 'td'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
SCHEMA = os.environ.get('TEST_SCHEMA', 'support_tasks_dev')
U = {k: str(uuid.uuid4()) for k in ('admin', 'head', 'eng1', 'eng2', 'eng3')}
passed = failed = 0


def sql(q, who=None):
    pre = f"set search_path = {SCHEMA}, public;\n"
    if who:
        pre += f"set role authenticated; set request.jwt.claim.sub = '{U[who]}';\n"
    r = subprocess.run(PSQL, input=pre + q, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())


def check(name, ok_expected, q, who=None, contains=None, equals=None):
    global passed, failed
    ok, out = sql(q, who)
    good = ok == ok_expected and (contains is None or contains in out) and (equals is None or out == equals)
    passed += good
    failed += not good
    print(('✅' if good else '❌'), name, '' if good else f'\n    → ok={ok} out={out[:400]}')
    return out


roles = {'admin': 'admin', 'head': 'head', 'eng1': 'engineer', 'eng2': 'engineer', 'eng3': 'engineer'}
setup = ''.join(
    f"insert into auth.users (id, email) values ('{U[k]}', '{k}.{U[k][:8]}@x.om');"
    f"insert into profiles (id, email, full_name, role) values ('{U[k]}', '{k}@x.om', 'اسم {k}', '{r}');"
    for k, r in roles.items())
ok, out = sql("truncate task_audit, tasks restart identity cascade; truncate task_code_seq; update app_settings set updated_by = null;"
              "delete from profiles;" + setup)   # حسابات auth.users تبقى: قد تخص سكيما أخرى في القاعدة نفسها
assert ok, out
# قاعدة 23_task_links.sql: الجهة الطالبة أو اسم الموظف مطلوب؛ اختبارات الرموز هنا لا تخصهما، فيُملأ الأول افتراضياً
if sql("select 1 from pg_trigger where tgname = 'tasks_links'")[1] == '1':
    assert sql("alter table tasks alter column requester set default 'جهة الاختبار'")[0]

OPEN = "(select id from task_statuses where kind = 'open' order by id limit 1)"
DONE = "(select id from task_statuses where kind = 'done' order by id limit 1)"
TS = "now() - interval '3 days'"

# ---------- رمز المهندس ----------
check('المهندس لا يحدد رمز مهندس', False, f"select set_engineer_code('{U['eng1']}', 'A01')", 'eng1')
check('المدير يحدد رمز المهندس (يُكتب بحروف كبيرة)', True, f"select set_engineer_code('{U['eng1']}', ' a01 ')", 'admin', equals='A01')
check('رمز بصيغة خاطئة يُرفض', False, f"select set_engineer_code('{U['eng2']}', '01-A')", 'admin', contains='حروف إنجليزية')
check('رمز مستخدم لحساب آخر يُرفض', False, f"select set_engineer_code('{U['eng2']}', 'A01')", 'admin', contains='مستخدم لحساب آخر')

# ---------- الإعطاء التلقائي ----------
check('مهمة المهندس في النظام: A01-S0001', True,
      f"insert into tasks (subject, received_date, status_id, task_code) values ('طابعة', '2026-10-01', {OPEN}, 'X99-9999') returning task_code", 'eng1', equals='A01-S0001')
check('الثانية: A01-S0002', True,
      f"insert into tasks (subject, received_date, status_id) values ('شبكة', '2026-10-01', {OPEN}) returning task_code", 'eng1', equals='A01-S0002')
check('مهندس بلا رمز: S-00001', True,
      f"insert into tasks (subject, received_date, status_id) values ('بريد', '2026-10-02', {OPEN}) returning task_code", 'eng2', equals='S-00001')
check('رئيس القسم لا يضع رمزاً بنفسه (يُعطى تلقائياً)', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, task_code, entered_at) values ('{U['eng1']}', 'من الرئيس', '2026-10-03', {OPEN}, 'A01-0001', {TS}) returning task_code || '|' || (entered_at > now() - interval '1 minute')",
      'head', equals='A01-S0003|true')
check('المهندس لا يغيّر الرمز', True,
      "update tasks set task_code = 'ZZ1-1' where task_code = 'A01-S0001' returning task_code", 'eng1', equals='A01-S0001')
check('ولا تاريخ الإدخال', True,
      f"update tasks set entered_at = {TS} where task_code = 'A01-S0001' returning entered_at > now() - interval '1 minute'", 'eng1', equals='t')

# ---------- الاستيراد ----------
check('الاستيراد: الرمز وتاريخ الإدخال من الملف، و imported_at = وقت الإضافة', True,
      f"insert into tasks (engineer_id, created_by, subject, received_date, status_id, task_code, entered_at, imported_at) "
      f"values ('{U['eng1']}', '{U['eng1']}', 'مستوردة', '2026-09-01', {OPEN}, ' a01-0007 ', '2026-09-01 10:00:05+04', '2000-01-01') "
      "returning task_code || '|' || to_char(entered_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || '|' || (imported_at = created_at)::text",
      'admin', equals='A01-0007|2026-09-01 06:00:05|true')
check('الرمز لا يتكرر (حتى من الاستيراد)', False,
      f"insert into tasks (engineer_id, subject, received_date, status_id, task_code) values ('{U['eng1']}', 'مكرر', '2026-09-01', {OPEN}, 'A01-0007')", 'admin')
check('صف مستورد بلا رمز يأخذ رمز نظام', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, imported_at) values ('{U['eng1']}', 'بلا رمز', '2026-09-02', {OPEN}, now()) returning task_code", 'admin', equals='A01-S0004')
check('تعديل عادي من المدير لا يغيّر imported_at', True,
      "update tasks set notes = 'ملاحظة' where task_code = 'A01-0007' returning (updated_at > imported_at)::text", 'admin', equals='true')
check('السجل: تعديل عادي بلا «عبر الاستيراد»', True,
      "select coalesce((new_data ->> 'via_import'), '-') from task_audit where action = 'update' order by id desc limit 1", 'admin', equals='-')
check('تحديث الاستيراد يختم imported_at = updated_at', True,
      "update tasks set notes = 'من الملف', imported_at = '2000-01-01' where task_code = 'A01-0007' returning (updated_at = imported_at)::text", 'admin', equals='true')
check('السجل: تحديث الاستيراد «عبر الاستيراد» وبلا imported_at', True,
      "select (new_data ->> 'via_import') || '|' || array_to_string(changed_fields, ',') from task_audit where action = 'update' order by id desc limit 1",
      'admin', equals='true|notes')
check('المهندس لا يزوّر imported_at', True,
      "update tasks set notes = 'من المهندس', imported_at = now() + interval '1 day' where task_code = 'A01-0007' returning (updated_at > imported_at)::text", 'eng1', equals='true')

# ---------- العرض ----------
check('العرض يحمل الرمز ورمز المهندس', True,
      "select task_code || '|' || engineer_code from v_tasks where task_code = 'A01-0007'", 'eng1', equals='A01-0007|A01')

# ---------- تعلّم رموز المهندسين ----------
check('استيراد مهام eng2 برموز A02', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, task_code) values "
      f"('{U['eng2']}', 'أ', '2026-09-01', {OPEN}, 'A02-0001'), ('{U['eng2']}', 'ب', '2026-09-01', {OPEN}, 'A02-0002'),"
      f"('{U['eng3']}', 'ج', '2026-09-01', {OPEN}, 'A03-0001'), ('{U['eng3']}', 'د', '2026-09-01', {OPEN}, 'A09-0001')", 'admin')
check('learn_engineer_codes: حساب واحد', True, "select learn_engineer_codes()", 'admin', equals='1')
check('eng2 ← A02، و eng3 (بادئتان) بلا رمز', True,
      "select string_agg(coalesce(engineer_code, '-'), ',' order by email) from profiles where email like 'eng%'", 'admin', equals='A01,A02,-')
check('المهندس لا يشغّل learn_engineer_codes', False, "select learn_engineer_codes()", 'eng1')
check('بعد التعلّم: مهمة eng2 الجديدة A02-S0001', True,
      f"insert into tasks (subject, received_date, status_id) values ('جديدة', '2026-10-05', {OPEN}) returning task_code", 'eng2', equals='A02-S0001')

# ---------- العدّاد لا يعيد الرقم بعد الحذف ----------
check('حذف كل المهام (المدير)', True, "select purge_all_tasks() ->> 'tasks'", 'admin')
check('بعد الحذف: الرقم التالي لا يُعاد (A01-S0005)', True,
      f"insert into tasks (subject, received_date, status_id) values ('بعد الحذف', '2026-10-06', {OPEN}) returning task_code", 'eng1', equals='A01-S0005')

# ---------- العدّاد يحترم الرموز الموجودة (مثل المنسوخة من الإنتاج) ----------
check('مهمة منسوخة برمز أكبر من العدّاد', True,
      f"alter table tasks disable trigger user; insert into tasks (engineer_id, subject, received_date, status_id, task_code) values ('{U['eng1']}', 'منسوخة', '2026-10-01', {OPEN}, 'A01-S0040'); alter table tasks enable trigger user;")
check('التالي بعدها A01-S0041', True,
      f"insert into tasks (subject, received_date, status_id) values ('بعدها', '2026-10-07', {OPEN}) returning task_code", 'eng1', equals='A01-S0041')

# ---------- نسخة الإنتاج ----------
HAS_SNAP = sql("select to_regprocedure('apply_production_snapshot(jsonb)') is not null")[1] == 't'
snap = ("select apply_production_snapshot(jsonb_build_object("
        f"'keep', jsonb_build_array('{U['admin']}'), 'force', false,"
        f"'users', jsonb_build_array(jsonb_build_object('id', '{U['eng1']}', 'source_id', '{U['eng1']}', 'email', 'eng1@x.om', 'full_name', 'اسم eng1', 'role', 'engineer', 'is_active', true),"
        f"                           jsonb_build_object('id', '{U['admin']}', 'source_id', '{U['admin']}', 'email', 'admin@x.om', 'full_name', 'اسم admin', 'role', 'admin', 'is_active', true)),"
        "'lookups', jsonb_build_object('task_types', '[]'::jsonb, 'correspondence_types', '[]'::jsonb,"
        "  'task_statuses', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'sort_order', sort_order, 'is_active', is_active)) from task_statuses)),"
        "'settings', '[]'::jsonb,"
        f"'tasks', jsonb_build_array("
        f"  jsonb_build_object('id', 1, 'engineer_id', '{U['eng1']}', 'subject', 'إنتاج قديم', 'received_date', '2026-01-01', 'status_id', {OPEN}, 'created_at', '2026-01-02T08:00:00Z'),"
        f"  jsonb_build_object('id', 2, 'engineer_id', '{U['eng1']}', 'subject', 'إنتاج مرمّز', 'received_date', '2026-01-01', 'status_id', {OPEN}, 'task_code', 'A01-0100', 'entered_at', '2026-01-01T05:00:00Z', 'imported_at', '2026-11-15T10:00:00Z', 'imported_data', jsonb_build_object('notes', 'م'))"
        "))) ->> 'tasks'")
if HAS_SNAP:
    check('نسخة الإنتاج: مهمتان (قديمة بلا رمز، ومرمّزة)', True, snap, equals='2')
    check('القديمة: بلا رمز، وتاريخ إدخالها = تاريخ إضافتها؛ والمرمّزة كما هي', True,
          "select string_agg(coalesce(task_code, '-') || '/' || to_char(entered_at at time zone 'UTC', 'MM-DD HH24') || '/' || coalesce(to_char(imported_at at time zone 'UTC', 'MM-DD'), '-'), ',' order by id) from tasks",
          equals='-/01-02 08/-,A01-0100/01-01 05/11-15')
    check('النسخة لا تمسح رمز المهندس في التطوير', True, f"select engineer_code from profiles where id = '{U['eng1']}'", equals='A01')
    check('بعد النسخ: مهمة جديدة A01-S0042 (العدّاد لا يرجع)', True,
          f"insert into tasks (subject, received_date, status_id) values ('بعد النسخ', '2026-11-16', {OPEN}) returning task_code", 'eng1', equals='A01-S0042')
    check('النسخة تنقل مرجع الاستيراد', True, "select imported_data ->> 'notes' from tasks where id = 2", equals='م')
    check('ربط مهمة بلا رمز برمز (المدير، مرة واحدة)', True,
          "update tasks set task_code = 'a01-0050' where id = 1 returning task_code", 'admin', equals='A01-0050')
    check('ثم لا يتغير', True, "update tasks set task_code = 'A01-0051' where id = 1 returning task_code", 'admin', equals='A01-0050')
else:
    print('— لا استقبال لنسخة الإنتاج في هذه السكيما: تُتخطى اختباراته')

# ---------- 17: مرجع الاستيراد (الدمج حسب الحقل) ----------
BASE = "'{\"notes\": \"من الملف\", \"status\": \"x\"}'::jsonb"
check('الاستيراد يحفظ المرجع مع المهمة', True,
      f"insert into tasks (engineer_id, subject, received_date, status_id, task_code, imported_at, imported_data) values ('{U['eng1']}', 'بمرجع', '2026-09-03', {OPEN}, 'A01-0900', now(), {BASE}) returning imported_data ->> 'notes'",
      'admin', equals='من الملف')
check('المهندس لا يضع مرجعاً عند الإضافة', True,
      f"insert into tasks (subject, received_date, status_id, imported_data) values ('م', '2026-09-03', {OPEN}, {BASE}) returning coalesce(imported_data::text, '-')", 'eng1', equals='-')
check('ولا يغيّره عند التعديل', True,
      "update tasks set notes = 'ن', imported_data = '{}'::jsonb where task_code = 'A01-0900' returning imported_data ->> 'notes'", 'eng1', equals='من الملف')
check('السجل لا يحمل المرجع', True,
      "select count(*) from task_audit where new_data ? 'imported_data' or 'imported_data' = any(coalesce(changed_fields, '{}'))", 'admin', equals='0')
before = check('آخر تعديل قبل حفظ المرجع', True, "select updated_at::text || '|' || coalesce(imported_at::text, '-') from tasks where task_code = 'A01-0900'", 'admin')
check('المهندس لا يحفظ مراجع', False, "select save_import_base('[]'::jsonb)", 'eng1')
SAVE = "select save_import_base(jsonb_build_array(jsonb_build_object('id', (select id from tasks where task_code = 'A01-0900'), 'data', jsonb_build_object('notes', 'جديد'))))"
check('حفظ المراجع دفعة واحدة', True, SAVE, 'admin', equals='1')
check('المرجع نفسه مرة ثانية: لا شيء يتغير', True, SAVE, 'admin', equals='0')
check('حفظ المرجع وحده لا يغيّر آخر تعديل ولا آخر استيراد', True,
      "select updated_at::text || '|' || coalesce(imported_at::text, '-') from tasks where task_code = 'A01-0900'", 'admin', equals=before)
check('ولا يُكتب في السجل', True,
      "select count(*) from task_audit where task_id = (select id from tasks where task_code = 'A01-0900') and action = 'update' and changed_by = (select id from profiles where role = 'admin')", 'admin', equals='0')
check('تحديث استيراد مع حقول: يغيّر آخر تعديل ويحفظ المرجع', True,
      "update tasks set notes = 'من الملف 2', imported_at = now(), imported_data = '{\"notes\": \"من الملف 2\"}' where task_code = 'A01-0900' "
      "returning (updated_at = imported_at)::text || '|' || (imported_data ->> 'notes')", 'admin', equals='true|من الملف 2')

sql("alter table tasks alter column requester drop default")
print(f'\n{passed} نجح، {failed} فشل')
sys.exit(1 if failed else 0)
