-- =====================================================================
--  نسخة التجربة: دالة «حذف كل المهام» (زر في صفحة الإعدادات)
--  تُنفَّذ مرة واحدة في SQL Editor (وهي ضمن setup_staging.sql أيضاً)
--
--  تحذف نهائياً كل مهام التجربة وسجل تعديلاتها، لإعادة الاستيراد من جديد.
--  لا تمس المستخدمين ولا القوائم ولا الإعدادات، ولا تمس الإنتاج أبداً.
--  لا توجد نسخة من هذه الدالة في سكيما الإنتاج.
-- =====================================================================

create or replace function support_tasks_staging.purge_all_tasks()
returns jsonb
language plpgsql
security definer
set search_path = support_tasks_staging
as $$
declare
  v_tasks int;
begin
  if support_tasks_staging.app_role() is distinct from 'admin' then
    perform support_tasks_staging.app_error('حذف كل المهام لمدير النظام فقط.');
  end if;
  select count(*) into v_tasks from support_tasks_staging.tasks;
  -- TRUNCATE وليس DELETE: Supabase يمنع DELETE بلا شرط، وهو أسرع، ويعيد ترقيم المهام من 1
  truncate support_tasks_staging.task_audit, support_tasks_staging.tasks restart identity;
  return jsonb_build_object('tasks', v_tasks, 'at', now());
end $$;

revoke all on function support_tasks_staging.purge_all_tasks() from public, anon;
grant execute on function support_tasks_staging.purge_all_tasks() to authenticated;
