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
for f in supabase/sql/0[1-4]*.sql; do $P -d t -f "$f"; done

python3 supabase/tests/run_tests.py
```
