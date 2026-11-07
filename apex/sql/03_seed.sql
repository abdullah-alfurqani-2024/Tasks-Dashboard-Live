-- =====================================================================
--  نظام مهام الدعم الفني — نسخة Oracle APEX
--  03: القيم الأولية (مقابل supabase/sql/04_seed.sql + 09 + 14 + 15)
--  يُنفَّذ بعد 02_api.sql. يمكن تعديل القوائم لاحقاً من شاشة «القوائم».
--  «تحديث بيانات التجربة من الإنتاج» في صفحة الإعدادات يستبدل هذه القيم بقيم الإنتاج.
-- =====================================================================

insert into st_task_types (name, sort_order)
select name, ord from (
  select 'مراسلة' name, 1 ord from dual union all select 'طلب خدمة', 2 from dual union all
  select 'اتصال', 3 from dual union all select 'طلب مباشر', 4 from dual union all
  select 'تكليف مباشر', 5 from dual union all select 'أخرى', 6 from dual) v
where not exists (select 1 from st_task_types t where t.name = v.name);

insert into st_correspondence_types (name, sort_order)
select name, ord from (
  select 'المواصفات الفنية' name, 1 ord from dual union all select 'التحليل والتقييم', 2 from dual union all
  select 'أخرى', 3 from dual) v
where not exists (select 1 from st_correspondence_types t where t.name = v.name);

-- kind: done = مكتملة (تحتاج تاريخ انتهاء وتدخل في نسبة الإنجاز)، open = مفتوحة (تُحسب في المتأخرة)،
--       cancelled = مغلقة بدون إنجاز (لا تدخل في نسبة الإنجاز ولا في المتأخرة)
insert into st_task_statuses (name, kind, sort_order)
select name, kind, ord from (
  select 'مكتمل' name, 'done' kind, 1 ord from dual union all select 'غير مكتمل', 'open', 2 from dual union all
  select 'قائمة الانتظار', 'open', 3 from dual union all select 'إعادة تحويل', 'cancelled', 4 from dual) v
where not exists (select 1 from st_task_statuses t where t.name = v.name);

-- الإعدادات (القيمة نص JSON)
insert into st_app_settings (setting_key, setting_value)
select k, v from (
  select 'edit_lock_days' k, '0' v from dual union all          -- قفل تعديل المهمة المكتملة بعد عدد أيام (0 = بدون قفل)
  select 'delay_threshold_days', '7' from dual union all        -- مهمة مفتوحة أطول من هذا تُعدّ متأخرة
  select 'min_password_length', '6' from dual union all         -- أقل طول لكلمة المرور
  select 'force_password_change', 'false' from dual union all   -- إلزام تغيير كلمة المرور التي يضعها المدير (مطفأ في APEX)
  select 'allow_purge_tasks', 'true' from dual union all
  select 'announcement', '""' from dual union all
  select 'announcement_type', '"normal"' from dual union all
  select 'announcement_expires_at', '""' from dual) x
where not exists (select 1 from st_app_settings s where s.setting_key = x.k);

commit;
