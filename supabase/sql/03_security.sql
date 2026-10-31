-- =====================================================================
--  نظام مهام الدعم الفني — 03: الصلاحيات (Row Level Security)
--  يُنفَّذ بعد 02_functions.sql
--  كل صلاحية تُفرض هنا داخل قاعدة البيانات، فلا يمكن تجاوزها من المتصفح
-- =====================================================================

alter table public.profiles             enable row level security;
alter table public.task_types           enable row level security;
alter table public.correspondence_types enable row level security;
alter table public.task_statuses        enable row level security;
alter table public.tasks                enable row level security;
alter table public.app_settings         enable row level security;
alter table public.task_audit           enable row level security;

-- الزائر غير المسجّل لا يرى شيئاً
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;

grant select                 on public.profiles, public.v_tasks, public.task_audit to authenticated;
grant update (full_name, short_name, role, is_active) on public.profiles to authenticated;
grant select, insert, update on public.task_types, public.correspondence_types, public.task_statuses to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert, update on public.app_settings to authenticated;
grant execute on function public.soft_delete_task(bigint), public.restore_task(bigint),
                          public.mark_password_changed(), public.app_role() to authenticated;

-- ---------------- المستخدمون ----------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.app_role() in ('admin', 'head', 'viewer'));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
-- الإضافة تتم من دالة admin-users (مفتاح الخادم) فقط

-- ---------------- القوائم ----------------
drop policy if exists task_types_select on public.task_types;
create policy task_types_select on public.task_types for select to authenticated using (public.app_role() is not null);
drop policy if exists task_types_write on public.task_types;
create policy task_types_write on public.task_types for insert to authenticated with check (public.app_role() in ('admin', 'head'));
drop policy if exists task_types_update on public.task_types;
create policy task_types_update on public.task_types for update to authenticated
  using (public.app_role() in ('admin', 'head')) with check (public.app_role() in ('admin', 'head'));

drop policy if exists corr_types_select on public.correspondence_types;
create policy corr_types_select on public.correspondence_types for select to authenticated using (public.app_role() is not null);
drop policy if exists corr_types_write on public.correspondence_types;
create policy corr_types_write on public.correspondence_types for insert to authenticated with check (public.app_role() in ('admin', 'head'));
drop policy if exists corr_types_update on public.correspondence_types;
create policy corr_types_update on public.correspondence_types for update to authenticated
  using (public.app_role() in ('admin', 'head')) with check (public.app_role() in ('admin', 'head'));

drop policy if exists statuses_select on public.task_statuses;
create policy statuses_select on public.task_statuses for select to authenticated using (public.app_role() is not null);
drop policy if exists statuses_write on public.task_statuses;
create policy statuses_write on public.task_statuses for insert to authenticated with check (public.app_role() in ('admin', 'head'));
drop policy if exists statuses_update on public.task_statuses;
create policy statuses_update on public.task_statuses for update to authenticated
  using (public.app_role() in ('admin', 'head')) with check (public.app_role() in ('admin', 'head'));

-- ---------------- المهام ----------------
-- القراءة: المهندس مهامه، والمدير ورئيس القسم والمشاهد كل المهام. المحذوفة يراها المدير فقط
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    (deleted_at is null and (engineer_id = auth.uid() or public.app_role() in ('admin', 'head', 'viewer')))
    or public.app_role() = 'admin'
  );

-- الإضافة: المهندس لنفسه، والمدير ورئيس القسم لأي مهندس
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    public.app_role() in ('admin', 'head')
    or (public.app_role() = 'engineer' and engineer_id = auth.uid())
  );

-- التعديل: المهندس مهامه غير المحذوفة، والمدير ورئيس القسم كل المهام (الحذف عبر الدالة فقط)
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    public.app_role() = 'admin'
    or (deleted_at is null and public.app_role() = 'head')
    or (deleted_at is null and public.app_role() = 'engineer' and engineer_id = auth.uid())
  )
  with check (
    public.app_role() in ('admin', 'head')
    or (public.app_role() = 'engineer' and engineer_id = auth.uid())
  );
-- لا توجد سياسة DELETE: لا يُحذف أي صف فعلياً

-- ---------------- الإعدادات ----------------
drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (public.app_role() is not null);
drop policy if exists settings_insert on public.app_settings;
create policy settings_insert on public.app_settings for insert to authenticated with check (public.app_role() = 'admin');
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update to authenticated
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- ---------------- سجل التعديلات ----------------
drop policy if exists audit_select on public.task_audit;
create policy audit_select on public.task_audit for select to authenticated
  using (public.app_role() in ('admin', 'head'));
-- الكتابة من المشغّل فقط
