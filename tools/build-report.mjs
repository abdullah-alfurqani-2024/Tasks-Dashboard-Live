// بناء ملف PDF لسجل تطوير النظام من مصدره docs/report/report.html
//   node tools/build-report.mjs
// أو لمستند آخر بنفس التنسيق (مثل توثيق نقل النظام إلى APEX):
//   node tools/build-report.mjs docs/apex-report/report.html docs/Tasks-System-APEX-Migration-Report.pdf
// يحتاج Playwright (Chromium) و pdftotext (poppler-utils) على جهاز المطوّر.
// الفهرس يُبنى من العناوين: h2 داخل .chapter و h3 داخل .ver، وأرقام صفحاته تُحسب بتمريرتين.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, process.argv[2] || 'docs/report/report.html');
const out = resolve(root, process.argv[3] || 'docs/Tasks-System-Development-Report.pdf');
const tmp = mkdtempSync(join(tmpdir(), 'report-'));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' });

// الفهرس مع علامات خفية لكل عنوان (تُقرأ من نص PDF لمعرفة صفحته)
const count = await page.evaluate(() => {
  const toc = document.getElementById('toc');
  const heads = [...document.querySelectorAll('.chapter > .ch-head h2, .ver .ver-head h3')];
  heads.forEach((h, i) => {
    const id = `TOCMARK${String(i).padStart(3, '0')}X`;
    const m = document.createElement('span'); m.className = 'marker'; m.textContent = id; h.append(m);
    const ver = h.closest('.ver');
    const li = document.createElement('li');
    li.className = ver ? 'l2' : 'l1';
    li.dataset.mark = id;
    const t = document.createElement('span'); t.className = 't';
    if (ver) {
      const v = document.createElement('span'); v.className = 'v ltr'; v.textContent = ver.querySelector('.ver-no').textContent;
      t.append(v, document.createTextNode(h.firstChild.textContent));
    } else t.textContent = h.firstChild.textContent;
    const dots = document.createElement('span'); dots.className = 'dots';
    const pg = document.createElement('span'); pg.className = 'pg'; pg.textContent = '00';
    li.append(t, dots, pg);
    toc.append(li);
  });
  return heads.length;
});
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
});

const pdf = (path) => page.pdf({ path, format: 'A4', printBackground: true, preferCSSPageSize: true });
const pass1 = join(tmp, 'pass1.pdf');
await pdf(pass1);

// صفحة كل علامة
const pages = execFileSync('pdftotext', [pass1, '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\f');
const where = {};
pages.forEach((txt, i) => { for (const m of txt.match(/TOCMARK\d{3}X/g) || []) where[m] ??= i + 1; });
const missing = Object.keys(where).length;
if (missing !== count) console.warn(`تنبيه: وُجدت ${missing} من ${count} علامة`);

await page.evaluate((w) => {
  for (const li of document.querySelectorAll('#toc li')) li.querySelector('.pg').textContent = w[li.dataset.mark] ?? '';
}, where);
await pdf(out);
await browser.close();

const n = execFileSync('pdfinfo', [out], { encoding: 'utf8' }).match(/Pages:\s+(\d+)/)?.[1];
rmSync(tmp, { recursive: true, force: true });
console.log(`written ${out.replace(root + '/', '')}: ${n} صفحة، ${(statSync(out).size / 1048576).toFixed(1)} MB، ${count} عنواناً في الفهرس`);
