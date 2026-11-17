/**
 * التلميح عند الوقوف بالفأرة بخط النظام (كل المتصفحات).
 *
 * تلميح المتصفح الأصلي (خاصية title، و<title> داخل رسوم SVG) يرسمه المتصفح بخط الجهاز.
 * هنا يُعرض بدله تلميح داخل الصفحة. لا يلزم تغيير أي شاشة: تبقى title في الكود كما هي،
 * وعند أول وقوف للفأرة على العنصر يُنقل نصها إلى data-tip (فلا يظهر تلميح المتصفح) ويُعرض تلميحنا.
 * إن غيّر الكود title لاحقاً، يُنقل النص الجديد عند الوقوف التالي.
 * اللمس لا يتأثر (لا تلميح باللمس أصلاً).
 */

const DELAY = 500;   // مثل المتصفح تقريباً
const WARM = 400;    // الانتقال من تلميح لآخر مباشرة دون انتظار

let tip = null, cur = null, timer = 0, hiddenAt = 0;

/** ينقل title (أو <title> في SVG) إلى data-tip، ويرجع العنصر صاحب التلميح */
function adopt(start) {
  for (let el = start; el && el.nodeType === 1; el = el.parentElement) {
    if (el.classList?.contains('tip')) return null;
    const t = el.getAttribute('title');
    if (t != null) {
      el.removeAttribute('title');
      if (t) {
        el.dataset.tip = t;
        // زر أيقونة بلا نص ولا aria-label: يبقى اسمه لقارئ الشاشة
        if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
        else if (el.getAttribute('aria-label') !== t) el.setAttribute('aria-description', t); // يبقى الوصف لقارئ الشاشة
        return el;
      }
      delete el.dataset.tip; // title فارغ يلغي التلميح
      continue;
    }
    if (el instanceof SVGElement) {
      const st = Array.from(el.children).find((c) => c.tagName.toLowerCase() === 'title');
      if (st) {
        const txt = st.textContent.trim();
        st.remove();
        if (txt) { el.dataset.tip = txt; return el; }
      }
    }
    if (el.dataset?.tip) return el;
  }
  return null;
}

function hide() {
  clearTimeout(timer);
  if (tip?.isConnected) { tip.remove(); hiddenAt = Date.now(); }
  cur = null;
}

function show(el) {
  if (!el.isConnected || !el.dataset.tip) return;
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
  }
  tip.textContent = el.dataset.tip;
  tip.style.left = '0px'; tip.style.top = '0px';
  document.body.append(tip);
  const r = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let top = r.bottom + 6;
  if (top + h > vh - 6) top = r.top - h - 6;
  tip.style.top = `${Math.max(6, top)}px`;
  tip.style.left = `${Math.min(Math.max(6, r.left + r.width / 2 - w / 2), vw - w - 6)}px`;
}

function onOver(e) {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const el = adopt(e.target);
  if (el === cur) return;
  const warm = tip?.isConnected || Date.now() - hiddenAt < WARM;
  hide();
  if (!el) return;
  cur = el;
  timer = setTimeout(() => show(el), warm ? 0 : DELAY);
}

function onOut(e) {
  if (!cur) return;
  const to = e.relatedTarget;
  if (to && cur.contains(to)) return;
  hide();
}

export function watchTooltips() {
  document.addEventListener('pointerover', onOver, true);
  document.addEventListener('pointerout', onOut, true);
  document.addEventListener('pointerdown', () => { hide(); hiddenAt = 0; }, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  window.addEventListener('blur', hide);
}
