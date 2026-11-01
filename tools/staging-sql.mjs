// يولّد supabase/staging/setup_staging.sql من ملفات الإنتاج 01-04 بتغيير اسم السكيما
// الاستخدام: node tools/staging-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const PROD = 'support_tasks', STG = 'support_tasks_staging';
const parts = ['01_schema.sql', '02_functions.sql', '03_security.sql', '04_seed.sql']
  .map((f) => `-- ===================== ${f} =====================\n` + readFileSync(join(root, 'supabase/sql', f), 'utf8').replaceAll(PROD, STG));

const header = `-- =====================================================================
--  نسخة التجربة: سكيما ${STG}
--  ملف مولَّد تلقائياً من supabase/sql/01-04 (لا تعدّله يدوياً: node tools/staging-sql.mjs)
--
--  يُنفَّذ في Supabase ← SQL Editor مرة واحدة، ثم:
--    Project Settings ← Data API ← Exposed schemas: أضف ${STG}
--  ويمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================
`;

const copy = `
-- =====================================================================
--  نسخ البيانات من الإنتاج إلى التجربة (قراءة فقط من الإنتاج)
--  تستطيع إعادة تنفيذ هذا الجزء وحده متى أردت تحديث بيانات التجربة
-- =====================================================================
begin;

-- المستخدمون: نفس الحسابات تدخل نسخة التجربة بنفس كلمات المرور
insert into ${STG}.profiles (id, email, full_name, short_name, role, is_active, must_change_password, created_at, updated_at)
select id, email, full_name, short_name, role::text::${STG}.user_role, is_active, false, created_at, updated_at
from ${PROD}.profiles
on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, short_name = excluded.short_name,
  role = excluded.role, is_active = excluded.is_active;

-- القوائم كما هي في الإنتاج
insert into ${STG}.task_types (name, sort_order, is_active)
select name, sort_order, is_active from ${PROD}.task_types
on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
insert into ${STG}.correspondence_types (name, sort_order, is_active)
select name, sort_order, is_active from ${PROD}.correspondence_types
on conflict (name) do update set sort_order = excluded.sort_order, is_active = excluded.is_active;
insert into ${STG}.task_statuses (name, kind, sort_order, is_active)
select name, kind::text::${STG}.status_kind, sort_order, is_active from ${PROD}.task_statuses
on conflict (name) do update set kind = excluded.kind, sort_order = excluded.sort_order, is_active = excluded.is_active;

-- الإعدادات
insert into ${STG}.app_settings (key, value)
select key, value from ${PROD}.app_settings
on conflict (key) do update set value = excluded.value;

-- المهام: نسخة كاملة بنفس الأرقام (تُستبدل مهام التجربة السابقة)
alter table ${STG}.tasks disable trigger user;
truncate ${STG}.task_audit, ${STG}.tasks;
insert into ${STG}.tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date, notes,
  task_type_id, correspondence_type_id, status_id, delay_reason, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
overriding system value
select t.id, t.engineer_id, t.ref_no, t.requester, t.employee_name, t.subject, t.received_date, t.completed_date, t.notes,
  (select s.id from ${STG}.task_types s join ${PROD}.task_types p on p.name = s.name where p.id = t.task_type_id),
  (select s.id from ${STG}.correspondence_types s join ${PROD}.correspondence_types p on p.name = s.name where p.id = t.correspondence_type_id),
  (select s.id from ${STG}.task_statuses s join ${PROD}.task_statuses p on p.name = s.name where p.id = t.status_id),
  t.delay_reason, t.created_at, t.created_by, t.updated_at, t.updated_by, t.deleted_at, t.deleted_by
from ${PROD}.tasks t;
select setval(pg_get_serial_sequence('${STG}.tasks', 'id'), coalesce((select max(id) from ${STG}.tasks), 0) + 1, false);
alter table ${STG}.tasks enable trigger user;

commit;

select 'المستخدمون' as البيان, count(*) as العدد from ${STG}.profiles
union all select 'المهام', count(*) from ${STG}.tasks;
`;

const refresh = '\n' + readFileSync(join(root, 'supabase/staging/refresh_function.sql'), 'utf8');
writeFileSync(join(root, 'supabase/staging/setup_staging.sql'), header + '\n' + parts.join('\n\n') + '\n' + refresh + '\n' + copy);
console.log('written supabase/staging/setup_staging.sql');
