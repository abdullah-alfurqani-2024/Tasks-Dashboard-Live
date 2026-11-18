/**
 * إسناد الموظفين إلى وحداتهم من ملف الهيكل (تبويب «الاستيراد» في صفحة الموظفين، مدير النظام).
 * الملف نفسه الذي استُورد منه الهيكل: لكل صف موظف رقمه الوظيفي ومساره (المديرية ← الدائرة ← القسم) ومسماه الوظيفي.
 *   - الموظف يُطابَق بالرقم الوظيفي، والوحدة بالمسار في الهيكل الحالي (القواعد نفسها في js/core/orgFile.js)
 *   - «مكتب مدير دائرة …» ← الدائرة نفسها
 *   - الرئاسة من المسمى: «رئيس قسم …» لرئيس قسمه، «مدير دائرة …» لمدير دائرته (المسمى يبدأ بمسمى مسؤول المستوى ثم اسم الوحدة)
 * الحفظ دفعة واحدة على الخادم (employees.assignBulk) بقواعد الإسناد نفسها.
 */
import { db } from '../data/index.js';
import { html, mount, $, on } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { busy, toast, toastError } from '../ui/feedback.js';
import { options } from '../ui/parts.js';
import { dateInput } from '../ui/dateField.js';
import { normalizeAr, latinDigits, today } from '../core/format.js';
import { pathText } from '../core/orgModel.js';
import { cell, guessLevel, readSheets, findHeader, rowPaths, resolvePath } from '../core/orgFile.js';

const FIELDS = [
  ['eno', 'الرقم الوظيفي', /employee\s*(id|no|number)|emp\.?\s*no|staff\s*(id|no)|الرقم الوظيفي|رقم وظيفي/i],
  ['name', 'الاسم', /^(employees?|name|full\s*name|الاسم|اسم الموظف|الموظف)$/i],
  ['pos', 'المسمى الوظيفي', /position|job\s*title|^title$|المسمى|الوظيفه|الوظيفة/i],
];
const digitsOf = (v) => (typeof v === 'number' ? String(Math.round(v)) : latinDigits(cell(v)).replace(/\s+/g, '').toUpperCase());
const stem = (w) => normalizeAr(w || '').replace(/^ال/, '').replace(/ه$/, '');

/**
 * data: () => ({ emps, M, primaryAt(empId, date) })، reload: إعادة تحميل بيانات الصفحة
 */
