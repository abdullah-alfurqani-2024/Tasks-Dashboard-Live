/**
 * طبقة البيانات — نسخة Oracle APEX
 * (تحل محل js/data/index.js في تطبيق APEX). الشاشات تتعامل مع `db` فقط كما في نسخة Supabase.
 */
import { CONFIG } from '../config.js';
import * as apex from './apex/index.js';

export const backendName = 'apex';
export const db = apex.createAdapter(CONFIG);
export const isDemo = false;
