-- =====================================================================
--  نظام مهام الدعم الفني — 02: الدوال والمشغّلات
--  يُنفَّذ بعد 01_schema.sql
--  auth.uid() = معرّف المستخدم الحالي في Supabase (الدالة الوحيدة الخاصة بـ Supabase هنا)
-- =====================================================================

-- دور المستخدم الحالي (null إذا كان الحساب معطّلاً أو غير موجود)
create or replace function support_tasks.app_role()
returns support_tasks.user_role
language sql stable security definer
set search_path = support_tasks
as $$
  select role from support_tasks.profiles where id = auth.uid() and is_active
$$;

-- قيمة إعداد رقمي
create or replace function support_tasks.setting_int(p_key text, p_default int)
returns int
language sql stable security definer
set search_path = support_tasks
as $$
  select coalesce((select (value #>> '{}')::int from support_tasks.app_settings where key = p_key), p_default)
$$;

-- رسالة خطأ واضحة للمستخدم (تظهر كما هي في الواجهة)
create or replace function support_tasks.app_error(p_message text)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_message;
end $$;

-- ---------------------------------------------------------------------
-- قبل حفظ مهمة: القيم التلقائية، والقيود، وقفل التعديل
-- ---------------------------------------------------------------------
create or replace function support_tasks.tasks_before_write()
returns trigger
language plpgsql security definer
set search_path = support_tasks
as $$
declare
  v_role  support_tasks.user_role := support_tasks.app_role();
  v_uid   uuid := auth.uid();
  v_kind  support_tasks.status_kind;
  v_lock  int;
  v_old_kind support_tasks.status_kind;
begin
  if v_role is null and v_uid is not null then
    perform support_tasks.app_error('حسابك غير مفعّل.');
  end if;

  if tg_op = 'INSERT' then
    if v_role is null then                      -- إدخال من خارج التطبيق (مثل محرر SQL)
      new.created_by := coalesce(new.created_by, new.engineer_id);
    else
      if v_role = 'viewer' then
        perform support_tasks.app_error('المشاهد لا يستطيع إضافة مهام.');
      end if;
      if new.engineer_id is null or v_role = 'engineer' then
        new.engineer_id := v_uid;                -- المهندس يضيف لنفسه فقط
      end if;
      new.created_by := v_uid;
    end if;
    new.created_at := now();
    new.updated_at := now();
    new.updated_by := new.created_by;
    new.deleted_at := null;
    new.deleted_by := null;
  else
    -- حقول لا تتغير
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(v_uid, old.updated_by);

    if v_role in ('engineer', 'viewer') then
      if new.engineer_id <> old.engineer_id then
        perform support_tasks.app_error('لا يمكن نقل المهمة إلى مهندس آخر.');
      end if;
      if new.deleted_at is distinct from old.deleted_at then
        perform support_tasks.app_error('الحذف لمدير النظام فقط.');
      end if;
    end if;
    if v_role = 'head' and new.deleted_at is distinct from old.deleted_at then
      perform support_tasks.app_error('الحذف لمدير النظام فقط.');
    end if;

    -- قفل التعديل: مهمة مكتملة مضى على انتهائها أكثر من «مدة القفل» (0 = بدون قفل). لا يُطبَّق على المدير ورئيس القسم
    if v_role = 'engineer' then
      v_lock := support_tasks.setting_int('edit_lock_days', 0);
      select kind into v_old_kind from support_tasks.task_statuses where id = old.status_id;
      if v_lock > 0 and v_old_kind = 'done' and old.completed_date is not null
         and old.completed_date + v_lock < current_date then
        perform support_tasks.app_error('المهمة مقفلة: مضى على إنجازها أكثر من ' || v_lock || ' يوم. اطلب من مدير النظام أو رئيس القسم تعديلها.');
      end if;
    end if;
  end if;

  -- تنظيف النصوص
  new.ref_no        := nullif(btrim(new.ref_no), '');
  new.requester     := nullif(btrim(new.requester), '');
  new.employee_name := nullif(btrim(new.employee_name), '');
  new.subject       := btrim(new.subject);
  new.notes         := nullif(btrim(new.notes), '');
  new.delay_reason  := nullif(btrim(new.delay_reason), '');
  if new.subject is null or new.subject = '' then
    perform support_tasks.app_error('الموضوع مطلوب.');
  end if;

  -- الحالة المكتملة تحتاج تاريخ انتهاء، وغير المكتملة لا تحمل تاريخ انتهاء
  select kind into v_kind from support_tasks.task_statuses where id = new.status_id;
  if v_kind = 'done' and new.completed_date is null then
    perform support_tasks.app_error('المهمة المكتملة تحتاج «تاريخ الانتهاء».');
  end if;
  if v_kind = 'open' then
    new.completed_date := null;
  end if;
  if new.completed_date is not null and new.completed_date < new.received_date then
    perform support_tasks.app_error('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ الاستقبال.');
  end if;

  return new;
end $$;

drop trigger if exists tasks_before_write on support_tasks.tasks;
create trigger tasks_before_write
  before insert or update on support_tasks.tasks
  for each row execute function support_tasks.tasks_before_write();

-- ---------------------------------------------------------------------
-- بعد حفظ مهمة: سجل التعديلات
-- ---------------------------------------------------------------------
create or replace function support_tasks.tasks_audit()
returns trigger
language plpgsql security definer
set search_path = support_tasks
as $$
declare
  v_old jsonb;
  v_new jsonb := to_jsonb(new) - array['updated_at', 'updated_by', 'duration_days'];
  v_fields text[];
  v_action text;
begin
  if tg_op = 'INSERT' then
    insert into support_tasks.task_audit (task_id, action, changed_by, new_data)
    values (new.id, 'insert', new.created_by, v_new);
    return null;
  end if;

  v_old := to_jsonb(old) - array['updated_at', 'updated_by', 'duration_days'];
  select array_agg(k order by k) into v_fields
  from jsonb_object_keys(v_new) k
  where v_new -> k is distinct from v_old -> k;

  if v_fields is null then return null; end if;   -- لا تغيير فعلي

  v_action := case
    when old.deleted_at is null and new.deleted_at is not null then 'delete'
    when old.deleted_at is not null and new.deleted_at is null then 'restore'
    else 'update' end;

  insert into support_tasks.task_audit (task_id, action, changed_by, changed_fields, old_data, new_data)
  values (new.id, v_action, coalesce(auth.uid(), new.updated_by), v_fields,
          (select jsonb_object_agg(k, v_old -> k) from unnest(v_fields) k),
          (select jsonb_object_agg(k, v_new -> k) from unnest(v_fields) k));
  return null;
end $$;

drop trigger if exists tasks_audit on support_tasks.tasks;
create trigger tasks_audit
  after insert or update on support_tasks.tasks
  for each row execute function support_tasks.tasks_audit();

-- ---------------------------------------------------------------------
-- الحذف الناعم والاسترجاع (مدير النظام فقط)
-- ---------------------------------------------------------------------
create or replace function support_tasks.soft_delete_task(p_id bigint)
returns void
language plpgsql security definer
set search_path = support_tasks
as $$
begin
  if support_tasks.app_role() is distinct from 'admin' then
    perform support_tasks.app_error('الحذف لمدير النظام فقط.');
  end if;
  update support_tasks.tasks set deleted_at = now(), deleted_by = auth.uid()
  where id = p_id and deleted_at is null;
end $$;

create or replace function support_tasks.restore_task(p_id bigint)
returns void
language plpgsql security definer
set search_path = support_tasks
as $$
begin
  if support_tasks.app_role() is distinct from 'admin' then
    perform support_tasks.app_error('الاسترجاع لمدير النظام فقط.');
  end if;
  update support_tasks.tasks set deleted_at = null, deleted_by = null
  where id = p_id and deleted_at is not null;
end $$;

-- المستخدم غيّر كلمة المرور المؤقتة
create or replace function support_tasks.mark_password_changed()
returns void
language sql security definer
set search_path = support_tasks
as $$
  update support_tasks.profiles set must_change_password = false, updated_at = now() where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- حماية جدول المستخدمين: لا يستطيع المدير تعطيل نفسه أو إزالة دوره (حتى لا يُقفل النظام)
-- ---------------------------------------------------------------------
create or replace function support_tasks.profiles_before_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.id := old.id;
  if old.id = auth.uid() and (new.role <> old.role or not new.is_active) then
    perform support_tasks.app_error('لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.');
  end if;
  return new;
end $$;

drop trigger if exists profiles_before_update on support_tasks.profiles;
create trigger profiles_before_update
  before update on support_tasks.profiles
  for each row execute function support_tasks.profiles_before_update();

-- ختم وقت تعديل الإعدادات
create or replace function support_tasks.settings_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists settings_before_write on support_tasks.app_settings;
create trigger settings_before_write
  before insert or update on support_tasks.app_settings
  for each row execute function support_tasks.settings_before_write();
