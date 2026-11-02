-- =====================================================================
--  نظام مهام الدعم الفني — 09: «حذف كل المهام» في الإنتاج
--
--  لمرحلة التجهيز: حذف كل المهام ثم استيراد ملف Excel من جديد.
--  - لمدير النظام فقط.
--  - يعمل فقط ما دام إعداد «السماح بحذف كل المهام» مفعّلاً (allow_purge_tasks).
--    عند بدء العمل الفعلي أطفئه من صفحة الإعدادات، فيرفض الخادم الحذف نهائياً.
--  - الواجهة تنزّل نسخة Excel من المهام قبل الحذف.
--  يُنفَّذ مرة واحدة في SQL Editor، ويمكن إعادة تنفيذه بلا ضرر.
--  (نسخة التجربة لها دالتها الخاصة في supabase/staging/purge_tasks.sql بلا هذا الإعداد)
--  @production-only: لا يُضاف إلى ملف التجربة setup_staging.sql
-- =====================================================================

-- الإعداد: مفعّل الآن (لا يغيّر قيمته إن كان موجوداً)
insert into support_tasks.app_settings (key, value) values ('allow_purge_tasks', 'true')
on conflict (key) do nothing;

create or replace function support_tasks.purge_all_tasks()
returns jsonb
language plpgsql
security definer
set search_path = support_tasks
as $$
declare
  v_tasks int;
begin
  if support_tasks.app_role() is distinct from 'admin' then
    perform support_tasks.app_error('حذف كل المهام لمدير النظام فقط.');
  end if;
  if coalesce((select value from support_tasks.app_settings where key = 'allow_purge_tasks'), 'false'::jsonb)
     not in ('true'::jsonb, '"true"'::jsonb) then
    perform support_tasks.app_error('حذف كل المهام موقوف. فعّل «السماح بحذف كل المهام» من الإعدادات أولاً.');
  end if;
  select count(*) into v_tasks from support_tasks.tasks;
  -- TRUNCATE وليس DELETE: Supabase يمنع DELETE بلا شرط، وهو أسرع، ويعيد ترقيم المهام من 1
  truncate support_tasks.task_audit, support_tasks.tasks restart identity;
  return jsonb_build_object('tasks', v_tasks, 'at', now());
end $$;

revoke all on function support_tasks.purge_all_tasks() from public, anon;
grant execute on function support_tasks.purge_all_tasks() to authenticated;

-- التحقق: يجب أن يظهر سطر واحد بالقيمة true
select key, value from support_tasks.app_settings where key = 'allow_purge_tasks';
