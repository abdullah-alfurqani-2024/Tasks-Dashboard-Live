-- =====================================================================
--  نظام مهام الدعم الفني — 04: القيم الأولية
--  يُنفَّذ بعد 03_security.sql. يمكن تعديل القوائم لاحقاً من شاشة «القوائم»
-- =====================================================================

-- قوائم القسم (تُعدَّل لاحقاً من شاشة «القوائم»)
insert into support_tasks.task_types (name, sort_order) values
  ('مراسلة', 1), ('طلب خدمة', 2), ('اتصال', 3), ('طلب مباشر', 4), ('تكليف مباشر', 5), ('أخرى', 6)
on conflict (name) do nothing;

insert into support_tasks.correspondence_types (name, sort_order) values
  ('المواصفات الفنية', 1), ('التحليل والتقييم', 2), ('أخرى', 3)
on conflict (name) do nothing;

-- kind: done = مكتملة (تحتاج تاريخ انتهاء وتدخل في نسبة الإنجاز)، open = مفتوحة (تُحسب في المتأخرة)،
--       cancelled = مغلقة بدون إنجاز (لا تدخل في نسبة الإنجاز ولا في المتأخرة)
insert into support_tasks.task_statuses (name, kind, sort_order) values
  ('مكتمل', 'done', 1), ('غير مكتمل', 'open', 2), ('قائمة الانتظار', 'open', 3), ('إعادة تحويل', 'cancelled', 4)
on conflict (name) do nothing;

insert into support_tasks.app_settings (key, value) values
  ('edit_lock_days', '0'),          -- قفل تعديل المهمة المكتملة بعد عدد أيام (0 = بدون قفل)
  ('delay_threshold_days', '7'),    -- مهمة أطول من هذا تُعدّ متأخرة في التقارير
  ('min_password_length', '6'),     -- أقل طول لكلمة المرور (6 = أقل ما تقبله Supabase)
  ('force_password_change', 'true') -- إلزام تغيير كلمة المرور التي يضعها المدير عند أول دخول
on conflict (key) do nothing;
