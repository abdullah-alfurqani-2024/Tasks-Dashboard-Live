-- =====================================================================
--  نظام مهام الدعم الفني — 10: «مهام تحتاج مراجعة»
--
--  الاستيراد يأخذ كل الصفوف، والصف الذي فيه مشكلة (تاريخ غير مفهوم، مكررة محتملة…)
--  يُحفظ مع أسباب المراجعة في عمود review_reasons، ليصلحه المهندس لاحقاً ويضغط «تمت المراجعة».
--    review_reasons = null  ← لا تحتاج مراجعة
--
--  للسكيمتين (الإنتاج والتجربة) معاً. إضافة فقط: لا يؤثر على النسخة الحالية من الواجهة.
--  يمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================

do $do$
declare
  s text;
begin
  foreach s in array array['support_tasks', 'support_tasks_staging'] loop
    if to_regclass(s || '.tasks') is null then continue; end if;

    execute format('alter table %I.tasks add column if not exists review_reasons text[]', s);
    execute format('create index if not exists tasks_review_idx on %I.tasks (engineer_id) where review_reasons is not null and deleted_at is null', s);

    -- عرض المهام: نفس الأعمدة السابقة + review_reasons في آخره
    -- (حذف ثم إنشاء: يُعاد بناؤه مع الأعمدة الأحدث في ملفات لاحقة مثل 13)
    if not exists (select 1 from information_schema.columns where table_schema = s and table_name = 'v_tasks' and column_name = 'review_reasons') then
    execute format($v$
      create or replace view %1$I.v_tasks
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
        t.review_reasons
      from %1$I.tasks t
      join %1$I.profiles p             on p.id = t.engineer_id
      left join %1$I.task_types tt     on tt.id = t.task_type_id
      left join %1$I.correspondence_types ct on ct.id = t.correspondence_type_id
      join %1$I.task_statuses s        on s.id = t.status_id$v$, s);
    end if;

    -- أسباب المراجعة يضعها الاستيراد (مدير النظام) فقط؛ غيره يستطيع مسحها («تمت المراجعة») لا إضافتها
    execute format($f$
      create or replace function %1$I.tasks_review_guard()
      returns trigger
      language plpgsql security definer
      set search_path = %1$I
      as $b$
      begin
        new.review_reasons := nullif(new.review_reasons, '{}');
        if %1$I.app_role() is distinct from 'admin' and auth.uid() is not null
           and new.review_reasons is not null
           and new.review_reasons is distinct from (case when tg_op = 'UPDATE' then old.review_reasons end) then
          perform %1$I.app_error('أسباب المراجعة يضعها الاستيراد فقط.');
        end if;
        return new;
      end $b$
    $f$, s);
    execute format('revoke all on function %I.tasks_review_guard() from public, anon', s);
    execute format('drop trigger if exists tasks_review_guard on %I.tasks', s);
    execute format('create trigger tasks_review_guard before insert or update on %1$I.tasks for each row execute function %1$I.tasks_review_guard()', s);
  end loop;
end $do$;

-- التحقق: يجب أن يظهر سطر لكل سكيما
select table_schema, column_name, data_type
from information_schema.columns
where table_name = 'v_tasks' and column_name = 'review_reasons'
order by table_schema;
