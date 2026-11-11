// يولّد supabase/production/setup_production.sql: كل ملفات قاعدة البيانات بترتيبها في ملف واحد
// لإعداد مشروع Supabase جديد للإنتاج دفعة واحدة.
// الاستخدام: node tools/production-sql.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'supabase/sql');
// 05 (أول مدير) خطوة مستقلة بعد إنشاء حسابك، و06 و08 إصلاحات لقواعد قديمة لا يحتاجها مشروع جديد
const skip = new Set(['05_first_admin.sql', '06_lists.sql', '08_email_repair.sql']);
const files = readdirSync(dir).filter((f) => /^\d\d_.*\.sql$/.test(f) && !f.endsWith('.undo.sql') && !skip.has(f)).sort();

const header = `-- =====================================================================
--  نظام مهام الدعم الفني — إعداد مشروع الإنتاج (مشروع Supabase جديد)
--  ملف مولَّد تلقائياً (لا تعدّله يدوياً: node tools/production-sql.mjs)
--  يجمع بالترتيب: ${files.join('، ')}
--
--  يُنفَّذ مرة واحدة في Supabase ← SQL Editor في مشروع الإنتاج، ثم:
--    Project Settings ← Data API ← Exposed schemas: أضف support_tasks
--    ثم أول مدير: supabase/production/first_admin.sql
--  ويمكن إعادة تنفيذه بلا ضرر.
-- =====================================================================
`;
const body = files.map((f) => `-- ===================== ${f} =====================\n` + readFileSync(join(dir, f), 'utf8')).join('\n\n');
writeFileSync(join(root, 'supabase/production/setup_production.sql'), header + '\n' + body);
console.log('written supabase/production/setup_production.sql:', files.join(' '));
