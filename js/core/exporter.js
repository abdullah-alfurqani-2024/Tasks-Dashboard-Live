/** تصدير المهام إلى Excel أو CSV بنفس ترتيب أعمدة ملفات Sheets السابقة */
import { writeXlsx } from '../lib/xlsx.js';
import { toCsv } from '../lib/csv.js';
import { downloadBlob } from './dom.js';
import { LABEL, PRIORITY_LABELS } from './fields.js';
import { today, fmtDate, fmtDateTime, localIsoDateTime } from './format.js';

const COLS = [
  { label: LABEL.id, type: 'number', width: 8, get: (t) => t.id },
  { label: LABEL.engineerId, width: 28, get: (t) => t.engineerName },
  { label: LABEL.refNo, width: 14, get: (t) => t.refNo },
  { label: LABEL.requester, width: 24, get: (t) => t.requester },
  { label: LABEL.employeeName, width: 24, get: (t) => t.employeeName },
  { label: LABEL.subject, width: 44, get: (t) => t.subject },
  { label: LABEL.receivedDate, type: 'date', width: 14, get: (t) => t.receivedDate },
  { label: LABEL.completedDate, type: 'date', width: 14, get: (t) => t.completedDate },
  { label: LABEL.notes, width: 30, get: (t) => t.notes },
  { label: LABEL.taskTypeId, width: 22, get: (t) => t.taskType },
  { label: LABEL.correspondenceTypeId, width: 16, get: (t) => t.correspondenceType },
  { label: LABEL.statusId, width: 14, get: (t) => t.status },
  { label: LABEL.priority, width: 10, get: (t) => PRIORITY_LABELS[t.priority] || PRIORITY_LABELS.normal },
  { label: LABEL.delayReason, width: 28, get: (t) => t.delayReason },
  { label: LABEL.durationDays, type: 'number', width: 8, get: (t) => t.durationDays },
  { label: LABEL.createdAt, type: 'datetime', width: 22, get: (t) => localIsoDateTime(t.createdAt), raw: (t) => t.createdAt },
];

export function exportTasks(tasks, { format = 'xlsx', name = 'tasks', sheet = 'المهام' } = {}) {
  const file = `${name}_${today()}`; // أسماء لاتينية: بعض المتصفحات تتجاهل الأسماء العربية في التنزيل
  if (format === 'csv') {
    // CSV نص فقط: التواريخ بنفس صيغة العرض
    const text = (c, t) => (c.type === 'date' ? fmtDate(c.get(t)) : c.type === 'datetime' ? fmtDateTime(c.raw(t)) : c.get(t) ?? '');
    downloadBlob(toCsv([COLS.map((c) => c.label), ...tasks.map((t) => COLS.map((c) => text(c, t)))]), `${file}.csv`);
    return;
  }
  const blob = writeXlsx([{ name: sheet, columns: COLS, rows: tasks.map((t) => COLS.map((c) => c.get(t))) }]);
  downloadBlob(blob, `${file}.xlsx`);
}
