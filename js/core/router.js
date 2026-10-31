/**
 * موجّه بسيط بالـ hash (#/tasks) — يعمل على GitHub Pages بدون أي إعداد للخادم
 */
const routes = [];
let notFound = null;
let current = null;
let guard = null;

/** pattern مثل '/tasks/:id' */
export function route(pattern, handler, meta = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ pattern, re, keys, handler, meta });
}

export const fallback = (h) => { notFound = h; };
export const setGuard = (fn) => { guard = fn; };

export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) return resolve();
  if (replace) { history.replaceState(null, '', target); resolve(); } else location.hash = target;
}

export async function resolve() {
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (guard) {
      const redirect = guard(r, path);
      if (redirect && redirect !== path) return navigate(redirect, { replace: true });
    }
    if (current?.cleanup) { try { current.cleanup(); } catch { /* تجاهل */ } }
    current = { path, cleanup: null };
    const ctx = { params, query, path, meta: r.meta, onLeave: (fn) => { current.cleanup = fn; } };
    await r.handler(ctx);
    return;
  }
  if (notFound) notFound({ path });
}

export function start() {
  window.addEventListener('hashchange', resolve);
  return resolve();
}

export const currentPath = () => parseHash().path;
