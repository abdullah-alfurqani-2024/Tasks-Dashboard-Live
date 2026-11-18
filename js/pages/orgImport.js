/**
 * تبويب «الاستيراد» في صفحة الهيكل التنظيمي (مدير النظام):
 *   - استيراد الهيكل من ملف بشكل «عمود لكل مستوى» (كل صف مسار من الأعلى إلى الأسفل)، إضافةً إلى الحالي أو حذفاً واستبدالاً
 *   - حذف الهيكل كله
 *   - نسخة احتياطية بالشكل نفسه (تُستورد كما هي)
 * القراءة والتحليل هنا، والحفظ في عملية واحدة على الخادم (org.import) بقواعد الهيكل نفسها.
 */
import { db } from '../data/index.js';
import { html, mount, $, on, downloadBlob } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { modal, busy, toast, toastError } from '../ui/feedback.js';
import { options } from '../ui/parts.js';
import { normalizeAr, today } from '../core/format.js';
import { treeOrder } from '../core/orgModel.js';
import { writeXlsx } from '../lib/xlsx.js';
import { cell, guessLevel as guessLevelIn, readSheets, findHeader, rowPaths } from '../core/orgFile.js';

const WORD = 'حذف الكل';

/**
 * opts: { body, model: () => M, people: () => P, reload: async () => void, onChanged: () => void }
 */
