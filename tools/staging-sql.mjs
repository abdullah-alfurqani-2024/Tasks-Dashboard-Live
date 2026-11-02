// يولّد supabase/staging/setup_staging.sql من ملفات الإنتاج 01-04 بتغيير اسم السكيما
// الاستخدام: node tools/staging-sql.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const PROD = 'support_tasks', STG = 'support_tasks_staging';
const parts = ['01_schema.sql', '02_functions.sql', '03_security.sql', '04_seed.sql']
  .map((f) => `-- ===================== ${f} =====================\n` + readFileSync(join(root, 'supabase/sql', f), 'utf8').replaceAll(PROD, STG));

const header = `-- =====================================================================
--  نسخة التجربة: سكيما ${STG}
--  ملف مولَّد تلقائياً من supabase/sql/01-04 (لا تعدّله يدوياً: node tools/staging-sql.mjs)
--
--  يُنفَّذ في Supabase ← SQL Editor (مشروع التجربة) مرة واحدة، ثم:
--    Project Settings ← Data API ← Exposed schemas: أضف ${STG}
--  البيانات تُنسخ من الإنتاج (مشروع مستقل) بزر «تحديث بيانات التجربة من الإنتاج» (دالة refresh-staging).
--  ويمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================
`;


// ملفات التعديل اللاحقة (07 فما بعد) تعالج السكيمتين بنفسها، فتُضاف كما هي
// (عدا الملفات المعلَّمة @production-only)
const migrations = readdirSync(join(root, 'supabase/sql')).filter((f) => /^(0[7-9]|[1-9]\d)_.*\.sql$/.test(f)).sort()
  .map((f) => [f, readFileSync(join(root, 'supabase/sql', f), 'utf8')])
  .filter(([f, sql]) => !sql.includes('@production-only') && f !== '08_email_repair.sql') // 08 إصلاح لقاعدة قديمة
  .map(([f, sql]) => `-- ===================== ${f} =====================\n` + sql);
parts.push(...migrations);
const refresh = ['purge_tasks.sql', 'link_production.sql']
  .map((f) => '\n' + readFileSync(join(root, 'supabase/staging', f), 'utf8')).join('\n');
writeFileSync(join(root, 'supabase/staging/setup_staging.sql'), header + '\n' + parts.join('\n\n') + '\n' + refresh + '\n');
console.log('written supabase/staging/setup_staging.sql');
