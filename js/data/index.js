/**
 * طبقة البيانات — الواجهة كلها تتعامل مع `db` فقط ولا تعرف أي قاعدة بيانات خلفه.
 *
 * لتغيير قاعدة البيانات لاحقاً (Firebase، خادم خاص، ...):
 *   1) أنشئ مجلداً جديداً في js/data/ يصدّر نفس الدوال الموصوفة في contract.js
 *   2) أضفه إلى ADAPTERS أدناه، واكتب اسمه في CONFIG.backend
 * لا يلزم تعديل أي شاشة.
 */
import { CONFIG } from '../config.js';
import * as supabase from './supabase/index.js';
import * as demo from './demo/index.js';

const ADAPTERS = { supabase, demo };

function pick() {
  if (CONFIG.backend === 'supabase' && (!CONFIG.supabase.url || !CONFIG.supabase.anonKey)) return 'demo';
  return ADAPTERS[CONFIG.backend] ? CONFIG.backend : 'demo';
}

export const backendName = pick();
export const db = ADAPTERS[backendName].createAdapter(CONFIG);
export const isDemo = backendName === 'demo';
