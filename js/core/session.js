/** الدخول والخروج وتحديث الإطار العام (الشريط العلوي) */
import { db } from '../data/index.js';
import { state, loadReference, resetState } from './store.js';
import { navigate } from './router.js';
import { CONFIG } from '../config.js';

let chrome = () => {};
export const setChrome = (fn) => { chrome = fn; };
export const refreshChrome = () => chrome();

/** الصفحة الافتراضية حسب الدور */
export const homePath = () => (state.user?.role === 'engineer' ? '/tasks' : '/dashboard');

export async function startSession(user) {
  state.user = user;
  await loadReference({ force: true });
  chrome();
}

export async function endSession({ silent = false } = {}) {
  if (!silent) { try { await db.auth.signOut(); } catch { /* */ } }
  resetState();
  chrome();
  navigate('/login', { replace: true });
}

export function setTitle(t) {
  const base = CONFIG.env === 'staging' ? `[تجربة] ${CONFIG.appName}` : CONFIG.appName;
  document.title = t ? `${t} — ${base}` : base;
}
