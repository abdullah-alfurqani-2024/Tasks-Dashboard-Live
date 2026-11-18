-- =====================================================================
--  نظام مهام الدعم الفني — 20: الموظفون «تحتاج مراجعة» — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev)، بعد 19_employees.sql. يُنفَّذ في Tasks-Test ← SQL Editor،
--  ويمكن إعادة تنفيذه بلا ضرر. التراجع: 20_employees_review.undo.sql
--
--  صفوف ملف الموظفين التي فيها خطأ (رقم مدني فارغ أو غير صحيح أو مكرر، رقم وظيفي مكرر، اسم ناقص) تُستورد
--  ولا تُترك: الخانة الخاطئة تُفرَّغ، وقيمتها الأصلية وسبب الخطأ تُحفظ في review_notes، والموظف يُعلَّم needs_review.
--  يُصحَّح لاحقاً من سجل الموظف، ثم تُزال العلامة.
--    - الرقم المدني يبقى المعرّف ولا يتكرر، لكنه يجوز أن يكون فارغاً للموظف الذي يحتاج مراجعة فقط
--      (الموظف بلا رقم مدني يبقى «تحتاج مراجعة» حتى يُكتب رقمه)
--    - إعادة الاستيراد: الصف بلا رقم مدني يطابق موظفاً بلا رقم مدني بالاسم نفسه (والرقم الوظيفي إن وُجد)، فلا يتكرر
-- =====================================================================

alter table support_tasks_dev.employees alter column civil_no drop not null;
alter table support_tasks_dev.employees add column if not exists needs_review boolean not null default false;
alter table support_tasks_dev.employees add column if not exists review_notes text;
create index if not exists employees_review_idx on support_tasks_dev.employees (needs_review) where needs_review;

-- قبل الحفظ (من 19): الرقم المدني الفارغ مسموح للموظف الذي يحتاج مراجعة، ويفرضها
create or replace function support_tasks_dev.employees_before_write()
returns trigger
language plpgsql
set search_path = support_tasks_dev
as $$
declare v_other text;
begin
  new.civil_no := support_tasks_dev.clean_digits(new.civil_no);
  if new.civil_no is null then
    if not new.needs_review and (tg_op = 'INSERT' or old.civil_no is not null) then
      perform support_tasks_dev.app_error('الرقم المدني مطلوب.');
    end if;
    new.needs_review := true;
  elsif new.civil_no !~ '^[0-9]{1,20}$' then
    perform support_tasks_dev.app_error(format('الرقم المدني «%s» أرقام فقط (حتى 20 خانة).', new.civil_no));
  end if;
  new.employee_no := upper(support_tasks_dev.clean_digits(new.employee_no));
  if new.employee_no is not null and new.employee_no !~ '^[0-9A-Z/-]{1,30}$' then
    perform support_tasks_dev.app_error(format('الرقم الوظيفي «%s» غير صحيح.', new.employee_no));
  end if;
  new.name_ar := btrim(regexp_replace(coalesce(new.name_ar, ''), '\s+', ' ', 'g'));
  if new.name_ar = '' then perform support_tasks_dev.app_error('الاسم بالعربي مطلوب.'); end if;
  new.name_en := nullif(btrim(regexp_replace(coalesce(new.name_en, ''), '\s+', ' ', 'g')), '');
  new.review_notes := nullif(btrim(coalesce(new.review_notes, '')), '');
  if new.civil_no is not null then
    select name_ar into v_other from support_tasks_dev.employees where civil_no = new.civil_no and id is distinct from new.id;
    if v_other is not null then perform support_tasks_dev.app_error(format('الرقم المدني %s مسجّل للموظف «%s».', new.civil_no, v_other)); end if;
  end if;
  if new.employee_no is not null then
    select name_ar into v_other from support_tasks_dev.employees where upper(employee_no) = new.employee_no and id is distinct from new.id;
    if v_other is not null then perform support_tasks_dev.app_error(format('الرقم الوظيفي %s مسجّل للموظف «%s».', new.employee_no, v_other)); end if;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if old.is_active and not new.is_active and exists (
      select 1 from support_tasks_dev.employee_assignments a
      where a.employee_id = new.id and (a.end_date is null or a.end_date > current_date)) then
      perform support_tasks_dev.app_error('للموظف إسنادات قائمة؛ أنهِها أولاً، أو عطّله من زر «تعطيل» فتنتهي معه.');
    end if;
  end if;
  return new;
