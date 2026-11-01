-- =====================================================================
--  نظام مهام الدعم الفني — 06: ضبط القوائم على قوائم القسم
--  يُنفَّذ مرة واحدة في SQL Editor (ويمكن إعادة تنفيذه بلا ضرر)
--
--  1) يضيف قيم القسم ويرتّبها ويفعّلها
--  2) يحذف أي قيمة أخرى غير مستخدمة في أي مهمة (مثل القيم الأولية القديمة)
--  3) القيمة الأخرى المستخدمة في مهام لا تُحذف، بل تُعطَّل (تختفي من الإدخال الجديد)
--     وتظهر في النتيجة آخر الملف لتقرر بشأنها
-- =====================================================================

begin;

-- ---------- نوع المهمة ----------
insert into support_tasks.task_types (name, sort_order, is_active)
select name, ord, true from (values
  ('مراسلة', 1), ('طلب خدمة', 2), ('اتصال', 3), ('طلب مباشر', 4), ('تكليف مباشر', 5), ('أخرى', 6)
) v(name, ord)
on conflict (name) do update set sort_order = excluded.sort_order, is_active = true;

delete from support_tasks.task_types x
where x.name not in ('مراسلة', 'طلب خدمة', 'اتصال', 'طلب مباشر', 'تكليف مباشر', 'أخرى')
  and not exists (select 1 from support_tasks.tasks t where t.task_type_id = x.id);

update support_tasks.task_types set is_active = false, sort_order = 100
where name not in ('مراسلة', 'طلب خدمة', 'اتصال', 'طلب مباشر', 'تكليف مباشر', 'أخرى');

-- ---------- نوع المراسلة ----------
insert into support_tasks.correspondence_types (name, sort_order, is_active)
select name, ord, true from (values
  ('المواصفات الفنية', 1), ('التحليل والتقييم', 2), ('أخرى', 3)
) v(name, ord)
on conflict (name) do update set sort_order = excluded.sort_order, is_active = true;

delete from support_tasks.correspondence_types x
where x.name not in ('المواصفات الفنية', 'التحليل والتقييم', 'أخرى')
  and not exists (select 1 from support_tasks.tasks t where t.correspondence_type_id = x.id);

update support_tasks.correspondence_types set is_active = false, sort_order = 100
where name not in ('المواصفات الفنية', 'التحليل والتقييم', 'أخرى');

-- ---------- الحالة ----------
insert into support_tasks.task_statuses (name, kind, sort_order, is_active)
select name, kind::support_tasks.status_kind, ord, true from (values
  ('مكتمل', 'done', 1), ('غير مكتمل', 'open', 2), ('قائمة الانتظار', 'open', 3), ('إعادة تحويل', 'cancelled', 4)
) v(name, kind, ord)
on conflict (name) do update set kind = excluded.kind, sort_order = excluded.sort_order, is_active = true;

delete from support_tasks.task_statuses x
where x.name not in ('مكتمل', 'غير مكتمل', 'قائمة الانتظار', 'إعادة تحويل')
  and not exists (select 1 from support_tasks.tasks t where t.status_id = x.id);

update support_tasks.task_statuses set is_active = false, sort_order = 100
where name not in ('مكتمل', 'غير مكتمل', 'قائمة الانتظار', 'إعادة تحويل');

commit;

-- ---------- النتيجة: القوائم الآن، وعدد المهام لكل قيمة ----------
select 'نوع المهمة' as القائمة, x.name as القيمة, x.is_active as مفعّلة,
       (select count(*) from support_tasks.tasks t where t.task_type_id = x.id) as عدد_المهام
from support_tasks.task_types x
union all
select 'نوع المراسلة', x.name, x.is_active,
       (select count(*) from support_tasks.tasks t where t.correspondence_type_id = x.id)
from support_tasks.correspondence_types x
union all
select 'الحالة', x.name || ' (' || x.kind || ')', x.is_active,
       (select count(*) from support_tasks.tasks t where t.status_id = x.id)
from support_tasks.task_statuses x
order by 1, 3 desc, 2;