export function orgImportTab({ body, model, people, reload, onChanged }) {
  const S = { file: '', header: [], rows: [], hi: 0, col: new Map(), top: new Map(), replace: false, office: true, res: null };

  /* ───────────── المستويات من العناوين ───────────── */
  const guessLevel = (h) => guessLevelIn(model().levels, h);

  /* ───────────── قراءة الملف ───────────── */
  async function readFile(file) {
    try {
      const found = findHeader(model().levels, await readSheets(file));
      if (!found) throw new Error('لم يُعثر على أعمدة للمستويات (مثل «المديرية» و«الدائرة» و«القسم») في أول 20 صفاً.');
      S.file = file.name;
      S.hi = found.hi;
      S.header = found.sheet.rows[found.hi].map(cell);
      S.rows = found.sheet.rows.slice(found.hi + 1);
      S.col = new Map();
      S.header.forEach((h, i) => { const l = guessLevel(h); if (l) S.col.set(i, l); });
      S.top = new Map();
      analyze();
      drawStep();
    } catch (e) { toastError(e); }
  }

  /* ───────────── التحليل: الصفوف ← شجرة ───────────── */
  function analyze() {
    const M = model();
    const lv = (id) => M.levels.find((l) => l.id === Number(id));
    const { rows: paths, ignoredOffice, cols } = rowPaths(M.levels, { cols: [...S.col.entries()], rows: S.rows, hi: S.hi, office: S.office });
    const skipped = [], inferred = [];
    const nodes = new Map();   // المفتاح: مسار الأسماء المنظّفة
    const kids = new Map();
    for (const p of paths) {
      if (p.skip) { skipped.push({ line: p.line, why: p.skip, raw: p.raw }); continue; }
      if (!p.path.length) continue;
      const path = p.path;
      if (p.inferred) inferred.push({ line: p.line, what: p.inferred, name: path[p.inferred.split(' ← ').length].v });
      let parentKey = null;
      for (const c of path) {
        const key = parentKey ? `${parentKey}›${normalizeAr(c.v)}` : normalizeAr(c.v);
        if (!nodes.has(key)) {
          const sib = kids.get(parentKey) || [];
          nodes.set(key, { key, parentKey, name: c.v, levelId: c.levelId, sort: sib.length + 1, firstLine: p.line });
          sib.push(key);
          kids.set(parentKey, sib);
        }
        parentKey = key;
      }
    }
    // المستوى: الأعلى في مستوى أعلى دائماً
    const errors = [];
    for (const n of nodes.values()) {
      const par = n.parentKey && nodes.get(n.parentKey);
      if (par && lv(par.levelId).levelNo >= lv(n.levelId).levelNo) {
        errors.push({ line: n.firstLine, why: `«${n.name}» (${lv(n.levelId).name}) تحت «${par.name}» (${lv(par.levelId).name}): الوحدة الأعلى يجب أن تكون في مستوى أعلى` });
      }
    }
    // مكان الوحدات العليا في الملف: الأقرب مستوى أعلى منها بين الوحدات العليا نفسها (مكتب الوكيل تحت مكتب الوزير، والمديريات تحت مكتب الوكيل)
    const tops = (kids.get(null) || []).map((k) => nodes.get(k));
    for (const t of tops) {
      if (S.top.has(t.key)) continue;
      const higher = tops.filter((o) => lv(o.levelId).levelNo < lv(t.levelId).levelNo);
      const near = higher.length ? Math.max(...higher.map((o) => lv(o.levelId).levelNo)) : null;
      const cand = higher.filter((o) => lv(o.levelId).levelNo === near);
      S.top.set(t.key, cand.length === 1 ? `f:${cand[0].key}` : '');
    }
    S.res = { nodes, kids, tops, skipped, inferred, errors, ignoredOffice, cols, lv };
  }

  /** القائمة النهائية بالترتيب: الأعلى قبل ما تحته (والوحدات العليا حسب أماكنها) */
  function buildItems() {
    const { nodes, kids, tops, lv } = S.res;
    const out = [];
    const done = new Set();
    const emit = (n, p, parentId) => {
      out.push({ k: n.key, p, parentId, name: n.name, levelId: n.levelId, sort: n.sort });
      done.add(n.key);
      for (const k of kids.get(n.key) || []) emit(nodes.get(k), n.key, null);
    };
    // الوحدات العليا: من مكانها أعلى الهيكل أو تحت وحدة موجودة أولاً، ثم التي تحت وحدات من الملف
    const pending = [...tops].sort((a, b) => lv(a.levelId).levelNo - lv(b.levelId).levelNo || a.sort - b.sort);
    let guard = 0;
    while (pending.length && guard++ < 1000) {
      const t = pending.shift();
      const place = S.top.get(t.key) || '';
      if (place.startsWith('f:')) {
        const pk = place.slice(2);
        if (!done.has(pk)) { pending.push(t); continue; }
        emit(t, pk, null);
      } else emit(t, null, place.startsWith('u:') ? Number(place.slice(2)) : null);
    }
    // ترتيب العرض للوحدات العليا التي صارت تحت وحدة من الملف: بعد أخواتها
    const count = new Map();
    for (const it of out) {
      if (it.p === null && !it.parentId) continue;
      const pk = it.p || `u:${it.parentId}`;
      if (tops.some((t) => t.key === it.k)) {
        const base = it.p ? (kids.get(it.p) || []).length : model().childrenOf(it.parentId).length;
        count.set(pk, (count.get(pk) || base) + 1);
        it.sort = count.get(pk);
      }
    }
    return out;
  }

  /** ما يوجد من وحدات الملف في الهيكل الحالي (للإضافة): بالاسم أو الاسم البديل تحت الأعلى نفسه */
  function matchExisting(items) {
    const M = model();
    const map = new Map();
    let existing = 0;
    for (const it of items) {
      const parentId = it.p ? map.get(it.p) : it.parentId || null;
      const low = normalizeAr(it.name);
      const found = it.p && !parentId ? null : M.childrenOf(parentId || 0).find((u) => normalizeAr(u.name) === low || (u.aliases || []).some((a) => normalizeAr(a) === low));
      map.set(it.k, found ? found.id : null);
      if (found) existing++;
    }
    return { map, existing };
  }

  /* ───────────── العرض ───────────── */
  function draw() {
    const M = model();
    mount(body, html`<div class="card-pad">
      <label class="drop" id="org-drop" tabindex="0">
        ${icon('upload')}<div><b>اسحب ملف الهيكل هنا أو اضغط للاختيار</b></div>
        <div class="small">xlsx أو csv بشكل «عمود لكل مستوى»: كل صف مسار من الأعلى إلى الأسفل (مثل المديرية ← الدائرة ← القسم).
          الأعمدة تُربط بالمستويات من عناوينها، والأعمدة الأخرى (الموظفون، الهواتف…) لا تُقرأ.</div>
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      </label>
      <div id="org-imp-step"></div>
    </div>
    <div class="card-pad emp-danger">
      <h3>حذف الهيكل</h3>
      <p>يحذف <b>نهائياً</b> كل الوحدات (${M.units.length.toLocaleString('en-US')}) وسجل تغييراتها، ومعها <b>كل إسنادات الموظفين</b>${people() ? ` (${people().total.toLocaleString('en-US')})` : ''}.
        قبل الحذف يُنزَّل إلى جهازك ملف Excel بالهيكل الحالي (يُستورد كما هو). المستويات والموظفون وأنواع الإسناد يبقون.</p>
      <button class="btn btn-danger" data-org-purge ${M.units.length ? '' : 'disabled'}>${icon('trash')}حذف الهيكل</button>
      <button class="btn" data-org-backup ${M.units.length ? '' : 'disabled'}>${icon('download')}تنزيل الهيكل (Excel)</button>
    </div>`);
    const drop = $('#org-drop', body), input = $('input', drop);
    input.onchange = () => input.files[0] && readFile(input.files[0]);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    if (S.res) drawStep();
  }

  function drawStep() {
    const step = $('#org-imp-step', body);
    if (!step || !S.res) return;
    const M = model();
    const { nodes, kids, tops, skipped, inferred, errors, ignoredOffice, cols, lv } = S.res;
    const items = buildItems();
    const { map, existing } = S.replace ? { map: new Map(), existing: 0 } : matchExisting(items);
    const isNew = (k) => !map.get(k);
    const perLevel = new Map();
    for (const n of nodes.values()) {
      const x = perLevel.get(n.levelId) || { all: 0, add: 0 };
      x.all++; if (isNew(n.key)) x.add++;
      perLevel.set(n.levelId, x);
    }
    const adding = items.length - existing;
    // خيارات مكان الوحدات العليا
    const placeOpts = (t) => [
      ['', 'أعلى الهيكل (وحدة رئيسية)'],
      ...tops.filter((o) => o !== t && lv(o.levelId).levelNo < lv(t.levelId).levelNo).map((o) => [`f:${o.key}`, `${o.name} (من الملف)`]),
      ...(S.replace ? [] : treeOrder(M).filter(({ u }) => u.isActive && M.levelNo(u) < lv(t.levelId).levelNo).map(({ u, depth }) => [`u:${u.id}`, `${'— '.repeat(depth)}${u.name}`])),
    ];
    // المعاينة بالشكل النهائي: الوحدات العليا في أماكنها المختارة
    const under = new Map();
    for (const it of items) {
      const pk = it.p || (it.parentId ? `u:${it.parentId}` : null);
      if (!under.has(pk)) under.set(pk, []);
      under.get(pk).push(it.k);
    }
    for (const list of under.values()) list.sort((a, b) => (items.find((i) => i.k === a).sort - items.find((i) => i.k === b).sort));
    const tree = (pk, depth) => (under.get(pk) || []).map((k) => {
      const n = nodes.get(k), sub = under.get(k) || [];
      const label = html`<span class="${isNew(k) ? '' : 'muted'}">${n.name}</span> <span class="badge">${lv(n.levelId).name}</span>
        ${isNew(k) ? '' : html`<span class="small muted">موجودة</span>`}${sub.length ? html` <span class="small muted">${sub.length} تابعة</span>` : ''}`;
      return sub.length
        ? html`<details class="imp-node" ${depth < 1 ? 'open' : ''}><summary>${label}</summary><div class="imp-kids">${tree(k, depth + 1)}</div></details>`
        : html`<div class="imp-leaf">${label}</div>`;
    });
    mount(step, html`
      <h3 style="margin:18px 0 8px">${S.file} — ${S.rows.length.toLocaleString('en-US')} صف</h3>
      ${(() => {
        const colSel = (h, i) => html`<div class="field"><label>${h || `عمود ${i + 1}`}</label>
          <select class="input" data-col="${i}">${options(M.levels.map((l) => [l.id, l.name]), S.col.get(i) ?? '', '— لا يُقرأ —')}</select></div>`;
        const mapped = S.header.map((h, i) => [h, i]).filter(([, i]) => S.col.get(i));
        const rest = S.header.map((h, i) => [h, i]).filter(([h, i]) => !S.col.get(i) && h);
        return html`<div class="filters" style="padding:0 0 6px">${mapped.map(([h, i]) => colSel(h, i))}</div>
          ${rest.length ? html`<details class="imp-notes" style="margin:0 0 10px"><summary>أعمدة أخرى لا تُقرأ (${rest.length})، لربط أحدها بمستوى</summary>
            <div class="filters" style="padding:6px 0 0">${rest.map(([h, i]) => colSel(h, i))}</div></details>` : ''}`;
      })()}
      <label class="check"><input type="checkbox" data-office ${S.office ? 'checked' : ''}> «مكتب مدير …» و«مدير مكتب …» في المستويات الدنيا ليست وحدات (موظفو المدير نفسه)
        ${ignoredOffice.size ? html`<span class="small muted">(${ignoredOffice.size} قيمة)</span>` : ''}</label>

      ${cols.length ? html`
      <h4 class="imp-h">مكان الوحدات العليا في الملف</h4>
      <div class="table-wrap"><table class="table imp-tops"><thead><tr><th>الوحدة</th><th>المستوى</th><th>تتبع</th></tr></thead>
        <tbody>${tops.map((t) => html`<tr><td><b>${t.name}</b></td><td><span class="badge">${lv(t.levelId).name}</span></td>
          <td><select class="input" data-top="${t.key}">${options(placeOpts(t), S.top.get(t.key) || '')}</select></td></tr>`)}</tbody></table></div>
      <div class="small muted" style="margin-top:4px">الملف لا يذكر تبعية الوحدات العليا لبعضها؛ المقترح: كل وحدة تحت الأقرب مستوى أعلى منها. وتُنقل بعد الاستيراد بزر «نقل».</div>

      <h4 class="imp-h">طريقة الاستيراد</h4>
      <div class="stack" style="gap:6px">
        <label class="check"><input type="radio" name="imp-mode" value="add" ${S.replace ? '' : 'checked'}> إضافة إلى الهيكل الحالي: الموجود يُطابَق بالاسم (أو اسمه البديل) تحت الوحدة الأعلى نفسها، والجديد فقط يُضاف</label>
        <label class="check"><input type="radio" name="imp-mode" value="replace" ${S.replace ? 'checked' : ''}> حذف الهيكل الحالي واستبداله بالملف
          ${M.units.length ? html`<span class="small" style="color:var(--bad)">(يُحذف ${M.units.length.toLocaleString('en-US')} وحدة${people()?.total ? ` و${people().total.toLocaleString('en-US')} إسناد موظفين` : ''}؛ ويُنزَّل قبله ملف احتياطي)</span>` : ''}</label>
      </div>

      <h4 class="imp-h">المعاينة</h4>
      <div class="chips" style="margin-bottom:8px">
        ${[...perLevel.entries()].sort((a, b) => lv(a[0]).levelNo - lv(b[0]).levelNo).map(([l, x]) => html`<span class="chip">${lv(l).name}: <b>${x.all.toLocaleString('en-US')}</b>${x.add !== x.all ? html` <span class="small muted">(جديد ${x.add})</span>` : ''}</span>`)}
        <span class="chip">المجموع: <b>${nodes.size.toLocaleString('en-US')}</b>${existing ? html` <span class="small muted">(موجود ${existing})</span>` : ''}</span>
      </div>
      ${errors.length ? html`<div class="alert bad"><b>${errors.length} خطأ يمنع الاستيراد</b> (عدّل ربط الأعمدة أو الملف):
        ${errors.slice(0, 20).map((e) => html`<div class="small">صف ${e.line}: ${e.why}</div>`)}</div>` : ''}
      <div class="imp-tree">${tree(null, 0)}
        ${[...under.keys()].filter((k) => k && k.startsWith('u:')).map((k) => html`<details class="imp-node" open>
          <summary><span class="muted">تحت الوحدة الموجودة «${M.unit.get(Number(k.slice(2)))?.name}»</span></summary><div class="imp-kids">${tree(k, 1)}</div></details>`)}</div>
      ${inferred.length ? html`<details class="imp-notes"><summary>أُكمل المستوى الأعلى تلقائياً في ${inferred.length} صف</summary>
        ${inferred.slice(0, 200).map((x) => html`<div class="small">صف ${x.line}: «${x.name}» ← تحت ${x.what}</div>`)}</details>` : ''}
      ${skipped.length ? html`<details class="imp-notes"><summary>${skipped.length.toLocaleString('en-US')} صف لا يُستورد</summary>
        ${skipped.slice(0, 300).map((x) => html`<div class="small">صف ${x.line}: ${x.why}${x.raw.length ? ` — ${x.raw.join(' | ')}` : ''}</div>`)}</details>` : ''}
      <div class="row" style="margin-top:14px">
        <button class="btn ${S.replace ? 'btn-danger' : 'btn-primary'}" data-imp-org ${errors.length || !adding ? 'disabled' : ''}>${icon('upload')}${S.replace
          ? `حذف الهيكل واستيراد ${nodes.size.toLocaleString('en-US')} وحدة` : `استيراد ${adding.toLocaleString('en-US')} وحدة جديدة`}</button>
        ${!adding && !errors.length ? html`<span class="small muted">كل وحدات الملف موجودة في الهيكل.</span>` : ''}
      </div>
      <div class="progress" data-imp-progress hidden style="margin-top:10px"><div style="width:100%"></div></div>`
      : html`<div class="alert bad">اربط عموداً واحداً على الأقل بمستوى.</div>`}`);
  }

  /* ───────────── النسخة الاحتياطية بالشكل نفسه ───────────── */
  function backup() {
    const M = model();
    const levels = [...M.levels].sort((a, b) => a.levelNo - b.levelNo);
    const pos = new Map(levels.map((l, i) => [l.id, i]));
    const cols = [...levels.map((l) => ({ label: l.name, width: 34 })), { label: 'الرمز الرسمي', width: 12 }, { label: 'الاختصار', width: 12 }, { label: 'الحالة', width: 10 }];
    const rows = treeOrder(M).map(({ u }) => {
      const r = new Array(cols.length).fill('');
      for (const a of [...M.ancestors(u), u]) r[pos.get(a.levelId)] = a.name;
      r[levels.length] = u.code; r[levels.length + 1] = u.shortName; r[levels.length + 2] = u.isActive ? '' : 'معطّلة';
      return r;
    });
    downloadBlob(writeXlsx([{ name: 'الهيكل التنظيمي', columns: cols, rows }]), `org_structure_${today()}.xlsx`);
    return rows.length;
  }

  /** نافذة تأكيد مكتوب ← true إن أكّد */
  function confirmTyped({ title, message }) {
    return new Promise((resolve) => {
      const m = modal({
        title, size: 'sm',
        body: html`<form class="stack" novalidate><div class="alert bad">${message}</div>
          <div class="field"><label for="org-confirm">للتأكيد اكتب «${WORD}»</label><input class="input" id="org-confirm" name="confirm" autocomplete="off"></div>
          <div class="alert bad" data-err hidden></div></form>`,
        footer: html`<button class="btn btn-danger" data-ok>${icon('trash')}متابعة</button><button class="btn" data-x>إلغاء</button>`,
        onClose: () => resolve(false),
      });
      const f = $('form', m.el);
      const ok = () => {
        if (f.elements.confirm.value.trim() !== WORD) { const e = $('[data-err]', m.el); e.textContent = `اكتب «${WORD}» للتأكيد.`; e.hidden = false; return; }
        resolve(true); m.close();
      };
      $('[data-x]', m.el).onclick = () => { resolve(false); m.close(); };
      $('[data-ok]', m.el).onclick = ok;
      f.onsubmit = (e) => { e.preventDefault(); ok(); };
    });
  }

  /* ───────────── الأحداث ───────────── */
  on(body, 'change', '[data-col]', (e, s) => { S.col.set(Number(s.dataset.col), s.value ? Number(s.value) : ''); S.top = new Map(); analyze(); drawStep(); });
  on(body, 'change', '[data-office]', (e, c) => { S.office = c.checked; analyze(); drawStep(); });
  on(body, 'change', '[data-top]', (e, s) => { S.top.set(s.dataset.top, s.value); drawStep(); });
  on(body, 'change', 'input[name="imp-mode"]', (e, r) => {
    S.replace = r.value === 'replace';
    if (S.replace) for (const [k, v] of S.top) if (v.startsWith('u:')) S.top.set(k, '');   // لا وحدات حالية بعد الحذف
    drawStep();
  });
  on(body, 'click', '[data-org-backup]', () => { const n = backup(); toast(`نُزّل الهيكل (${n} وحدة).`, 'ok', 3000); });
  on(body, 'click', '[data-org-purge]', async (e, b) => {
    const M = model(), P = people();
    if (!(await confirmTyped({ title: 'حذف الهيكل',
      message: html`سيُحذف ${M.units.length.toLocaleString('en-US')} وحدة وسجلها${P?.total ? html` و<b>${P.total.toLocaleString('en-US')} إسناد موظفين</b>` : ''} <b>نهائياً</b>.
        يبقى الموظفون بلا وحدة. سيُنزَّل أولاً ملف Excel بالهيكل الحالي، احتفظ به.` }))) return;
    await busy(b, async () => {
      try {
        const saved = backup();
        const r = await db.org.purge();
        S.res = null; S.rows = [];
        await reload(); onChanged();
        toast(`حُذف ${r.units.toLocaleString('en-US')} وحدة${r.assignments ? ` و${r.assignments.toLocaleString('en-US')} إسناد` : ''}. النسخة الاحتياطية (${saved} وحدة) نُزّلت إلى جهازك.`, 'ok', 8000);
      } catch (er) { toastError(er); }
    });
  });
  on(body, 'click', '[data-imp-org]', async (e, b) => {
    const M = model(), P = people();
    if (S.replace && M.units.length && !(await confirmTyped({ title: 'حذف الهيكل واستبداله',
      message: html`سيُحذف الهيكل الحالي (${M.units.length.toLocaleString('en-US')} وحدة${P?.total ? html` و<b>${P.total.toLocaleString('en-US')} إسناد موظفين</b>` : ''}) ثم يُستورد الملف، في عملية واحدة: إن فشل الاستيراد لا يُحذف شيء.
        سيُنزَّل أولاً ملف Excel بالهيكل الحالي.` }))) return;
    await busy(b, async () => {
      const bar = $('[data-imp-progress]', body); if (bar) bar.hidden = false;
      try {
        if (S.replace && M.units.length) backup();
        const r = await db.org.import(buildItems(), S.replace);
        await reload(); onChanged();
        toast(`تم الاستيراد: ${r.created.toLocaleString('en-US')} وحدة جديدة${r.existing ? `، و${r.existing} موجودة` : ''}${r.purgedUnits ? `، بعد حذف ${r.purgedUnits} وحدة` : ''}${r.purgedAssignments ? ` و${r.purgedAssignments} إسناد` : ''}.`, 'ok', 8000);
        analyze(); drawStep();
      } catch (er) { toastError(er); }
      if (bar) bar.hidden = true;
    });
  });

  return { draw };
}
