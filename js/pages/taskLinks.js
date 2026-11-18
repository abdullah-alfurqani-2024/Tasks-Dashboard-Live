/**
 * ربط المهام بالهيكل والموظفين (تبويب «ربط المهام» في صفحة الهيكل، مدير النظام).
 * «الجهة الطالبة» و«اسم الموظف» في المهام القديمة (والمستوردة، والمكتوبة نصاً حراً) نصوص؛ تُربط هنا:
 *   - تلقائياً: النص يطابق اسم وحدة واحدة (أو اختصارها أو اسماً بديلاً لها)، أو اسم موظف نشط واحد، بعد توحيد الكتابة
 *   - يدوياً: لكل نص غير مطابق تختار وحدته أو موظفه؛ ونص الجهة يُحفظ اسماً بديلاً للوحدة (خيار)،
 *     فتُربط كل مهامه، ويُطابَق تلقائياً بعد ذلك (في الاستيراد ونسخة الإنتاج)
 * الربط لا يغيّر «آخر تعديل» للمهمة، والنص الأصلي يبقى كما كُتب.
 */
import { db } from '../data/index.js';
import { html, mount, $, on, debounce } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import { busy, toast, toastError } from '../ui/feedback.js';
import { searchBox } from '../ui/parts.js';
import { lookupField } from '../ui/lookupField.js';
import { directory, invalidateDirectory } from '../core/directory.js';
import { searchKey, queryWords } from '../core/format.js';
import { refreshReviewCount } from '../core/store.js';

const MAX = 150;

