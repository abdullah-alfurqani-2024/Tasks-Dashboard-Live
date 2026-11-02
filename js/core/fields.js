/**
 * أسماء حقول المهمة بالعربي (نفس عناوين أعمدة ملفات Google Sheets السابقة)
 * تُستخدم في النموذج والتقرير والتصدير والاستيراد وسجل التعديلات.
 */
export const FIELDS = [
  { key: 'engineerId',           col: 'engineer_id',            label: 'اسم المهندس' },
  { key: 'refNo',                col: 'ref_no',                 label: 'رقم القيد' },
  { key: 'requester',            col: 'requester',              label: 'الجهة الطالبة' },
  { key: 'employeeName',         col: 'employee_name',          label: 'اسم الموظف' },
  { key: 'subject',              col: 'subject',                label: 'الموضوع' },
  { key: 'receivedDate',         col: 'received_date',          label: 'تاريخ الاستقبال' },
  { key: 'completedDate',        col: 'completed_date',         label: 'تاريخ الانتهاء' },
  { key: 'notes',                col: 'notes',                  label: 'الملاحظات' },
  { key: 'taskTypeId',           col: 'task_type_id',           label: 'نوع المهمة' },
  { key: 'correspondenceTypeId', col: 'correspondence_type_id', label: 'نوع المراسلة' },
  { key: 'statusId',             col: 'status_id',              label: 'الحالة' },
  { key: 'delayReason',          col: 'delay_reason',           label: 'سبب تأخير إنجاز المهمة' },
  { key: 'deletedAt',            col: 'deleted_at',             label: 'الحذف' },
  { key: 'reviewReasons',        col: 'review_reasons',         label: 'تحتاج مراجعة' },
];

export const LABEL_BY_COL = Object.fromEntries(FIELDS.map((f) => [f.col, f.label]));
export const LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
LABEL.durationDays = 'المدة';
LABEL.id = 'الرقم';
LABEL.createdAt = 'تاريخ الإدخال';
