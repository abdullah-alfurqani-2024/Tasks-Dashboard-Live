/**
 * الهيكل التنظيمي (مدير النظام): الوحدات من مكتب الوزير حتى الأقسام، ومستوياتها، وسجل تغييراتها.
 * الهيكل كله بيانات: لا اسم وحدة ولا عدد مستويات في الكود. قاعدة البيانات تفرض القواعد نفسها مستقلة عن هذه الصفحة.
 */
import { db } from '../data/index.js';
import { html, mount, $, on, debounce } from '../core/dom.js';
import { userName } from '../core/store.js';
import { setTitle } from '../core/session.js';
import { icon } from '../ui/icons.js';
import { modal, busy, toast, toastError, confirmBox } from '../ui/feedback.js';
import { dataTable } from '../ui/table.js';
import { pageHead, options, loading, newPage, searchBox } from '../ui/parts.js';
import { normalizeAr, searchKey, queryWords, fmtDateTime, fmtDate, today } from '../core/format.js';
import { CONFIG } from '../config.js';
import { buildModel, pathText } from '../core/orgModel.js';
import { orgImportTab } from './orgImport.js';

const TABS = [['tree', 'الهيكل'], ['levels', 'المستويات'], ['import', 'الاستيراد'], ['log', 'سجل التغييرات']];
const OPEN_KEY = `${CONFIG.storagePrefix}org.open`;
const MAX_RESULTS = 200;

