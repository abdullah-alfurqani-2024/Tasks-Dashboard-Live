// تحديث رقم الإصدار وقائمة الملفات في version.json و js/version.js
// الاستخدام: node tools/release.mjs 1.2.0
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('اكتب رقم الإصدار مثل: node tools/release.mjs 1.2.0'); process.exit(1); }
const root = new URL('..', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = ['index.html', ...walk(join(root, 'css')), ...walk(join(root, 'js'))]
  .map((f) => relative(root, f.startsWith('/') ? f : join(root, f)).split('\\').join('/'))
  .filter((f) => /\.(html|css|js)$/.test(f)).sort();
writeFileSync(join(root, 'version.json'), JSON.stringify({ version, files }, null, 2) + '\n');
writeFileSync(join(root, 'js/version.js'), `/** رقم الإصدار — يُحدَّث مع version.json عبر tools/release.mjs */\nexport const VERSION = '${version}';\n`);
console.log(`version ${version}: ${files.length} files`);
