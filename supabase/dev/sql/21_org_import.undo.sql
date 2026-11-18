-- =====================================================================
--  تراجع عن 21_org_import.sql (سكيما التطوير وحدها): يحذف دوال حذف الهيكل واستيراده فقط، والبيانات تبقى.
--  بعده: نفّذ 19_employees.sql ثم 20_employees_review.sql مرة أخرى لاسترجاع مشغّل حذف الوحدة كما كان (آمن).
--  يُنفَّذ في Tasks-Test ← SQL Editor.
-- =====================================================================

drop function if exists support_tasks_dev.org_import(jsonb, boolean);
drop function if exists support_tasks_dev.org_purge();
drop function if exists support_tasks_dev.org_purge_inner();

select count(*) as دوال_الاستيراد_الباقية
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'support_tasks_dev' and p.proname in ('org_import', 'org_purge', 'org_purge_inner');
