-- =====================================================================
--  نظام مهام الدعم الفني — 22: إسناد الموظفين إلى وحداتهم دفعة واحدة (من ملف الهيكل) — قيد التطوير
--  لسكيما التطوير وحدها (support_tasks_dev)، بعد 21_org_import.sql. يُنفَّذ في Tasks-Test ← SQL Editor،
--  ويمكن إعادة تنفيذه بلا ضرر. التراجع: 22_assign_import.undo.sql
--
--  employees_assign_bulk(items, date, transfer) ← الصفحة تقرأ الملف وتطابق الموظفين (بالرقم الوظيفي) والوحدات (بالمسار)
--    items: [{ employee_id, unit_id, is_head }]   لكل موظف: إسناد «أصيل» من date
--    - بلا إسناد أصيل قائم في date ← إسناد جديد
--    - في الوحدة نفسها ← لا تغيير (وتُضاف الرئاسة إن طُلبت)
--    - في وحدة أخرى ← نقل (transfer = true) أو يُترك (false)
--    - الرئاسة تتعارض مع رئيس قائم للوحدة ← يُسند بلا رئاسة ويُذكر التعارض
--    - خطأ في موظف لا يوقف الباقين: يُذكر مع سببه
--  ← { created, unchanged, heads, transferred, skipped, head_conflicts: [...], failed: [...] }
--  قواعد الإسناد كلها (أصيل واحد، رئيس واحد، وحدة مفعّلة، موظف نشط) تبقى مفروضة بمشغّل الإسناد نفسه
-- =====================================================================

create or replace function support_tasks_dev.employees_assign_bulk(p jsonb, p_date date default current_date, p_transfer boolean default true)
returns jsonb
language plpgsql security definer
set search_path = support_tasks_dev
as $$
declare
  r record; v_prim smallint; v_cur support_tasks_dev.employee_assignments;
  v_c int := 0; v_same int := 0; v_h int := 0; v_t int := 0; v_s int := 0;
  v_conf jsonb := '[]'; v_fail jsonb := '[]';
begin
  perform support_tasks_dev.require_admin();
  if p_date is null then perform support_tasks_dev.app_error('تاريخ بداية الإسناد مطلوب.'); end if;
  select id into v_prim from support_tasks_dev.assignment_types where is_primary;
  for r in select * from jsonb_to_recordset(p) as x(employee_id int, unit_id int, is_head boolean) loop
    begin
      select a.* into v_cur from support_tasks_dev.employee_assignments a
      where a.employee_id = r.employee_id and a.type_id = v_prim
        and a.start_date <= p_date and (a.end_date is null or a.end_date >= p_date)
      limit 1;
      if v_cur.id is null then
        begin
          insert into support_tasks_dev.employee_assignments (employee_id, unit_id, type_id, is_head, start_date)
          values (r.employee_id, r.unit_id, v_prim, coalesce(r.is_head, false), p_date);
          if r.is_head then v_h := v_h + 1; end if;
        exception when others then
          if not coalesce(r.is_head, false) then raise; end if;
          -- الرئاسة تتعارض: إسناد بلا رئاسة
          insert into support_tasks_dev.employee_assignments (employee_id, unit_id, type_id, is_head, start_date)
          values (r.employee_id, r.unit_id, v_prim, false, p_date);
          v_conf := v_conf || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
        end;
        v_c := v_c + 1;
      elsif v_cur.unit_id = r.unit_id then
        if coalesce(r.is_head, false) and not v_cur.is_head then
          begin
            update support_tasks_dev.employee_assignments set is_head = true where id = v_cur.id;
            v_h := v_h + 1;
          exception when others then
            v_conf := v_conf || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
          end;
        end if;
        v_same := v_same + 1;
      elsif p_transfer then
        begin
          perform support_tasks_dev.employee_transfer(r.employee_id, r.unit_id, p_date, coalesce(r.is_head, false));
          if r.is_head then v_h := v_h + 1; end if;
        exception when others then
          if not coalesce(r.is_head, false) then raise; end if;
          perform support_tasks_dev.employee_transfer(r.employee_id, r.unit_id, p_date, false);
          v_conf := v_conf || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
        end;
        v_t := v_t + 1;
      else
        v_s := v_s + 1;
      end if;
    exception when others then
      v_fail := v_fail || jsonb_build_object('employee_id', r.employee_id, 'unit_id', r.unit_id, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('created', v_c, 'unchanged', v_same, 'heads', v_h, 'transferred', v_t, 'skipped', v_s,
    'head_conflicts', v_conf, 'failed', v_fail);
end $$;

revoke all on function support_tasks_dev.employees_assign_bulk(jsonb, date, boolean) from public, anon;
grant execute on function support_tasks_dev.employees_assign_bulk(jsonb, date, boolean) to authenticated, service_role;

-- التحقق: يجب أن يظهر سطر واحد
select 'جاهز' as الحالة, (select count(*) from support_tasks_dev.employee_assignments) as الإسنادات;