end $$;

-- الاستيراد (من 19)، مع صفوف المراجعة.
-- p: [{ civil_no, employee_no, name_ar, name_en, review }]   review: سبب المراجعة (والقيم الأصلية) أو null
-- ← { created, updated, unchanged, review, linked }
create or replace function support_tasks_dev.employees_import(p jsonb)
returns jsonb
language plpgsql
set search_path = support_tasks_dev
as $$
declare r record; v_e support_tasks_dev.employees; v_c int := 0; v_u int := 0; v_s int := 0; v_r int := 0; v_l int;
  v_civil text; v_no text; v_ar text; v_en text; v_rev text; v_notes text;
begin
  perform support_tasks_dev.require_admin();
  for r in select * from jsonb_to_recordset(p) as x(civil_no text, employee_no text, name_ar text, name_en text, review text) loop
    v_civil := support_tasks_dev.clean_digits(r.civil_no);
    v_no := upper(support_tasks_dev.clean_digits(r.employee_no));
    v_ar := nullif(btrim(regexp_replace(coalesce(r.name_ar, ''), '\s+', ' ', 'g')), '');
    v_en := nullif(btrim(regexp_replace(coalesce(r.name_en, ''), '\s+', ' ', 'g')), '');
    v_rev := nullif(btrim(coalesce(r.review, '')), '');
    v_e := null;
    if v_civil is not null then
      select * into v_e from support_tasks_dev.employees where civil_no = v_civil;
    elsif v_ar is not null then
      select * into v_e from support_tasks_dev.employees
      where civil_no is null and name_ar = v_ar and (v_no is null or upper(employee_no) = v_no)
      order by id limit 1;
    end if;
    if v_e.id is null then
      insert into support_tasks_dev.employees (civil_no, employee_no, name_ar, name_en, needs_review, review_notes)
      values (v_civil, v_no, coalesce(v_ar, v_en, 'بلا اسم'), v_en, v_rev is not null or v_civil is null, v_rev);
      v_c := v_c + 1;
      if v_rev is not null or v_civil is null then v_r := v_r + 1; end if;
    else
      -- سبب المراجعة يُضاف إلى الملاحظات إن لم يكن فيها
      v_notes := case when v_rev is null then v_e.review_notes
                      when v_e.review_notes is null then v_rev
                      when position(v_rev in v_e.review_notes) > 0 then v_e.review_notes
                      else v_e.review_notes || E'\n' || v_rev end;
      if (v_no is not null and v_no is distinct from v_e.employee_no) or (v_ar is not null and v_ar <> v_e.name_ar)
         or (v_en is not null and v_en is distinct from v_e.name_en) or v_notes is distinct from v_e.review_notes then
        update support_tasks_dev.employees set employee_no = coalesce(v_no, employee_no), name_ar = coalesce(v_ar, name_ar),
          name_en = coalesce(v_en, name_en), review_notes = v_notes, needs_review = needs_review or v_rev is not null
        where id = v_e.id;
        v_u := v_u + 1;
        if v_rev is not null then v_r := v_r + 1; end if;
      else
        v_s := v_s + 1;
      end if;
    end if;
  end loop;
  v_l := support_tasks_dev.link_users_to_employees();
  return jsonb_build_object('created', v_c, 'updated', v_u, 'unchanged', v_s, 'review', v_r, 'linked', v_l);
end $$;

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة,
       (select count(*) from support_tasks_dev.employees) as الموظفون,
       (select count(*) from support_tasks_dev.employees where needs_review) as تحتاج_مراجعة;
