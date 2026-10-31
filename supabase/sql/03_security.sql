-- =====================================================================
--  نظام مهام الدعم الفني — 03: الصلاحيات (Row Level Security)
--  يُنفَّذ بعد 02_functions.sql
--  كل صلاحية تُفرض هنا داخل قاعدة البيانات، فلا يمكن تجاوزها من المتصفح
-- =====================================================================

alter table support_tasks.profiles             enable row level security;
alter table support_tasks.task_types           enable row level security;
alter table support_tasks.correspondence_types enable row level security;
alter table support_tasks.task_statuses        enable row level security;
alter table support_tasks.tasks                enable row level security;
alter table support_tasks.app_settings         enable row level security;
alter table support_tasks.task_audit           enable row level security;

-- السكيما: المستخدم المسجّل ودالة الخادم فقط (الزائر غير المسجّل لا يرى شيئاً)
grant usage on schema support_tasks to authenticated, service_role;
revoke all on schema support_tasks from anon;
revoke all on all tables    in schema support_tasks from anon;
revoke all on all functions in schema support_tasks from public, anon;
grant execute on all functions in schema support_tasks to authenticated, service_role;

-- دالة admin-users تعمل بمفتاح service_role (يتجاوز RLS لكنه يحتاج صلاحية الجداول في السكيما الخاصة)
grant all on all tables in schema support_tasks to service_role;
grant usage, select on all sequences in schema support_tasks to service_role;

grant select                 on support_tasks.profiles, support_tasks.v_tasks, support_tasks.task_audit to authenticated;
grant update (full_name, short_name, role, is_active) on support_tasks.profiles to authenticated;
grant select, insert, update on support_tasks.task_types, support_tasks.correspondence_types, support_tasks.task_statuses to authenticated;
grant select, insert, update on support_tasks.tasks to authenticated;
grant select, insert, update on support_tasks.app_settings to authenticated;
grant execute on function support_tasks.soft_delete_task(bigint), support_tasks.restore_task(bigint),
                          support_tasks.mark_password_changed(), support_tasks.app_role() to authenticated;

-- ---------------- المستخدمون ----------------
drop policy if exists profiles_select on support_tasks.profiles;
create policy profiles_select on support_tasks.profiles for select to authenticated
  using (id = auth.uid() or support_tasks.app_role() in ('admin', 'head', 'viewer'));

drop policy if exists profiles_update on support_tasks.profiles;
create policy profiles_update on support_tasks.profiles for update to authenticated
  using (support_tasks.app_role() = 'admin') with check (support_tasks.app_role() = 'admin');
-- الإضافة تتم من دالة admin-users (مفتاح الخادم) فقط

-- ---------------- القوائم ----------------
drop policy if exists task_types_select on support_tasks.task_types;
create policy task_types_select on support_tasks.task_types for select to authenticated using (support_tasks.app_role() is not null);
drop policy if exists task_types_write on support_tasks.task_types;
create policy task_types_write on support_tasks.task_types for insert to authenticated with check (support_tasks.app_role() in ('admin', 'head'));
drop policy if exists task_types_update on support_tasks.task_types;
create policy task_types_update on support_tasks.task_types for update to authenticated
  using (support_tasks.app_role() in ('admin', 'head')) with check (support_tasks.app_role() in ('admin', 'head'));

drop policy if exists corr_types_select on support_tasks.correspondence_types;
create policy corr_types_select on support_tasks.correspondence_types for select to authenticated using (support_tasks.app_role() is not null);
drop policy if exists corr_types_write on support_tasks.correspondence_types;
create policy corr_types_write on support_tasks.correspondence_types for insert to authenticated with check (support_tasks.app_role() in ('admin', 'head'));
drop policy if exists corr_types_update on support_tasks.correspondence_types;
create policy corr_types_update on support_tasks.correspondence_types for update to authenticated
  using (support_tasks.app_role() in ('admin', 'head')) with check (support_tasks.app_role() in ('admin', 'head'));

drop policy if exists statuses_select on support_tasks.task_statuses;
create policy statuses_select on support_tasks.task_statuses for select to authenticated using (support_tasks.app_role() is not null);
drop policy if exists statuses_write on support_tasks.task_statuses;
create policy statuses_write on support_tasks.task_statuses for insert to authenticated with check (support_tasks.app_role() in ('admin', 'head'));
drop policy if exists statuses_update on support_tasks.task_statuses;
create policy statuses_update on support_tasks.task_statuses for update to authenticated
  using (support_tasks.app_role() in ('admin', 'head')) with check (support_tasks.app_role() in ('admin', 'head'));

-- ---------------- المهام ----------------
-- القراءة: المهندس مهامه، والمدير ورئيس القسم والمشاهد كل المهام. المحذوفة يراها المدير فقط
drop policy if exists tasks_select on support_tasks.tasks;
create policy tasks_select on support_tasks.tasks for select to authenticated
  using (
    (deleted_at is null and (engineer_id = auth.uid() or support_tasks.app_role() in ('admin', 'head', 'viewer')))
    or support_tasks.app_role() = 'admin'
  );

-- الإضافة: المهندس لنفسه، والمدير ورئيس القسم لأي مهندس
drop policy if exists tasks_insert on support_tasks.tasks;
create policy tasks_insert on support_tasks.tasks for insert to authenticated
  with check (
    support_tasks.app_role() in ('admin', 'head')
    or (support_tasks.app_role() = 'engineer' and engineer_id = auth.uid())
  );

-- التعديل: المهندس مهامه غير المحذوفة، والمدير ورئيس القسم كل المهام (الحذف عبر الدالة فقط)
drop policy if exists tasks_update on support_tasks.tasks;
create policy tasks_update on support_tasks.tasks for update to authenticated
  using (
    support_tasks.app_role() = 'admin'
    or (deleted_at is null and support_tasks.app_role() = 'head')
    or (deleted_at is null and support_tasks.app_role() = 'engineer' and engineer_id = auth.uid())
  )
  with check (
    support_tasks.app_role() in ('admin', 'head')
    or (support_tasks.app_role() = 'engineer' and engineer_id = auth.uid())
  );
-- لا توجد سياسة DELETE: لا يُحذف أي صف فعلياً

-- ---------------- الإعدادات ----------------
drop policy if exists settings_select on support_tasks.app_settings;
create policy settings_select on support_tasks.app_settings for select to authenticated using (support_tasks.app_role() is not null);
drop policy if exists settings_insert on support_tasks.app_settings;
create policy settings_insert on support_tasks.app_settings for insert to authenticated with check (support_tasks.app_role() = 'admin');
drop policy if exists settings_update on support_tasks.app_settings;
create policy settings_update on support_tasks.app_settings for update to authenticated
  using (support_tasks.app_role() = 'admin') with check (support_tasks.app_role() = 'admin');

-- ---------------- سجل التعديلات ----------------
drop policy if exists audit_select on support_tasks.task_audit;
create policy audit_select on support_tasks.task_audit for select to authenticated
  using (support_tasks.app_role() in ('admin', 'head'));
-- الكتابة من المشغّل فقط
