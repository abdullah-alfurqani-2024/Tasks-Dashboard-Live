-- =====================================================================
--  نظام مهام الدعم الفني — 04: القيم الأولية
--  يُنفَّذ بعد 03_security.sql. يمكن تعديل القوائم لاحقاً من شاشة «القوائم»
-- =====================================================================

insert into public.task_types (name, sort_order) values
  ('صيانة أجهزة', 1), ('تركيب أجهزة جديدة', 2), ('تثبيت وتحديث البرامج', 3), ('دعم فني للبرامج', 4),
  ('فورمات وإعادة تثبيت النظام', 5), ('شبكات واتصال', 6), ('طابعات', 7), ('حسابات وصلاحيات', 8),
  ('بريد إلكتروني', 9), ('أخرى', 10)
on conflict (name) do nothing;

insert into public.correspondence_types (name, sort_order) values
  ('مراسلة', 1), ('طلب خدمة', 2), ('اتصال', 3), ('حضور مباشر', 4), ('تكليف مباشر', 5)
on conflict (name) do nothing;

insert into public.task_statuses (name, kind, sort_order) values
  ('قيد التنفيذ', 'open', 1), ('غير مكتمل', 'open', 2), ('مكتمل', 'done', 3), ('ملغي', 'cancelled', 4)
on conflict (name) do nothing;

insert into public.app_settings (key, value) values
  ('edit_lock_days', '0'),          -- قفل تعديل المهمة المكتملة بعد عدد أيام (0 = بدون قفل)
  ('delay_threshold_days', '7')     -- مهمة أطول من هذا تُعدّ متأخرة في التقارير
on conflict (key) do nothing;