export function assignImportTab({ data, reload }) {
  const S = { el: null, file: '', header: [], rows: [], hi: 0, col: new Map(), f: {}, office: true, heads: true, transfer: true, addMissing: false, date: today(), res: null, filter: 'all', last: null };

  /** رئيس الوحدة من مسماه: أول كلمة مسمى مسؤول المستوى (رئيس/مدير)، وبعدها اسم الوحدة */
  function headOf(pos, unit, M) {
    const ht = M.level.get(unit.levelId)?.headTitle;
    if (!pos || !ht) return false;
    const [w, ...rest] = normalizeAr(pos).split(' ');
    if (stem(w) !== stem(normalizeAr(ht).split(' ')[0])) return false;
    const r = rest.join(' '), n = normalizeAr(unit.name);
    return r === n || r.startsWith(`${n} `);
  }

  async function readFile(file) {
    try {
      const { M } = data();
      if (!M.units.length) throw new Error('الهيكل فارغ. استورد الهيكل أولاً من صفحة «الهيكل التنظيمي».');
      const found = findHeader(M.levels, await readSheets(file), (r) => r.some((c) => guessLevel(M.levels, c)) && r.some((c) => FIELDS[0][2].test(cell(c))));
      if (!found) throw new Error('لم يُعثر على عمود الرقم الوظيفي وأعمدة المستويات في أول 20 صفاً.');
      S.file = file.name; S.hi = found.hi;
      S.header = found.sheet.rows[found.hi].map(cell);
      S.rows = found.sheet.rows.slice(found.hi + 1);
      S.col = new Map(); S.f = {};
      S.header.forEach((h, i) => {
        const l = guessLevel(M.levels, h);
        if (l) { S.col.set(i, l); return; }
        for (const [k, , re] of FIELDS) if (S.f[k] == null && re.test(h)) { S.f[k] = i; break; }
      });
      S.filter = 'all'; S.last = null;
      analyze(); drawStep();
    } catch (e) { toastError(e); }
  }

  function analyze() {
    const { emps, M, primaryAt } = data();
    const byNo = new Map(emps.filter((e) => e.employeeNo).map((e) => [e.employeeNo.toUpperCase(), e]));
    const { rows: paths } = rowPaths(M.levels, { cols: [...S.col.entries()], rows: S.rows, hi: S.hi, office: S.office });
    const seen = new Map();
    const headTaken = new Map();   // الوحدة ← أول رئيس لها في الملف
    const out = [];
    paths.forEach((p) => {
      const r = S.rows[p.i];
      const eno = S.f.eno == null ? '' : digitsOf(r[S.f.eno]);
      const name = S.f.name == null ? '' : cell(r[S.f.name]);
      const pos = S.f.pos == null ? '' : cell(r[S.f.pos]);
      if (!/[A-Za-z؀-ۿ]/.test(name) && !/^0*$/.test(eno) === false) return;   // صف عنوان وحدة (بلا موظف)
      const x = { line: p.line, eno: /^0*$/.test(eno) ? '' : eno, name, pos, path: p.path.map((c) => c.v).join(' ← ') };
      if (!x.eno) return out.push({ ...x, st: 'skip', why: 'بلا رقم وظيفي' });
      if (seen.has(x.eno)) return out.push({ ...x, st: 'skip', why: `الرقم الوظيفي مكرر في الملف (صف ${seen.get(x.eno)})` });
      seen.set(x.eno, x.line);
      if (p.skip || !p.path.length) return out.push({ ...x, st: 'skip', why: p.skip || 'لا وحدة في الصف' });
      const res = resolvePath(M, p.path);
      if (!res.unit) return out.push({ ...x, st: 'skip', why: res.why });
      x.unit = res.unit;
      // «مدير دائرة X» مكتوب تحت قسم من أقسامها: هو مدير الدائرة، فيُسند إليها
      if (S.heads && pos && !headOf(pos, res.unit, M)) {
        const up = M.ancestors(res.unit).reverse().find((a) => headOf(pos, a, M));
        if (up) { x.note = `المسمى لرئيس «${up.name}»، والصف تحت «${res.unit.name}»: يُسند إلى «${up.name}»`; x.unit = up; }
      }
      x.isHead = S.heads && headOf(pos, x.unit, M);
      if (x.isHead) {
        if (headTaken.has(x.unit.id)) { x.isHead = false; x.headNote = `رئيس آخر للوحدة في الملف (صف ${headTaken.get(x.unit.id)})`; }
        else headTaken.set(x.unit.id, x.line);
      }
      const emp = byNo.get(x.eno);
      if (!emp) return out.push({ ...x, st: 'missing', why: 'الرقم الوظيفي غير موجود في قائمة الموظفين' });
      x.emp = emp;
      if (!emp.isActive) return out.push({ ...x, st: 'skip', why: 'الموظف غير نشط' });
      const cur = primaryAt(emp.id, S.date);
      if (!cur) x.st = 'new';
      else if (cur.unitId === x.unit.id) x.st = x.isHead && !cur.isHead ? 'head' : 'same';
      else { x.st = S.transfer ? 'move' : 'keep'; x.from = M.unit.get(cur.unitId)?.name || ''; }
      out.push(x);
    });
    S.res = out;
  }

  const ST = {
    new: ['إسناد جديد', 'ok'], move: ['نقل', 'info'], head: ['رئاسة فقط', 'warn'], same: ['بلا تغيير', ''], keep: ['في وحدة أخرى، يُترك', ''],
    missing: ['غير موجود في الموظفين', 'warn'], skip: ['لا يُسند', 'bad'],
  };

  function drawStep() {
    const step = S.el && $('#asg-step', S.el);
    if (!step) return;
    if (!S.res) { mount(step, ''); return; }
    const { M } = data();
    const count = (st) => S.res.filter((r) => r.st === st).length;
    const heads = S.res.filter((r) => r.isHead && ['new', 'move', 'head', ...(S.addMissing ? ['missing'] : [])].includes(r.st)).length;
    const go = count('new') + count('move') + count('head') + (S.addMissing ? count('missing') : 0);
    const shown = S.res.filter((r) => S.filter === 'all' || (S.filter === 'heads' ? r.isHead : r.st === S.filter));
    const reasons = new Map();
    for (const r of S.res) if (r.st === 'skip') { const k = r.why.replace(/«[^»]*»/g, '«…»').replace(/\(صف \d+\)/, '').trim(); reasons.set(k, (reasons.get(k) || 0) + 1); }
    const colSel = (k, label) => html`<div class="field"><label>${label}</label>
      <select class="input" data-asg-f="${k}">${options(S.header.map((h, i) => [i, h || `عمود ${i + 1}`]), S.f[k] ?? '', '— لا يوجد —')}</select></div>`;
    mount(step, html`
      <h4 class="imp-h">${S.file} — ${S.rows.length.toLocaleString('en-US')} صف</h4>
      <div class="filters" style="padding:0 0 6px">
        ${FIELDS.map(([k, label]) => colSel(k, label))}
        ${[...S.col.entries()].filter(([, l]) => l).map(([i, l]) => html`<div class="field"><label>${S.header[i]}</label>
          <select class="input" data-asg-col="${i}">${options(M.levels.map((x) => [x.id, x.name]), l, '— لا يُقرأ —')}</select></div>`)}
      </div>
      <div class="asg-opts">
        <div class="field"><label for="asg-date">بداية الإسناد</label>${dateInput({ name: 'asgDate', id: 'asg-date', value: S.date })}</div>
        <label class="check"><input type="checkbox" data-asg-o="transfer" ${S.transfer ? 'checked' : ''}> من له وحدة أخرى يُنقل إلى وحدة الملف</label>
        <label class="check"><input type="checkbox" data-asg-o="heads" ${S.heads ? 'checked' : ''}> الرئاسة من المسمى الوظيفي («رئيس قسم …»، «مدير دائرة …»)</label>
        <label class="check"><input type="checkbox" data-asg-o="office" ${S.office ? 'checked' : ''}> «مكتب مدير …» ← الدائرة نفسها</label>
        <label class="check"><input type="checkbox" data-asg-o="addMissing" ${S.addMissing ? 'checked' : ''}> أضف من ليس في قائمة الموظفين (${count('missing').toLocaleString('en-US')})، «تحتاج مراجعة»</label>
      </div>
      <div class="chips" style="margin:10px 0">
        ${[['all', 'الكل', S.res.length], ['new', 'إسناد جديد', count('new')], ['move', 'نقل', count('move')], ['head', 'رئاسة فقط', count('head')],
          ['same', 'بلا تغيير', count('same')], ['keep', 'يُترك', count('keep')], ['heads', 'رؤساء', heads], ['missing', 'غير موجود', count('missing')], ['skip', 'لا يُسند', count('skip')]]
          .filter(([k, , n]) => k === 'all' || n).map(([k, l, n]) => html`<button type="button" class="chip chip-btn ${S.filter === k ? 'on' : ''}" data-asg-filter="${k}">${l} (${n.toLocaleString('en-US')})</button>`)}
      </div>
      ${reasons.size ? html`<div class="small muted" style="margin-bottom:8px">أسباب «لا يُسند»: ${[...reasons].map(([k, n]) => `${k} (${n})`).join('، ')}</div>` : ''}
      <div class="table-wrap" style="max-height:50vh"><table class="table"><thead><tr><th>صف</th><th>الرقم الوظيفي</th><th>الاسم</th><th>الوحدة</th><th>النتيجة</th></tr></thead>
        <tbody>${shown.slice(0, 300).map((r) => html`<tr><td class="num">${r.line}</td><td class="num"><span class="ltr">${r.eno}</span></td>
          <td>${r.emp ? r.emp.nameAr : r.name}${r.pos ? html`<div class="small muted">${r.pos}</div>` : ''}</td>
          <td>${r.unit ? html`<b>${r.unit.name}</b><div class="small muted">${pathText(M, r.unit)}</div>` : html`<span class="small muted">${r.path}</span>`}</td>
          <td><span class="badge ${ST[r.st][1]}">${ST[r.st][0]}</span>${r.isHead ? html` <span class="badge warn">رئيس الوحدة</span>` : ''}
            ${r.from ? html`<div class="small muted">من «${r.from}»</div>` : ''}${r.why ? html`<div class="small muted">${r.why}</div>` : ''}
            ${r.headNote ? html`<div class="small muted">${r.headNote}</div>` : ''}${r.note ? html`<div class="small muted">${r.note}</div>` : ''}</td></tr>`)}</tbody></table></div>
      ${shown.length > 300 ? html`<div class="small muted" style="padding:6px 0">تظهر أول 300 من ${shown.length.toLocaleString('en-US')}.</div>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="btn btn-primary" data-asg-go ${go ? '' : 'disabled'}>${icon('check')}إسناد ${go.toLocaleString('en-US')} موظف${heads ? ` (منهم ${heads} رئيس وحدة)` : ''}</button>
        ${go ? '' : html`<span class="small muted">لا يوجد ما يُسند.</span>`}
      </div>
      <div class="progress" data-asg-progress hidden style="margin-top:10px"><div></div></div>
      ${S.last ? html`<div class="alert ${S.last.failed.length ? 'bad' : 'ok'}" style="margin-top:12px">${S.last.text}
        ${[...S.last.headConflicts, ...S.last.failed].slice(0, 50).map((x) => html`<div class="small">${x.name}: ${x.error}</div>`)}</div>` : ''}`);
  }

  function draw(el) {
    S.el = el;
    mount(el, html`<div class="card-pad emp-asg">
      <h3>إسناد الموظفين إلى وحداتهم من ملف الهيكل</h3>
      <p class="small muted" style="margin-top:0">الملف الذي استُورد منه الهيكل، وفيه لكل موظف رقمه الوظيفي ومساره (المديرية ← الدائرة ← القسم) ومسماه الوظيفي.
        الموظف يُطابَق برقمه الوظيفي، والوحدة بمسارها في الهيكل الحالي، ويُسند «أصيل» من التاريخ الذي تختاره.</p>
      <label class="drop" id="asg-drop" tabindex="0">${icon('upload')}<div><b>اسحب ملف الهيكل هنا أو اضغط للاختيار</b></div>
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
      <div id="asg-step"></div></div>`);
    const drop = $('#asg-drop', el), input = $('input', drop);
    input.onchange = () => input.files[0] && readFile(input.files[0]);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    on(el, 'change', '[data-asg-f]', (e, s) => { S.f[s.dataset.asgF] = s.value === '' ? null : Number(s.value); analyze(); drawStep(); });
    on(el, 'change', '[data-asg-col]', (e, s) => { S.col.set(Number(s.dataset.asgCol), s.value ? Number(s.value) : ''); analyze(); drawStep(); });
    on(el, 'change', '[data-asg-o]', (e, c) => { S[c.dataset.asgO] = c.checked; analyze(); drawStep(); });
    el.addEventListener('change', (e) => { if (e.target.name === 'asgDate') { S.date = e.target.value || today(); analyze(); drawStep(); } });
    on(el, 'click', '[data-asg-filter]', (e, b) => { S.filter = b.dataset.asgFilter; drawStep(); });
    on(el, 'click', '[data-asg-go]', (e, b) => busy(b, async () => {
      const bar = $('[data-asg-progress]', el); bar.hidden = false;
      const prog = (d, n) => { bar.firstElementChild.style.width = `${Math.round((d / n) * 100)}%`; };
      try {
        let added = 0;
        if (S.addMissing && S.res.some((r) => r.st === 'missing')) {
          const { emps } = data();
          const civils = new Set(emps.map((x) => x.civilNo).filter(Boolean));
          const rows = S.res.filter((r) => r.st === 'missing').map((r) => {
            const useEno = /^[0-9]{1,20}$/.test(r.eno) && !civils.has(r.eno);
            if (useEno) civils.add(r.eno);
            return { civilNo: useEno ? r.eno : '', employeeNo: r.eno, nameAr: r.name, nameEn: '',
              review: `أُضيف من ملف الهيكل · لا يوجد رقم مدني${useEno ? ` (وُضع الرقم الوظيفي ${r.eno} مكانه مؤقتاً)` : ''}` };
          });
          const ir = await db.employees.import(rows);
          added = ir.created;
          await reload();
          analyze();   // المضافون صاروا موظفين يُطابَقون
        }
        const items = S.res.filter((r) => ['new', 'move', 'head'].includes(r.st)).map((r) => ({ employeeId: r.emp.id, unitId: r.unit.id, isHead: !!r.isHead }));
        const r = await db.employees.assignBulk(items, { date: S.date, transfer: S.transfer }, prog);
        await reload();
        const { emps, M } = data();
        const nameOf = (x) => `${emps.find((y) => y.id === x.employeeId)?.nameAr || x.employeeId} («${M.unit.get(x.unitId)?.name || ''}»)`;
        S.last = {
          text: `أُسند ${r.created.toLocaleString('en-US')} موظف، ونُقل ${r.transferred.toLocaleString('en-US')}، ورئاسة ${r.heads}${r.unchanged ? `، و${r.unchanged} بلا تغيير` : ''}${added ? `، وأُضيف ${added} موظف للمراجعة` : ''}.`
            + `${r.headConflicts.length ? ` ${r.headConflicts.length} رئاسة لم تُسجَّل لتعارضها (أُسندوا بلا رئاسة).` : ''}${r.failed.length ? ` لم يُسند ${r.failed.length}:` : ''}`,
          headConflicts: r.headConflicts.map((x) => ({ name: nameOf(x), error: x.error })),
          failed: r.failed.map((x) => ({ name: nameOf(x), error: x.error })),
        };
        toast(S.last.text, r.failed.length ? 'info' : 'ok', 8000);
        analyze(); drawStep();
      } catch (er) { toastError(er); }
      bar.hidden = true;
    }));
    drawStep();
  }

  return { draw };
}
