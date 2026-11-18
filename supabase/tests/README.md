# اختبارات الصلاحيات

هذه الاختبارات **للمطوّر فقط** ولا تُنفَّذ على Supabase. تشغّل ملفات `supabase/sql` على PostgreSQL محلي، مع محاكاة بسيطة لـ Supabase في `00_supabase_stub.sql` تشمل:

- مخطط `auth`؛
- الدالة `auth.uid()`؛
- الدورين `anon` و`authenticated`.

بعد ذلك تتحقق من 45 حالة، منها:

- كل دور يرى ويعدّل ما يحق له فقط؛
- قفل التعديل للمهندس؛
- الحذف الناعم للمدير فقط؛
- منع الحذف الفعلي حتى للمدير؛
- السجل التلقائي؛
- منع المدير من تغيير دوره بنفسه؛
- القيود على التواريخ والحالات.

## التشغيل

```bash
# خادم PostgreSQL 16 مؤقت
mkdir -p /var/tmp/pgtest && chown postgres /var/tmp/pgtest
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/tmp/pgtest/data"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgtest/data -o '-k /var/tmp/pgtest -p 5544 -c listen_addresses=' -l /var/tmp/pgtest/log start"

P="psql -h /var/tmp/pgtest -p 5544 -U postgres -X -q -v ON_ERROR_STOP=1"
$P -c "create database t"
$P -d t -f supabase/tests/00_supabase_stub.sql
for f in supabase/sql/0[1-4]*.sql supabase/sql/0[7-9]*.sql supabase/sql/1[0-9]*.sql; do $P -d t -f "$f"; done

python3 supabase/tests/run_tests.py
```

## اختبار دوال Edge

`sh supabase/tests/functions/run.sh` يشغّل دالتي `admin-users` و`auth-login` على محاكاة لخدمة الدخول وقاعدة البيانات، ويتحقق من:
- الدخول بالرقم المدني أو الوظيفي، وبالبريد؛
- إضافة الرقم وتغييره؛
- البريد الداخلي؛
- رفض التكرار.

## اختبارات رمز المهمة والدمج (2.0.0)
`run_dev_tests.py` يختبر `16_task_code.sql` و`17_import_merge.sql` (رمز المهمة، رمز المهندس، الاستيراد، المرجع، نسخة الإنتاج) لكل سكيما:

```bash
$P -c "create database td"
$P -d td -f supabase/tests/00_supabase_stub.sql
$P -d td -f supabase/staging/setup_staging.sql
$P -d td -f supabase/dev/setup_dev.sql
for s in support_tasks_staging support_tasks_dev; do TEST_DB=td TEST_SCHEMA=$s python3 supabase/tests/run_dev_tests.py; done
# والإنتاج: على قاعدة الاختبارات الأساسية t بعد run_tests.py
TEST_DB=t TEST_SCHEMA=support_tasks python3 supabase/tests/run_dev_tests.py
```


## اختبارات الهيكل التنظيمي (2.1.0-dev)
`run_org_tests.py` يختبر `supabase/dev/sql/18_org_structure.sql` (58 حالة): المستويات، والإضافة تحت الأم الصحيحة فقط، والنقل ومنع الدوران،
وتغيير المستوى، والتعطيل المتسلسل والتفعيل، والحذف، والصلاحيات، والسجل. على قاعدة `td` نفسها بعد `setup_dev.sql`:

```bash
TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_org_tests.py
```

## اختبارات الموظفين والإسناد (2.1.0-dev.6)
`run_employee_tests.py` يختبر `supabase/dev/sql/19_employees.sql` و`20_employees_review.sql` (60 حالة): الموظفون والرقم المدني، والأنواع، وقواعد الإسناد والرئاسة،
والنقل، وإنهاء الخدمة، والحذف، والاستيراد، وربط المستخدمين، والسجل:

```bash
TEST_DB=td TEST_SCHEMA=support_tasks_dev python3 supabase/tests/run_employee_tests.py
```
