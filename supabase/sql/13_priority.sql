-- =====================================================================
--  نظام مهام الدعم الفني — 13: أولوية المهمة (عادية / عاجلة)
--
--  يضيف عمود priority للمهام: 'normal' (عادية، الافتراضي) أو 'urgent' (عاجلة).
--  المهام الحالية كلها تصبح «عادية».
--  للسكيمتين معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة، فيُنفَّذ قبل نقل الإصدار.
--  يُنفَّذ في مشروع التجربة أولاً، ثم في مشروع الإنتاج. يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;

    execute format($q$alter table %I.tasks add column if not exists priority text not null default 'normal'$q$, s);
    if not exists (select 1 from pg_constraint where conname = 'tasks_priority_chk' and conrelid = (s || '.tasks')::regclass) then
      execute format($q$alter table %I.tasks add constraint tasks_priority_chk check (priority in ('normal', 'urgent'))$q$, s);
    end if;
    execute format($q$create index if not exists tasks_urgent_idx on %I.tasks (engineer_id) where priority = 'urgent' and deleted_at is null$q$, s);

    -- عرض المهام: نفس الأعمدة + priority في آخره
    execute format('drop view if exists %I.v_tasks', s);
    execute format($v$
      create view %1$I.v_tasks
      with (security_invoker = true) as
      select
        t.id, t.engineer_id, p.full_name as engineer_name, p.short_name as engineer_short,
        t.ref_no, t.requester, t.employee_name, t.subject,
        t.received_date, t.completed_date, t.notes,
        t.task_type_id, tt.name as task_type,
        t.correspondence_type_id, ct.name as correspondence_type,
        t.status_id, s.name as status, s.kind as status_kind,
        t.delay_reason, t.duration_days,
        t.created_at, t.created_by, t.updated_at, t.updated_by,
        t.deleted_at, t.deleted_by,
        t.review_reasons,
        t.priority
      from %1$I.tasks t
      join %1$I.profiles p             on p.id = t.engineer_id
      left join %1$I.task_types tt     on tt.id = t.task_type_id
      left join %1$I.correspondence_types ct on ct.id = t.correspondence_type_id
      join %1$I.task_statuses s        on s.id = t.status_id$v$, s);
    execute format('grant select on %I.v_tasks to authenticated', s);
    execute format('grant all on %I.v_tasks to service_role', s);
  end loop;
end $do$;

-- التحقق: يجب أن يظهر سطر لكل سكيما في هذا المشروع (مشروع الإنتاج: support_tasks، مشروع التجربة: support_tasks_staging)
select table_schema, column_name, column_default
from information_schema.columns
where table_name = 'v_tasks' and column_name = 'priority'
order by table_schema;