export function taskLinksTab({ body, reload }) {
  const S = { T: null, D: null, q: '', kind: 'unit', alias: true, err: '' };
  let el = null;

  async function load() {
    S.err = '';
    try {
      invalidateDirectory();
      [S.T, S.D] = await Promise.all([db.tasks.linkTexts(), directory({ fresh: true })]);
    } catch (e) { S.err = e.message; }
  }

  /** المطابقة التلقائية لكل نص */
  function auto() {
    const { T, D } = S;
    const units = T.requesters.map((r) => ({ ...r, unit: D.unitByName(r.text) }));
    const emps = T.employees.map((r) => ({ ...r, emp: D.empByExactName(r.text) }));
    return { units, emps };
  }

  async function draw(target = body) {
    el = target;
    mount(el, html`<div class="card-pad">جارٍ التحميل…</div>`);
    await load();
    drawAll();
  }

  function drawAll() {
    if (S.err) { mount(el, html`<div class="card-pad"><div class="alert bad">${S.err}</div></div>`); return; }
    const { T } = S;
    const { units, emps } = auto();
    const au = units.filter((x) => x.unit), ae = emps.filter((x) => x.emp);
    const n = (list) => list.reduce((a, x) => a + x.n, 0);
    const restU = units.filter((x) => !x.unit), restE = emps.filter((x) => !x.emp);
    const fmt = (v) => v.toLocaleString('en-US');
    mount(el, html`<div class="card-pad stack lnk">
      <p class="small muted" style="margin:0">«الجهة الطالبة» و«اسم الموظف» في المهام القديمة والمستوردة نصوص مكتوبة. الربط يصلها بوحدتها في الهيكل وبالموظف في قائمة الموظفين،
        فتظهر في التقارير حسب أي مستوى، وتزول عنها علامة «تحتاج مراجعة». النص الأصلي يبقى، و«آخر تعديل» للمهمة لا يتغير.</p>
      <div class="chips">
        <span class="chip">المهام ${fmt(T.tasks)}</span>
        <span class="chip">جهتها مربوطة ${fmt(T.linkedUnits)}</span>
        <span class="chip">موظفها مربوط ${fmt(T.linkedEmployees)}</span>
        <span class="chip">جهات غير مربوطة ${fmt(T.requesters.length)} (${fmt(n(units))} مهمة)</span>
        <span class="chip">موظفون غير مربوطين ${fmt(T.employees.length)} (${fmt(n(emps))} مهمة)</span>
      </div>
      <div class="lnk-auto">
        <h3>الربط التلقائي</h3>
        <p class="small muted" style="margin:0 0 8px">النص يطابق تماماً (بعد توحيد الهمزات والتاء المربوطة والمسافات) اسم وحدة واحدة أو اختصارها أو اسماً بديلاً لها،
          أو اسم موظف نشط واحد. الاسم المكرر لأكثر من وحدة أو موظف لا يُربط تلقائياً.</p>
        ${au.length || ae.length ? html`
          <div class="row"><button class="btn btn-primary" data-lnk-auto>${icon('check')}ربط ${fmt(au.length)} جهة (${fmt(n(au))} مهمة) و${fmt(ae.length)} موظف (${fmt(n(ae))} مهمة)</button></div>
          <details style="margin-top:8px"><summary class="small">عرض ما سيُربط</summary>
            <div class="table-wrap" style="max-height:40vh;margin-top:6px"><table class="table"><thead><tr><th>النص في المهام</th><th>المهام</th><th>يُربط بـ</th></tr></thead><tbody>
              ${au.slice(0, 300).map((x) => html`<tr><td>${x.text}</td><td class="num">${x.n}</td><td><b>${x.unit.name}</b> <span class="small muted">${S.D.unitLabel(x.unit.id)?.path || ''}</span></td></tr>`)}
              ${ae.slice(0, 300).map((x) => html`<tr><td>${x.text}</td><td class="num">${x.n}</td><td><b>${x.emp.nameAr}</b> <span class="small muted">${x.emp.employeeNo}</span></td></tr>`)}
            </tbody></table></div></details>`
          : html`<div class="small muted">لا يوجد ما يُربط تلقائياً.</div>`}
      </div>
      <div>
        <h3>غير المطابق: اختر لكل نص</h3>
        <div class="tabs" role="tablist" style="margin-bottom:10px">
          <button role="tab" data-lnk-kind="unit" class="${S.kind === 'unit' ? 'active' : ''}">الجهات (${fmt(restU.length)})</button>
          <button role="tab" data-lnk-kind="emp" class="${S.kind === 'emp' ? 'active' : ''}">الموظفون (${fmt(restE.length)})</button>
        </div>
        <div class="filters" style="padding:0 0 8px">${searchBox(S.q, 'بحث في النصوص…', 'lnk-q')}
          ${S.kind === 'unit' ? html`<label class="check"><input type="checkbox" data-lnk-alias ${S.alias ? 'checked' : ''}> حفظ النص اسماً بديلاً للوحدة (يُطابَق تلقائياً بعد ذلك)</label>` : ''}</div>
        <div data-lnk-rows></div>
      </div></div>`);
    drawRows();
  }

  function drawRows() {
    const box = $('[data-lnk-rows]', el);
    if (!box) return;
    const { units, emps } = auto();
    const list = (S.kind === 'unit' ? units.filter((x) => !x.unit) : emps.filter((x) => !x.emp));
    const words = queryWords(S.q);
    const shown = words.length ? list.filter((x) => words.every((w) => searchKey(x.text).includes(w))) : list;
    mount(box, html`${shown.length ? html`<div class="table-wrap"><table class="table lnk-table"><thead><tr><th>النص في المهام</th><th>المهام</th><th>${S.kind === 'unit' ? 'الوحدة' : 'الموظف'}</th><th></th></tr></thead>
      <tbody>${shown.slice(0, MAX).map((x, i) => html`<tr data-row="${i}"><td>${x.text}</td><td class="num">${x.n}</td><td class="lnk-pick" data-pick-row="${i}"></td>
        <td><button class="btn btn-sm" data-lnk-go="${i}" disabled>${icon('check')}ربط</button></td></tr>`)}</tbody></table></div>
      ${shown.length > MAX ? html`<div class="small muted" style="padding:6px 0">تظهر أول ${MAX} من ${shown.length.toLocaleString('en-US')} (الأكثر مهاماً أولاً). ابحث لتجد غيرها.</div>` : ''}`
      : html`<div class="small muted">${list.length ? 'لا نتائج.' : 'لا يوجد. كل النصوص مربوطة أو تُربط تلقائياً.'}</div>`}`);
    S.rows = shown.slice(0, MAX);
    S.pickers = S.rows.map((x, i) => {
      const cell = box.querySelector(`[data-pick-row="${i}"]`);
      const go = box.querySelector(`[data-lnk-go="${i}"]`);
      const D = S.D;
      const isU = S.kind === 'unit';
      const shortPath = (u) => D.M.ancestors(u).slice(-2).map((a) => a.name).join(' ← ');
      // يبدأ بالنص نفسه: التركيز يعرض نتائج البحث به، والاختيار من مدير النظام (لا يُختار شيء تلقائياً)
      const p = lookupField(cell, {
        id: `lnk-${S.kind}-${i}`, free: false, searchOnFocus: true, pickNote: 'اضغط الحقل واختر من النتائج', placeholder: isU ? 'ابحث عن الوحدة…' : 'ابحث عن الموظف…',
        value: { id: null, text: x.text },
        search: (q) => (isU ? D.searchUnits(q, 25).map((u) => ({ id: u.id, label: u.name, badge: D.M.level.get(u.levelId)?.name || '', sub: shortPath(u) }))
          : D.searchEmployees(q, 25).map((e) => ({ id: e.id, label: e.nameAr, sub: [e.employeeNo, D.unitAt(e.id)?.name].filter(Boolean).join(' · ') }))),
        describe: (id) => (isU ? (D.M.unit.get(id) ? { sub: shortPath(D.M.unit.get(id)) || 'وحدة رئيسية' } : null)
          : (D.emp.get(id) ? { sub: [D.emp.get(id).employeeNo, D.unitAt(id)?.name].filter(Boolean).join(' · ') } : null)),
        onChange: (v) => { go.disabled = !v.id; },
      });
      go.disabled = !p.value.id;
      return p;
    });
  }

  async function linkOne(i, btn) {
    const x = S.rows[i], p = S.pickers[i];
    const id = p.value.id;
    if (!id) return;
    await busy(btn, async () => {
      try {
        if (S.kind === 'unit') {
          if (S.alias) {
            const u = S.D.M.unit.get(id);
            if (u && !u.aliases.includes(x.text) && u.name !== x.text) await db.org.saveUnit({ ...u, aliases: [...u.aliases, x.text] });
          }
          const r = await db.tasks.linkApply([{ kind: 'unit', text: x.text, id }]);
          toast(`رُبطت ${r.units} مهمة بـ«${S.D.M.unit.get(id)?.name}»${S.alias ? '، وحُفظ النص اسماً بديلاً' : ''}.`, 'ok');
        } else {
          const r = await db.tasks.linkApply([{ kind: 'employee', text: x.text, id }]);
          toast(`رُبطت ${r.employees} مهمة بالموظف «${S.D.emp.get(id)?.nameAr}».`, 'ok');
        }
        refreshReviewCount();
        await load(); await reload?.();
        drawAll();
      } catch (e) { toastError(e); }
    });
  }

  on(body, 'click', '[data-lnk-auto]', (e, b) => busy(b, async () => {
    try {
      const { units, emps } = auto();
      const items = [...units.filter((x) => x.unit).map((x) => ({ kind: 'unit', text: x.text, id: x.unit.id })),
        ...emps.filter((x) => x.emp).map((x) => ({ kind: 'employee', text: x.text, id: x.emp.id }))];
      const r = await db.tasks.linkApply(items);
      toast(`رُبطت جهة ${r.units.toLocaleString('en-US')} مهمة، وموظف ${r.employees.toLocaleString('en-US')} مهمة.`, 'ok', 7000);
      refreshReviewCount();
      await load(); drawAll();
    } catch (er) { toastError(er); }
  }));
  on(body, 'click', '[data-lnk-kind]', (e, b) => { S.kind = b.dataset.lnkKind; S.q = ''; drawAll(); });
  on(body, 'click', '[data-lnk-go]', (e, b) => linkOne(Number(b.dataset.lnkGo), b));
  on(body, 'change', '[data-lnk-alias]', (e, c) => { S.alias = c.checked; });
  body.addEventListener('input', debounce((e) => { if (e.target.id === 'lnk-q') { S.q = e.target.value; drawRows(); } }, 200));

  return { draw };
}