export default async function org(ctx, main) {
  setTitle('الهيكل التنظيمي');
  let tab = TABS.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'tree';
  const root = newPage(main);
  mount(root, html`
    ${pageHead({ title: 'الهيكل التنظيمي', sub: 'وحدات الوزارة من مكتب الوزير حتى الأقسام. أضف كل وحدة تحت الوحدة الأعلى منها، ونقل وحدة ينقل ما تحتها معها. الوحدة المستخدمة لا تُحذف؛ عطّلها بدلاً من ذلك.',
      actions: html`<button class="btn btn-primary" data-act="add-root">${icon('plus')}وحدة جديدة</button>` })}
    <div class="card">
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => html`<button role="tab" data-tab="${k}">${l}</button>`)}</div>
      <div id="body">${loading()}</div>
    </div>`);
  const body = $('#body', root);

  let M = null;          // نموذج الشجرة
  let q = '';            // نص البحث
  let showOff = false;   // إظهار المعطّلة
  let open = new Set();  // الوحدات المفتوحة في الشجرة
  try { open = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { /* */ }
  const saveOpen = () => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* */ } };

  async function reload() {
    M = buildModel(await db.org.load());
    for (const id of open) if (!M.unit.has(id)) open.delete(id);
  }

  /** رؤساء الوحدات وعدد موظفيها اليوم (من الإسنادات). إن لم تُجهَّز الموظفون بعد تبقى الصفحة كما هي */
  let P = null;
  async function loadPeople() {
    try {
      const [emps, asg, types] = await Promise.all([db.employees.list(), db.employees.assignments(), db.employees.types()]);
      const T = today();
      const name = new Map(emps.map((e) => [e.id, e.nameAr]));
      const primary = new Set(types.filter((t) => t.isPrimary).map((t) => t.id));
      P = { total: asg.length, head: new Map(), acting: new Map(), count: new Map(), empName: name, typeName: new Map(types.map((t) => [t.id, t.name])) };
      for (const a of asg) {
        if (!(a.startDate <= T && (!a.endDate || a.endDate >= T))) continue;
        const isP = primary.has(a.typeId);
        if (isP) P.count.set(a.unitId, (P.count.get(a.unitId) || 0) + 1);
        if (a.isHead) (isP ? P.head : P.acting).set(a.unitId, name.get(a.employeeId) || '');
      }
    } catch { P = null; }
  }

  /* ───────────── تبويب الهيكل ───────────── */
  function drawTree() {
    const total = M.units.length, active = M.units.filter((u) => u.isActive).length;
    if (!total) {
      mount(body, html`<div class="empty">${icon('org')}
        <div style="font-weight:600;margin-bottom:4px">الهيكل فارغ</div>
        <div>ابدأ بالوحدة الرئيسية (مثل «مكتب الوزير»)، ثم أضف تحتها الوحدات التابعة لها مستوى بعد مستوى.</div>
        <p><button class="btn btn-primary" data-act="add-root">${icon('plus')}إضافة الوحدة الرئيسية</button></p></div>`);
      return;
    }
    mount(body, html`
      <div class="filters org-tools">
        <div class="field wide">${searchBox(q, 'ابحث بالاسم أو الاختصار أو الرمز الرسمي…', 'org-q')}</div>
        <label class="check"><input type="checkbox" data-act="show-off" ${showOff ? 'checked' : ''}> إظهار المعطّلة</label>
        <div class="btns">
          <button class="btn btn-sm" data-act="expand">فتح الكل</button>
          <button class="btn btn-sm" data-act="collapse">طي الكل</button>
        </div>
        <span class="small muted org-count">${total.toLocaleString('en-US')} وحدة${active < total ? html`، منها ${(total - active).toLocaleString('en-US')} معطّلة` : ''}</span>
      </div>
      <div id="tree" class="org-tree"></div>`);
    drawNodes();
  }

  const visible = (u) => showOff || u.isActive;

  function row(u, depth, { withPath = false } = {}) {
    const kids = M.childrenOf(u.id).filter(visible);
    const lv = M.level.get(u.levelId);
    const isOpen = open.has(u.id);
    const leaf = !M.childrenOf(u.id).length;
    return html`<div class="org-row ${u.isActive ? '' : 'off'}" data-id="${u.id}" style="--d:${depth}">
      ${!withPath && kids.length
        ? html`<button class="org-tog" data-tog="${u.id}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'طي' : 'فتح'}">${icon(isOpen ? 'chevronDown' : 'chevronLeft')}</button>`
        : html`<span class="org-tog" aria-hidden="true">${withPath ? '' : icon('dot')}</span>`}
      <div class="org-main">
        <div class="org-line">
          <button class="org-name" data-name="${u.id}">${u.name}</button>
          ${u.shortName ? html`<span class="small muted">(${u.shortName})</span>` : ''}
          <span class="badge">${lv?.name || '—'}</span>
          ${u.code ? html`<span class="small muted ltr" title="الرمز الرسمي">${u.code}</span>` : ''}
          ${!withPath && kids.length ? html`<span class="small muted">${kids.length} تابعة</span>` : ''}
          ${u.isActive ? '' : html`<span class="badge warn">معطّلة</span>`}
          ${P ? peopleLine(u, lv) : ''}
        </div>
        ${withPath ? html`<div class="small muted org-path">${pathText(M, u) || 'وحدة رئيسية'}</div>` : ''}
      </div>
      <div class="org-act">
        ${u.isActive ? html`<button class="btn btn-ghost btn-icon btn-sm" data-act="add-child" data-id="${u.id}" title="إضافة وحدة تابعة" aria-label="إضافة وحدة تابعة">${icon('plus')}</button>` : ''}
        <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" data-id="${u.id}" title="تعديل" aria-label="تعديل">${icon('edit')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-act="move" data-id="${u.id}" title="نقل إلى وحدة أخرى" aria-label="نقل">${icon('move')}</button>
        <button class="btn btn-ghost btn-icon btn-sm" data-act="toggle" data-id="${u.id}" title="${u.isActive ? 'تعطيل' : 'تفعيل'}" aria-label="${u.isActive ? 'تعطيل' : 'تفعيل'}">${icon(u.isActive ? 'ban' : 'restore')}</button>
        ${leaf ? html`<button class="btn btn-ghost btn-icon btn-sm danger" data-act="delete" data-id="${u.id}" title="حذف (لتصحيح خطأ)" aria-label="حذف">${icon('trash')}</button>` : ''}
      </div>
    </div>`;
  }

  function peopleLine(u, lv) {
    const title = lv?.headTitle || 'الرئيس';
    const h = P.head.get(u.id), a = P.acting.get(u.id), n = P.count.get(u.id) || 0;
    return html`${h ? html`<span class="org-head">${title}: ${h}</span>` : ''}
      ${a ? html`<span class="org-head acting">قائم بأعمال ${title}: ${a}</span>` : ''}
      ${n ? html`<span class="small muted" title="الموظفون الأصيلون فيها اليوم">${n.toLocaleString('en-US')} موظف</span>` : ''}`;
  }

  function drawNodes() {
    const box = $('#tree', body);
    if (!box) return;
    const words = queryWords(q);
    if (words.length) {
      const hits = M.units.filter((u) => visible(u) && words.every((w) => M.searchText.get(u.id).includes(w)));
      mount(box, hits.length
        ? html`${hits.slice(0, MAX_RESULTS).map((u) => row(u, 0, { withPath: true }))}
          ${hits.length > MAX_RESULTS ? html`<div class="card-pad small muted">تظهر أول ${MAX_RESULTS} نتيجة من ${hits.length}. اكتب كلمات أكثر لتضييق البحث.</div>` : ''}`
        : html`<div class="empty">${icon('search')}<div>لا توجد وحدة بهذا الاسم${showOff ? '' : ' (المعطّلة مخفية)'}.</div></div>`);
      return;
    }
    const out = [];
    const walk = (parentId, depth) => {
      for (const u of M.childrenOf(parentId)) {
        if (!visible(u)) continue;
        out.push(row(u, depth));
        if (open.has(u.id)) walk(u.id, depth + 1);
      }
    };
    walk(0, 0);
    mount(box, out.length ? html`${out}` : html`<div class="empty">${icon('empty')}<div>كل الوحدات معطّلة. فعّل «إظهار المعطّلة» لرؤيتها.</div></div>`);
  }

  /** فتح الشجرة حتى الوحدة وإظهارها */
  function reveal(id) {
    const u = M.unit.get(id);
    if (!u) return;
    for (const a of M.ancestors(u)) open.add(a.id);
    if (!u.isActive) showOff = true;
    saveOpen();
    q = '';
    drawTree();
    const el = $(`.org-row[data-id="${id}"]`, body);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); }
  }

  /* ───────────── نافذة الوحدة: إضافة وتعديل ───────────── */
  function allowedLevels(parent, unit) {
    const pNo = parent ? M.levelNo(parent) : -Infinity;
    const kidNos = unit ? M.childrenOf(unit.id).map(M.levelNo) : [];
    const cNo = kidNos.length ? Math.min(...kidNos) : Infinity;
    return M.levels.filter((l) => (l.isActive || l.id === unit?.levelId) && l.levelNo > pNo && l.levelNo < cNo);
  }

  /** الوحدات بترتيب الشجرة (الأم ثم ما تحتها)، عدا ما تحت except */
  function treeOrder(except = new Set()) {
    const out = [];
    const walk = (pid) => { for (const c of M.childrenOf(pid)) { if (!except.has(c.id)) { out.push(c); walk(c.id); } } };
    walk(0);
    return out;
  }
  const fullPath = (u) => [...M.ancestors(u), u].map((a) => a.name).join(' ← ');

  function unitForm({ unit = null, parentId = null }) {
    const isNew = !unit;
    let parent = M.unit.get(isNew ? parentId : unit.parentId) || null;
    const activeNos = M.levels.filter((l) => l.isActive).map((l) => l.levelNo);
    const maxNo = activeNos.length ? Math.max(...activeNos) : -Infinity;
    if (!allowedLevels(parent, unit).length) {
      toastError({ message: parent ? `لا يوجد مستوى مفعّل أدنى من مستوى «${M.level.get(parent.levelId)?.name}». أضف مستوى من تبويب «المستويات».` : 'لا يوجد مستوى مفعّل. أضف مستوى من تبويب «المستويات».' });
      return;
    }
    // ترتيب العرض الافتراضي: بعد الوحدات التابعة للأم نفسها (أم فيها وحدتان ← 3، أول وحدة ← 1)
    const nextOrder = () => M.childrenOf(parent?.id || 0).length + 1;
    // الوحدات التي يمكن أن تكون أماً لوحدة جديدة: مفعّلة، ويوجد مستوى مفعّل أدنى منها
    // (تُحسب من الهيكل الحالي في كل مرة: «إضافة وأخرى» تضيف وحدات أثناء فتح النافذة)
    const parentList = () => (isNew ? treeOrder().filter((t) => t.isActive && M.levelNo(t) < maxNo) : []);
    const ptext = (t) => searchKey(`${fullPath(t)} ${t.shortName} ${t.code} ${(t.aliases || []).join(' ')}`);
    const hasParents = parentList().length > 0;
    const m = modal({
      title: isNew ? 'وحدة جديدة' : `تعديل: ${unit.name}`,
      body: html`<form class="form-grid" novalidate>
        <div class="field span-2"><span class="label">الوحدة الأعلى <span class="req">*</span></span>
          <div class="org-where">
            <span data-where></span>
            ${isNew ? html`<button type="button" class="btn btn-sm" data-change>${icon('edit')}تغيير</button>`
              : html`<button type="button" class="btn btn-sm" data-move>${icon('move')}نقل…</button>`}
          </div>
          <div data-picker hidden>
            ${searchBox('', 'ابحث عن الوحدة الأعلى…', 'o-pq')}
            <div class="org-pick" data-plist></div>
          </div>
          <span class="hint">${isNew ? 'اختر الوحدة التي تتبعها هذه الوحدة، أو «بدون وحدة أعلى» للوحدة الرئيسية (مثل مكتب الوزير). ويمكن أيضاً الإضافة من زر «+» بجانب أي وحدة في الشجرة.'
            : 'لنقلها إلى وحدة أعلى أخرى (مع كل ما تحتها) استخدم «نقل».'}</span></div>
        <div class="field span-2"><label for="o-name">اسم الوحدة <span class="req">*</span></label>
          <input class="input" id="o-name" name="name" value="${unit?.name || ''}" maxlength="200" required ${isNew && !parent && hasParents ? '' : 'autofocus'}></div>
        <div class="field"><label for="o-level">المستوى <span class="req">*</span></label>
          <select class="input" id="o-level" name="levelId"></select>
          <span class="hint" data-level-hint></span></div>
        <div class="field"><label for="o-order">ترتيب العرض</label>
          <input class="input num" id="o-order" name="sortOrder" type="number" min="0" value="${unit?.sortOrder ?? nextOrder()}">
          <span class="hint">ترتيب ظهورها بين الوحدات التابعة لنفس الوحدة الأعلى: الأصغر أولاً، وعند التساوي أبجدياً.</span></div>
        <div class="field"><label for="o-short">الاختصار</label>
          <input class="input" id="o-short" name="shortName" value="${unit?.shortName || ''}" maxlength="60" placeholder="اختياري">
          <span class="hint">يظهر بجانب الاسم في الشجرة، ويمكن البحث به.</span></div>
        <div class="field"><label for="o-code">الرمز الرسمي</label>
          <input class="input ltr" style="display:block;text-align:left" id="o-code" name="code" value="${unit?.code || ''}" maxlength="30" placeholder="اختياري، لا يتكرر">
          <span class="hint">رمز الوحدة المعتمد في الوزارة إن وُجد (مثل نظام الموارد البشرية).</span></div>
        <div class="field span-2"><label for="o-alias">أسماء بديلة</label>
          <textarea class="input" id="o-alias" name="aliases" rows="3" placeholder="سطر لكل اسم">${(unit?.aliases || []).join('\n')}</textarea>
          <span class="hint">الأسماء الأخرى التي تُكتب بها هذه الوحدة (في Google Sheets مثلاً). ستُستخدم لاحقاً لمطابقة «الجهة الطالبة» تلقائياً عند الاستيراد.</span></div>
        <div class="alert bad span-2" data-err hidden></div>
      </form>`,
      footer: html`<button class="btn btn-primary" data-save>${icon('check')}${isNew ? 'إضافة' : 'حفظ'}</button>
        ${isNew ? html`<button class="btn" data-save-more title="تبقى النافذة مفتوحة لإضافة وحدة أخرى تحت الوحدة الأعلى نفسها">${icon('plus')}إضافة وأخرى</button>` : ''}
        <button class="btn" data-x>إلغاء</button>`,
    });

    /** المكان والمستويات المسموحة حسب الوحدة الأعلى الحالية */
    const levelSel = $('#o-level', m.el);
    function applyParent(reset = false) {
      mount($('[data-where]', m.el), parent ? html`<b>${parent.name}</b> <span class="badge">${M.level.get(parent.levelId)?.name}</span>
        ${M.ancestors(parent).length ? html`<div class="small muted">${M.ancestors(parent).map((a) => a.name).join(' ← ')}</div>` : ''}`
        : html`<b>بدون وحدة أعلى</b> <span class="small muted">— وحدة رئيسية في أعلى الهيكل</span>`);
      const levels = allowedLevels(parent, unit);
      // وحدة جديدة: المستوى التالي تحت الأم افتراضياً
      const keep = !reset && levels.some((l) => String(l.id) === levelSel.value) ? levelSel.value : (unit?.levelId ?? levels[0]?.id);
      mount(levelSel, options(levels.map((l) => ({ id: l.id, name: l.name, isActive: l.isActive })), keep));
      mount($('[data-level-hint]', m.el), html`${parent ? `المستويات الأدنى من «${M.level.get(parent.levelId)?.name}» فقط.` : 'الوحدة الرئيسية عادة «مكتب الوزير».'}`);
      if (isNew) $('#o-order', m.el).value = nextOrder();
    }
    applyParent();

    if (isNew) {
      const picker = $('[data-picker]', m.el), plist = $('[data-plist]', m.el), pq = $('#o-pq', m.el);
      const drawPicks = () => {
        const words = queryWords(pq.value);
        const nq = words.length > 0;
        const hits = parentList().filter((t) => { const x = ptext(t); return words.every((w) => x.includes(w)); });
        mount(plist, html`
          ${!nq ? html`<button type="button" class="org-opt ${!parent ? 'on' : ''}" data-pick="0"><b>بدون وحدة أعلى</b><span class="small muted">وحدة رئيسية في أعلى الهيكل (مثل مكتب الوزير)</span></button>` : ''}
          ${hits.slice(0, 100).map((t) => html`<button type="button" class="org-opt ${parent?.id === t.id ? 'on' : ''}" data-pick="${t.id}">
            <b>${t.name}</b> <span class="badge">${M.level.get(t.levelId)?.name}</span><span class="small muted">${pathText(M, t) || 'وحدة رئيسية'}</span></button>`)}
          ${hits.length > 100 ? html`<div class="small muted card-pad">تظهر أول 100 من ${hits.length}. اكتب للبحث.</div>` : ''}
          ${nq && !hits.length ? html`<div class="small muted card-pad">لا توجد وحدة بهذا الاسم.</div>` : ''}`);
      };
      const openPicker = () => { picker.hidden = false; pq.value = ''; drawPicks(); pq.focus(); };
      $('[data-change]', m.el).onclick = () => (picker.hidden ? openPicker() : (picker.hidden = true));
      pq.addEventListener('input', debounce(drawPicks, 120));
      pq.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); drawPicks(); plist.querySelector('[data-pick]:not([data-pick="0"])')?.click(); } });
      on(plist, 'click', '[data-pick]', (e, b) => {
        parent = M.unit.get(Number(b.dataset.pick)) || null;   // M الحالي (بعد آخر حفظ)
        picker.hidden = true;
        applyParent(true);
        $('#o-name', m.el).focus();
      });
      // «وحدة جديدة» من أعلى الصفحة والهيكل فيه وحدات: يبدأ باختيار الوحدة الأعلى
      if (!parent && hasParents) openPicker();
    } else {
      $('[data-move]', m.el).onclick = () => { m.close(); moveForm(unit); };
    }

    const f = $('form', m.el);
    const err = $('[data-err]', m.el);
    const fail = (t) => { err.textContent = t; err.hidden = false; };
    f.addEventListener('input', () => { err.hidden = true; });
    $('[data-x]', m.el).onclick = () => m.close();
    let added = 0;
    const submit = async (more, btn) => {
      const v = Object.fromEntries(['name', 'levelId', 'sortOrder', 'shortName', 'code', 'aliases'].map((k) => [k, f.elements[k].value]));
      const name = v.name.replace(/\s+/g, ' ').trim();
      if (!name) { f.elements.name.focus(); return fail('اكتب اسم الوحدة.'); }
      if (M.childrenOf(parent?.id || 0).some((s) => s.id !== unit?.id && normalizeAr(s.name) === normalizeAr(name))) return fail(`توجد وحدة باسم «${name}» تحت «${parent?.name || 'أعلى الهيكل'}».`);
      const item = {
        id: unit?.id, parentId: parent?.id || null, levelId: Number(v.levelId), name,
        sortOrder: Number(v.sortOrder) || 0, shortName: v.shortName.trim(), code: v.code.trim(),
        aliases: v.aliases.split(/\r?\n|،|,/).map((s) => s.trim()).filter(Boolean),
      };
      await busy(btn, async () => {
        try {
          const saved = await db.org.saveUnit(item);
          if (parent) open.add(parent.id);
          saveOpen();
          await reload();
          drawTree();
          if (more) {
            added++;
            toast(`أُضيفت «${saved.name}» (${added} في هذه النافذة).`, 'ok', 2500);
            f.elements.name.value = ''; f.elements.shortName.value = ''; f.elements.code.value = ''; f.elements.aliases.value = '';
            f.elements.sortOrder.value = nextOrder();
            f.elements.name.focus();
          } else {
            m.close();
            toast(isNew ? 'أُضيفت الوحدة.' : 'تم الحفظ.', 'ok', 2000);
            reveal(saved.id);
          }
        } catch (e) { fail(e.message); }
      });
    };
    $('[data-save]', m.el).onclick = (e) => submit(false, e.currentTarget);
    const more = $('[data-save-more]', m.el);
    if (more) more.onclick = (e) => submit(true, e.currentTarget);
    f.onsubmit = (e) => { e.preventDefault(); submit(false, $('[data-save]', m.el)); };
  }

  /* ───────────── النقل ───────────── */
  function moveForm(unit) {
    const inside = new Set(M.subtree(unit.id));
    const myNo = M.levelNo(unit);
    const count = inside.size - 1;
    // بترتيب الشجرة نفسه (الأم ثم ما تحتها)
    const ordered = [];
    const walk = (pid) => { for (const c of M.childrenOf(pid)) { if (!inside.has(c.id)) { ordered.push(c); walk(c.id); } } };
    walk(0);
    const targets = ordered.filter((t) => M.levelNo(t) < myNo && (t.isActive || !unit.isActive))
      .map((t) => ({ t, path: [...M.ancestors(t), t].map((a) => a.name).join(' ← ') }));
    const text = new Map(targets.map(({ t, path }) => [t.id, searchKey(`${path} ${t.shortName} ${t.code} ${(t.aliases || []).join(' ')}`)]));
    let pick = null;  // 0 = وحدة رئيسية
    const m = modal({
      title: `نقل: ${unit.name}`,
      body: html`<p style="margin-top:0">مكانها الحالي: <b>${pathText(M, unit) || 'وحدة رئيسية'}</b>.
        ${count ? html`ستنتقل معها <b>${count}</b> وحدة تابعة.` : ''}</p>
        ${searchBox('', 'ابحث عن الوحدة الأعلى الجديدة…', 'mv-q')}
        <div class="org-pick" id="mv-list"></div>
        <p class="small muted" style="margin-bottom:0">تظهر الوحدات في مستوى أعلى من «${M.level.get(unit.levelId)?.name}» فقط${unit.isActive ? '، والمفعّلة' : ''}.</p>
        <div class="alert bad" data-err hidden></div>`,
      footer: html`<button class="btn btn-primary" data-ok disabled>${icon('move')}نقل</button><button class="btn" data-x>إلغاء</button>`,
    });
    const list = $('#mv-list', m.el), ok = $('[data-ok]', m.el), err = $('[data-err]', m.el);
    const draw = () => {
      const words = queryWords($('#mv-q', m.el).value);
      const nq = words.length > 0;
      const hits = targets.filter(({ t }) => t.id !== unit.parentId && words.every((w) => text.get(t.id).includes(w)));
      mount(list, html`
        ${unit.parentId && !nq ? html`<button type="button" class="org-opt ${pick === 0 ? 'on' : ''}" data-pick="0"><b>بدون وحدة أعلى</b><span class="small muted">تصبح وحدة رئيسية</span></button>` : ''}
        ${hits.slice(0, 100).map(({ t, path }) => html`<button type="button" class="org-opt ${pick === t.id ? 'on' : ''}" data-pick="${t.id}">
          <b>${t.name}</b> <span class="badge">${M.level.get(t.levelId)?.name}</span><span class="small muted">${path}</span></button>`)}
        ${hits.length > 100 ? html`<div class="small muted card-pad">تظهر أول 100 من ${hits.length}. اكتب للبحث.</div>` : ''}
        ${!hits.length && !(unit.parentId && !nq) ? html`<div class="small muted card-pad">لا توجد وحدة مناسبة.</div>` : ''}`);
    };
    draw();
    $('#mv-q', m.el).addEventListener('input', debounce(draw, 120));
    on(list, 'click', '[data-pick]', (e, b) => { pick = Number(b.dataset.pick); ok.disabled = false; err.hidden = true; draw(); });
    $('[data-x]', m.el).onclick = () => m.close();
    ok.onclick = () => busy(ok, async () => {
      try {
        // تأتي في آخر الوحدات التابعة للأم الجديدة
        await db.org.saveUnit({ ...unit, parentId: pick || null, sortOrder: M.childrenOf(pick || 0).length + 1 });
        if (pick) open.add(pick);
        m.close();
        await reload();
        toast('نُقلت الوحدة.', 'ok', 2000);
        reveal(unit.id);
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  }

  /* ───────────── التفعيل والتعطيل والحذف ───────────── */
  async function toggle(unit) {
    const below = M.subtree(unit.id).slice(1).map((id) => M.unit.get(id));
    if (unit.isActive) {
      const n = below.filter((u) => u.isActive).length;
      if (!(await confirmBox({
        title: 'تعطيل الوحدة',
        message: `تعطيل «${unit.name}»${n ? ` و${n} وحدة تحتها` : ''}؟ تختفي من الاختيار في الإدخال الجديد، وتبقى في البيانات القديمة. يمكن تفعيلها لاحقاً.`,
        okText: 'تعطيل', danger: true,
      }))) return;
      return run(() => db.org.setActive(unit.id, false), (k) => `عُطّلت ${k} وحدة.`);
    }
    const parent = M.unit.get(unit.parentId);
    if (parent && !parent.isActive) return toastError({ message: `الوحدة الأعلى «${parent.name}» معطّلة؛ فعّلها أولاً.` });
    const off = below.filter((u) => !u.isActive).length;
    if (!off) return run(() => db.org.setActive(unit.id, true), () => 'فُعّلت الوحدة.');
    const m = modal({
      title: 'تفعيل الوحدة', size: 'sm',
      body: html`<p style="margin:0">تحت «${unit.name}» ${off} وحدة معطّلة. هل تفعّلها معها؟</p>`,
      footer: html`<button class="btn btn-primary" data-all>تفعيلها مع كل ما تحتها</button><button class="btn" data-one>تفعيلها وحدها</button><button class="btn" data-x>إلغاء</button>`,
    });
    $('[data-x]', m.el).onclick = () => m.close();
    $('[data-one]', m.el).onclick = () => { m.close(); run(() => db.org.setActive(unit.id, true, false), () => 'فُعّلت الوحدة.'); };
    $('[data-all]', m.el).onclick = () => { m.close(); run(() => db.org.setActive(unit.id, true, true), (k) => `فُعّلت ${k} وحدة.`); };
  }

  async function remove(unit) {
    if (!(await confirmBox({
      title: 'حذف الوحدة',
      message: `حذف «${unit.name}» نهائياً؟ الحذف لتصحيح خطأ في الإدخال فقط؛ الوحدة التي توقف عملها تُعطَّل بدلاً من حذفها.`,
      okText: 'حذف', danger: true,
    }))) return;
    run(() => db.org.deleteUnit(unit.id), () => 'حُذفت الوحدة.');
  }

  async function run(fn, msg) {
    try {
      const r = await fn();
      await reload();
      drawTree();
      toast(msg(r), 'ok', 2500);
    } catch (e) { toastError(e); }
  }

  /* ───────────── تبويب المستويات ───────────── */
  function drawLevels() {
    const used = new Map();
    for (const u of M.units) used.set(u.levelId, (used.get(u.levelId) || 0) + 1);
    const nextNo = Math.max(0, ...M.levels.map((l) => l.levelNo)) + 10;
    const row = (l) => html`<form class="list-row org-lv" data-id="${l?.id || ''}" novalidate>
      <input class="input num" name="levelNo" type="number" min="1" max="9999" value="${l?.levelNo ?? nextNo}" aria-label="الترتيب">
      <input class="input" name="name" value="${l?.name || ''}" maxlength="80" placeholder="${l ? '' : 'مستوى جديد…'}" aria-label="اسم المستوى" required>
      <input class="input hide-sm" name="headTitle" value="${l?.headTitle || ''}" maxlength="80" placeholder="${l ? '' : 'مسمى المسؤول'}" aria-label="مسمى المسؤول">
      <span class="small muted hide-sm">${l ? `${(used.get(l.id) || 0).toLocaleString('en-US')} وحدة` : ''}</span>
      <label class="check hide-sm"><input type="checkbox" name="isActive" ${l?.isActive !== false ? 'checked' : ''}> مفعّل</label>
      <div class="row-actions">
        <button class="btn btn-sm ${l ? '' : 'btn-primary'}" type="submit">${l ? icon('check') : icon('plus')}${l ? 'حفظ' : 'إضافة'}</button>
        ${l && !used.get(l.id) ? html`<button class="btn btn-sm btn-ghost danger" type="button" data-del-level="${l.id}" title="حذف المستوى (غير مستخدم)" aria-label="حذف">${icon('trash')}</button>` : ''}
      </div>
    </form>`;
    mount(body, html`
      <div class="list-row org-lv head"><span>الترتيب</span><span>المستوى</span><span class="hide-sm">مسمى المسؤول</span><span class="hide-sm">الاستخدام</span><span class="hide-sm">الحالة</span><span></span></div>
      ${M.levels.map(row)}
      ${row(null)}
      <div class="card-pad small muted">الترتيب يحدد مكان المستوى في الهيكل: الأصغر أعلى. الوحدة تتبع وحدة من مستوى أعلى منها فقط، ويمكن تخطي مستوى (قسم تابع لمديرية مباشرة).
        الأرقام بفراغات (10، 20، 30…) حتى يمكن إدخال مستوى بينها، مثل «مكتب مساعد الوكيل» برقم 25.
        المستوى المعطّل لا يُختار لوحدة جديدة، وتبقى وحداته كما هي.</div>`);
  }

  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('form.org-lv');
    if (!f) return;
    e.preventDefault();
    const id = f.dataset.id ? Number(f.dataset.id) : null;
    const name = f.elements.name.value.trim();
    const no = Number(f.elements.levelNo.value);
    if (!name) { f.elements.name.focus(); return toastError({ message: 'اكتب اسم المستوى.' }); }
    if (!Number.isInteger(no) || no < 1 || no > 9999) { f.elements.levelNo.focus(); return toastError({ message: 'الترتيب رقم صحيح من 1 إلى 9999.' }); }
    await busy(f.querySelector('button[type=submit]'), async () => {
      try {
        await db.org.saveLevel({ id, name, levelNo: no, headTitle: f.elements.headTitle.value.trim(), isActive: f.elements.isActive.checked });
        await reload();
        toast(id ? 'تم الحفظ.' : 'أُضيف المستوى.', 'ok', 2000);
        drawLevels();
      } catch (err) { toastError(err); }
    });
  });

  /* ───────────── تبويب السجل ───────────── */
  const FIELD = {
    name: 'الاسم', parent_id: 'الوحدة الأعلى', level_id: 'المستوى', short_name: 'الاختصار', code: 'الرمز الرسمي', aliases: 'الأسماء البديلة',
    sort_order: 'ترتيب العرض', is_active: 'الحالة', level_no: 'الترتيب', head_title: 'مسمى المسؤول',
    civil_no: 'الرقم المدني', employee_no: 'الرقم الوظيفي', name_ar: 'الاسم بالعربي', name_en: 'الاسم بالإنجليزي',
    unit_id: 'الوحدة', type_id: 'النوع', is_head: 'الرئاسة', start_date: 'من', end_date: 'إلى', notes: 'ملاحظات', implies_head: 'رئاسة',
  };
  const ACTION = { insert: ['إضافة', 'ok'], update: ['تعديل', 'info'], delete: ['حذف', 'bad'] };
  function show(k, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
    if (k === 'is_active') return v ? 'مفعّلة' : 'معطّلة';
    if (k === 'parent_id') return M.unit.get(v)?.name || `#${v}`;
    if (k === 'level_id') return M.level.get(v)?.name || `#${v}`;
    if (k === 'unit_id') return M.unit.get(v)?.name || `#${v}`;
    if (k === 'type_id') return P?.typeName.get(v) || `#${v}`;
    if (k === 'is_head' || k === 'implies_head') return v ? 'نعم' : 'لا';
    if (k === 'start_date' || k === 'end_date') return fmtDate(v);
    if (Array.isArray(v)) return v.join('، ');
    return String(v);
  }
  async function drawLog() {
    mount(body, loading());
    try {
      const rows = await db.org.audit({ limit: 500 });
      const el = document.createElement('div');
      body.replaceChildren(el);
      dataTable(el, {
        rows, sortKey: 'changedAt', sortDir: 'desc', pageSize: 50, empty: 'لا توجد تغييرات بعد.',
        columns: [
          { key: 'changedAt', label: 'الوقت', cls: 'num', render: (r) => html`<span class="ltr">${fmtDateTime(r.changedAt)}</span>` },
          { key: 'changedBy', label: 'بواسطة', sort: (r) => userName(r.changedBy), render: (r) => (r.changedBy ? userName(r.changedBy) : '—') },
          { key: 'action', label: 'العملية', render: (r) => html`<span class="badge ${ACTION[r.action][1]}">${ACTION[r.action][0]}</span>` },
          { key: 'entity', label: 'على', sort: false, render: (r) => {
            const d = r.newData || r.oldData || {};
            if (r.entity === 'employee') return html`<b>${d.name_ar}</b><div class="small muted">موظف</div>`;
            if (r.entity === 'assignment') return html`<b>${P?.empName.get(d.employee_id) || `#${d.employee_id}`}</b><div class="small muted">إسناد</div>`;
            if (r.entity === 'assignment_type') return html`<b>${d.name}</b><div class="small muted">نوع إسناد</div>`;
            return html`<b>${d.name || `#${r.entityId}`}</b><div class="small muted">${r.entity === 'level' ? 'مستوى' : (M.level.get(d.level_id)?.name || 'وحدة')}</div>`;
          } },
          { key: 'details', label: 'التفاصيل', sort: false, render: (r) => {
            if (r.action === 'update') {
              return html`<div class="diff">${(r.changedFields || []).map((k) => html`<div>${FIELD[k] || k}: <span class="old">${show(k, r.oldData?.[k])}</span> ← <span class="new">${show(k, r.newData?.[k])}</span></div>`)}</div>`;
            }
            const d = r.newData || r.oldData || {};
            if (r.entity === 'level') return html`<span class="small muted">الترتيب ${d.level_no}${d.head_title ? ` — ${d.head_title}` : ''}</span>`;
            if (r.entity === 'employee' && !r.entityId) return html`<span class="small muted">${d.employees} موظف و${d.assignments} إسناد</span>`;
            if (r.entity === 'unit' && !r.entityId) return html`<span class="small muted">${d.units} وحدة و${d.assignments} إسناد</span>`;
            if (r.entity === 'employee') return html`<span class="small muted ltr">${d.civil_no || ''}</span>`;
            if (r.entity === 'assignment_type') return '';
            if (r.entity === 'assignment') return html`<span class="small muted">${show('type_id', d.type_id)} في «${show('unit_id', d.unit_id)}»${d.is_head ? ' (رئاسة)' : ''}، من ${fmtDate(d.start_date)}${d.end_date ? ` إلى ${fmtDate(d.end_date)}` : ''}</span>`;
            return html`<span class="small muted">${d.parent_id ? `تحت «${show('parent_id', d.parent_id)}»` : 'وحدة رئيسية'}</span>`;
          } },
        ],
      });
    } catch (e) { mount(body, html`<div class="card-pad"><div class="alert bad">${e.message}</div></div>`); }
  }

  /* ───────────── الأحداث ───────────── */
  const imp = orgImportTab({
    body, model: () => M, people: () => P,
    reload: async () => { await Promise.all([reload(), loadPeople()]); },
    onChanged: () => { if (tab === 'import') imp.draw(); },
  });

  function draw() {
    root.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    $('.page-head [data-act="add-root"]', root).hidden = tab !== 'tree';
    if (tab === 'tree') drawTree();
    else if (tab === 'levels') drawLevels();
    else if (tab === 'import') imp.draw();
    else drawLog();
  }

  on(root, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; history.replaceState(null, '', `#/org?tab=${tab}`); draw(); });
  on(root, 'click', '[data-tog]', (e, b) => {
    const id = Number(b.dataset.tog);
    open.has(id) ? open.delete(id) : open.add(id);
    saveOpen(); drawNodes();
  });
  on(root, 'click', '[data-name]', (e, b) => {
    const id = Number(b.dataset.name);
    if (q) return reveal(id);   // من نتائج البحث: عرضها في الشجرة
    if (!M.childrenOf(id).some(visible)) return;
    open.has(id) ? open.delete(id) : open.add(id);
    saveOpen(); drawNodes();
  });
  on(root, 'click', '[data-act]', (e, b) => {
    const act = b.dataset.act;
    const unit = b.dataset.id ? M?.unit.get(Number(b.dataset.id)) : null;
    if (act === 'add-root') { if (M) unitForm({ parentId: null }); }
    else if (act === 'add-child') unitForm({ parentId: unit.id });
    else if (act === 'edit') unitForm({ unit });
    else if (act === 'move') moveForm(unit);
    else if (act === 'toggle') toggle(unit);
    else if (act === 'delete') remove(unit);
    else if (act === 'expand') { M.units.forEach((u) => { if (M.childrenOf(u.id).length) open.add(u.id); }); saveOpen(); drawNodes(); }
    else if (act === 'collapse') { open.clear(); saveOpen(); drawNodes(); }
  });
  on(root, 'change', '[data-act="show-off"]', (e, c) => { showOff = c.checked; drawNodes(); });
  on(root, 'click', '[data-del-level]', async (e, b) => {
    const l = M.level.get(Number(b.dataset.delLevel));
    if (!(await confirmBox({ title: 'حذف المستوى', message: `حذف المستوى «${l.name}»؟`, okText: 'حذف', danger: true }))) return;
    try { await db.org.deleteLevel(l.id); await reload(); toast('حُذف المستوى.', 'ok', 2000); drawLevels(); } catch (err) { toastError(err); }
  });
  const onSearch = debounce(() => drawNodes(), 150);
  root.addEventListener('input', (e) => { if (e.target.id === 'org-q') { q = e.target.value; onSearch(); } });

  try {
    await Promise.all([reload(), loadPeople()]);
    draw();
  } catch (e) {
    mount(body, html`<div class="card-pad"><div class="alert bad">${e.message}</div></div>`);
  }
}
