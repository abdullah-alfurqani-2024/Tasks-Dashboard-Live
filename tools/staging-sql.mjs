// يولّد ملفي التجهيز لنسختي التجربة والتطوير (في مشروع Tasks-Test) من ملفات قاعدة البيانات بتغيير اسم السكيما:
//   supabase/staging/setup_staging.sql  ← سكيما support_tasks_staging
//   supabase/dev/setup_dev.sql          ← سكيما support_tasks_dev
// الاستخدام: node tools/staging-sql.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const PROD = 'support_tasks', STG = 'support_tasks_staging';
const read = (dir, f) => readFileSync(join(root, dir, f), 'utf8');

const TARGETS = [
  { schema: STG, out: 'supabase/staging/setup_staging.sql', name: 'نسخة التجربة', fn: 'refresh-staging', btn: 'تحديث بيانات التجربة من الإنتاج' },
  { schema: 'support_tasks_dev', out: 'supabase/dev/setup_dev.sql', name: 'نسخة التطوير', fn: 'refresh-dev', btn: 'تحديث بيانات التطوير من الإنتاج', dev: true },
];

// ملفات التعديل اللاحقة (07 فما بعد) تعالج السكيمات بنفسها، فتُضاف كما هي
// (عدا الملفات المعلَّمة @production-only، و08 إصلاح لقاعدة قديمة)
const migrations = readdirSync(join(root, 'supabase/sql')).filter((f) => /^(0[7-9]|[1-9]\d)_.*\.sql$/.test(f)).sort()
  .map((f) => [f, read('supabase/sql', f)])
  .filter(([f, sql]) => !sql.includes('@production-only') && f !== '08_email_repair.sql')
  .map(([f, sql]) => `-- ===================== ${f} =====================\n` + sql);

// تعديلات قيد التطوير (الفرع dev): supabase/dev/sql مكتوبة لسكيما التطوير وحدها، فتدخل ملف التطوير فقط.
// تأتي بعد ملفات التجربة، فيمكنها تعديل دالة استقبال نسخة الإنتاج نفسها إن تغيّر شكل الجداول.
// عند نقلها إلى التجربة تنتقل إلى supabase/sql بقائمة السكيمات الكاملة.
const devDir = join(root, 'supabase/dev/sql');
const devOnly = existsSync(devDir) ? readdirSync(devDir).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort()
  .map((f) => `-- ===================== dev/sql/${f} (قيد التطوير) =====================\n` + read('supabase/dev/sql', f)) : [];

for (const t of TARGETS) {
  const base = ['01_schema.sql', '02_functions.sql', '03_security.sql', '04_seed.sql']
    .map((f) => `-- ===================== ${f} =====================\n` + read('supabase/sql', f).replaceAll(PROD, t.schema));
  // ملفات التجربة (حذف المهام، واستقبال نسخة الإنتاج) مكتوبة لسكيما التجربة: تُحوَّل للسكيما الهدف
  const extra = ['purge_tasks.sql', 'link_production.sql']
    .map((f) => '\n' + read('supabase/staging', f).replaceAll(STG, t.schema)).join('\n');
  const header = `-- =====================================================================
--  ${t.name}: سكيما ${t.schema}
--  ملف مولَّد تلقائياً من supabase/sql (لا تعدّله يدوياً: node tools/staging-sql.mjs)
--
--  يُنفَّذ في Supabase ← SQL Editor (مشروع التجربة Tasks-Test) مرة واحدة، ثم:
--    Project Settings ← Data API ← Exposed schemas: أضف ${t.schema}
--  البيانات تُنسخ من الإنتاج (مشروع مستقل) بزر «${t.btn}» (دالة ${t.fn}).
--  ويمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================
`;
  mkdirSync(join(root, t.out, '..'), { recursive: true });
  writeFileSync(join(root, t.out), header + '\n' + base.concat(migrations).join('\n\n') + '\n' + extra + '\n'
    + (t.dev && devOnly.length ? '\n' + devOnly.join('\n\n') + '\n' : ''));
  console.log('written ' + t.out);
}
