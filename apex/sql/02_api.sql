-- =====================================================================
--  نظام مهام الدعم الفني — نسخة Oracle APEX
--  02: حزمة ST_API (كل منطق الخادم والصلاحيات) والمشغّلات
--
--  يُنفَّذ بعد 01_schema.sql
--  مقابل: supabase/sql/02_functions.sql + 03_security.sql (RLS) + دوال admin-users و auth-login
--
--  الواجهة تتصل بالخادم عبر عملية APEX واحدة (Application Process: API) تستدعي st_api.ajax،
--  وكل طلب يمر بـ st_api.dispatch الذي يحدد المستخدم الحالي من جلسة APEX ثم يفحص صلاحيته.
--  لا يوجد أي طريق آخر للوصول إلى الجداول من المتصفح، ففحوصات الواجهة للراحة فقط.
-- =====================================================================

create or replace package st_api as

  -- المستخدم الحالي (يُضبط في كل طلب): المشغّلات تقرؤه
  g_uid       varchar2(36);   -- المستخدم الفعّال (أو المستخدم الذي يتصفح المدير بحسابه)
  g_role      varchar2(10);
  g_real_uid  varchar2(36);   -- صاحب الجلسة الحقيقي
  g_acting    boolean := false;
  g_migrating boolean := false; -- النقل من Supabase: المشغّلات لا تغيّر القيم المنقولة

  -- نقطة الدخول من APEX (Application Process: API)
  procedure ajax;
  function  dispatch(p_action in varchar2, p_payload in clob) return clob;

  -- الدخول (Custom Authentication)
  function  authenticate(p_username in varchar2, p_password in varchar2) return boolean;
  procedure post_auth;
  procedure login_check;      -- صفحة الدخول: فحص الرقم وكلمة المرور برسالة عربية قبل الإرسال
  function  hash_password(p_password in varchar2, p_salt in varchar2) return varchar2;
  procedure set_password(p_id in varchar2, p_password in varchar2, p_must_change in number default null);

  -- أدوات مشتركة (تستخدمها المشغّلات والاستعلامات)
  procedure app_error(p_message in varchar2);
  function  today return date;
  function  setting_int(p_key in varchar2, p_default in number) return number;
  function  ts_iso(p_ts in timestamp with time zone) return varchar2;
  function  clob_eq(a in clob, b in clob) return boolean;
  function  new_id return varchar2;

  procedure jp_s(o in out nocopy json_object_t, k in varchar2, v in varchar2);
  procedure jp_c(o in out nocopy json_object_t, k in varchar2, v in clob);
  procedure jp_n(o in out nocopy json_object_t, k in varchar2, v in number);
  procedure jp_d(o in out nocopy json_object_t, k in varchar2, v in date);
  procedure jp_t(o in out nocopy json_object_t, k in varchar2, v in timestamp with time zone);
  procedure jp_j(o in out nocopy json_object_t, k in varchar2, v in clob);

end st_api;
/

create or replace package body st_api as

  c_pw_floor    constant number := 6;
  c_invalid     constant varchar2(200) := 'الرقم أو كلمة المرور غير صحيحة.';
  e_expired     exception;  pragma exception_init(e_expired, -20010);
  e_acting_exp  exception;  pragma exception_init(e_acting_exp, -20011);

  g_acting_until timestamp with time zone;

  -- ───────────────────────── أدوات عامة ─────────────────────────

  procedure app_error(p_message in varchar2) is
  begin
    raise_application_error(-20001, p_message);
  end;

  function today return date is
  begin
    return trunc(cast(systimestamp at time zone 'Asia/Muscat' as date));
  end;

  function latin(s in varchar2) return varchar2 is
  begin
    return translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  end;

  function ts_iso(p_ts in timestamp with time zone) return varchar2 is
  begin
    if p_ts is null then return null; end if;
    return to_char(sys_extract_utc(p_ts), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"');
  end;

  function parse_ts(s in varchar2) return timestamp with time zone is
  begin
    if s is null then return null; end if;
    return to_timestamp_tz(replace(substr(s, 1, 23) || '+00:00', 'Z', ''), 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM');
  end;

  function parse_date(s in varchar2) return date is
  begin
    if s is null then return null; end if;
    return to_date(substr(s, 1, 10), 'YYYY-MM-DD');
  end;

  function clob_eq(a in clob, b in clob) return boolean is
  begin
    if a is null and b is null then return true; end if;
    if a is null or b is null then return false; end if;
    return dbms_lob.compare(a, b) = 0;
  end;

  function new_id return varchar2 is
    h varchar2(32) := lower(rawtohex(sys_guid()));
  begin
    return substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) || '-' || substr(h, 17, 4) || '-' || substr(h, 21, 12);
  end;

  function setting_raw(p_key in varchar2) return varchar2 is
    v clob;
  begin
    select setting_value into v from st_app_settings where setting_key = p_key;
    return trim(both '"' from trim(dbms_lob.substr(v, 4000, 1)));
  exception when no_data_found then return null;
  end;

  function setting_int(p_key in varchar2, p_default in number) return number is
  begin
    return coalesce(to_number(setting_raw(p_key) default null on conversion error), p_default);
  end;

  function setting_bool(p_key in varchar2, p_default in boolean) return boolean is
    v varchar2(4000) := setting_raw(p_key);
  begin
    if v is null then return p_default; end if;
    return v = 'true';
  end;

  function min_pw return number is
  begin
    return least(72, greatest(c_pw_floor, setting_int('min_password_length', c_pw_floor)));
  end;

  -- JSON: قراءة قيم الطلب
  function jhas(o in json_object_t, k in varchar2) return boolean is
  begin
    return o is not null and o.has(k);
  end;

  function jstr(o in json_object_t, k in varchar2) return varchar2 is
    e json_element_t;
  begin
    if o is null or not o.has(k) then return null; end if;
    e := o.get(k);
    if e is null or e.is_null then return null; end if;
    if e.is_string then return o.get_string(k); end if;
    if e.is_number then return to_char(o.get_number(k), 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,'''); end if;
    if e.is_boolean then return case when o.get_boolean(k) then 'true' else 'false' end; end if;
    return e.to_string;
  end;

  function jclob(o in json_object_t, k in varchar2) return clob is
    e json_element_t;
  begin
    if o is null or not o.has(k) then return null; end if;
    e := o.get(k);
    if e is null or e.is_null then return null; end if;
    if e.is_string then return o.get_clob(k); end if;
    return e.to_clob;
  end;

  function jnum(o in json_object_t, k in varchar2) return number is
  begin
    return to_number(jstr(o, k) default null on conversion error);
  end;

  function jbool(o in json_object_t, k in varchar2, p_default in boolean default false) return boolean is
    v varchar2(4000) := lower(jstr(o, k));
  begin
    if v is null then return p_default; end if;
    return v in ('true', '1', 'y', 'yes');
  end;

  -- JSON: كتابة القيم (تُستخدم في المشغّلات وفي الردود)
  procedure jp_s(o in out nocopy json_object_t, k in varchar2, v in varchar2) is
  begin if v is null then o.put_null(k); else o.put(k, v); end if; end;

  procedure jp_c(o in out nocopy json_object_t, k in varchar2, v in clob) is
  begin if v is null or dbms_lob.getlength(v) = 0 then o.put_null(k); else o.put(k, v); end if; end;

  procedure jp_n(o in out nocopy json_object_t, k in varchar2, v in number) is
  begin if v is null then o.put_null(k); else o.put(k, v); end if; end;

  procedure jp_d(o in out nocopy json_object_t, k in varchar2, v in date) is
  begin if v is null then o.put_null(k); else o.put(k, to_char(v, 'YYYY-MM-DD')); end if; end;

  procedure jp_t(o in out nocopy json_object_t, k in varchar2, v in timestamp with time zone) is
  begin if v is null then o.put_null(k); else o.put(k, ts_iso(v)); end if; end;

  procedure jp_j(o in out nocopy json_object_t, k in varchar2, v in clob) is
  begin if v is null or dbms_lob.getlength(v) = 0 then o.put_null(k); else o.put(k, json_element_t.parse(v)); end if; end;

  procedure out_clob(p in clob) is
    l_len number := nvl(dbms_lob.getlength(p), 0);
    l_pos number := 1;
  begin
    owa_util.mime_header('application/json', false, 'utf-8');
    owa_util.http_header_close;
    while l_pos <= l_len loop
      htp.prn(dbms_lob.substr(p, 8000, l_pos));
      l_pos := l_pos + 8000;
    end loop;
  end;

  -- ───────────────────────── المستخدم الحالي ─────────────────────────

  procedure require(p_roles in varchar2, p_message in varchar2) is
  begin
    if g_role is null or instr(',' || p_roles || ',', ',' || g_role || ',') = 0 then
      app_error(p_message);
    end if;
  end;

  function view_all return boolean is
  begin
    return g_role in ('admin', 'head', 'viewer');
  end;

  procedure resolve_user is
    l_user varchar2(255) := lower(v('APP_USER'));
    l_sess number := to_number(v('APP_SESSION') default null on conversion error);
    l_real_role varchar2(10);
    l_act  st_acting%rowtype;
  begin
    g_uid := null; g_role := null; g_real_uid := null; g_acting := false; g_acting_until := null;
    begin
      select id, role into g_real_uid, l_real_role from st_profiles where id = l_user and is_active = 1;
    exception when no_data_found then
      raise_application_error(-20010, 'انتهت الجلسة، سجّل الدخول من جديد.');
    end;
    g_uid := g_real_uid; g_role := l_real_role;

    -- التصفح بحساب مستخدم آخر (مدير النظام فقط، ساعة واحدة)
    begin
      select * into l_act from st_acting where apex_session = l_sess;
    exception when no_data_found then return;
    end;
    if l_act.real_uid <> g_real_uid or l_real_role <> 'admin' then
      delete from st_acting where apex_session = l_sess;
      return;
    end if;
    if l_act.expires_at <= systimestamp then
      delete from st_acting where apex_session = l_sess;
      commit;
      raise_application_error(-20011, 'انتهت مدة الدخول بحساب المستخدم، وعدت إلى حسابك.');
    end if;
    begin
      select id, role into g_uid, g_role from st_profiles where id = l_act.acting_uid and is_active = 1;
      g_acting := true; g_acting_until := l_act.expires_at;
    exception when no_data_found then
      delete from st_acting where apex_session = l_sess;
      commit;
      raise_application_error(-20011, 'هذا الحساب معطّل أو غير موجود.');
    end;
  end;

  -- ───────────────────────── كلمات المرور والدخول ─────────────────────────

  function hash_password(p_password in varchar2, p_salt in varchar2) return varchar2 is
    h varchar2(4000) := p_salt || ':' || p_password;
  begin
    -- SHA-256 مكرر 500 مرة مع salt خاص بكل مستخدم (STANDARD_HASH متاح لكل Schema بلا صلاحيات إضافية)
    for i in 1 .. 500 loop
      select rawtohex(standard_hash(h || p_salt, 'SHA256')) into h from dual;
    end loop;
    return h;
  end;

  procedure set_password(p_id in varchar2, p_password in varchar2, p_must_change in number default null) is
    l_salt varchar2(32) := lower(rawtohex(sys_guid()));
  begin
    update st_profiles
       set password_salt = l_salt,
           password_hash = hash_password(p_password, l_salt),
           must_change_password = coalesce(p_must_change, must_change_password),
           updated_at = systimestamp
     where id = p_id;
  end;

  procedure record_failure(p_key in varchar2) is
    pragma autonomous_transaction;
  begin
    insert into st_login_failures (login_key) values (p_key);
    delete from st_login_failures where failed_at < systimestamp - interval '1' day;
    commit;
  end;

  procedure fail_login(p_key in varchar2, p_message in varchar2) is
  begin
    record_failure(p_key);
    begin dbms_session.sleep(0.4); exception when others then null; end;  -- إبطاء التخمين
    app_error(p_message);
  end;

  -- يعيد معرّف المستخدم أو يرمي خطأً برسالة عربية
  function verify_login(p_login in varchar2, p_password in varchar2) return varchar2 is
    l_login varchar2(400) := lower(trim(latin(p_login)));
    l_n     number;
    p       st_profiles%rowtype;
  begin
    if l_login is null or p_password is null then app_error('اكتب الرقم وكلمة المرور.'); end if;
    select count(*) into l_n from st_login_failures
     where login_key = l_login and failed_at > systimestamp - interval '15' minute;
    if l_n >= 8 then app_error('محاولات خاطئة كثيرة. انتظر 15 دقيقة ثم أعد المحاولة.'); end if;
    begin
      if instr(l_login, '@') > 0 then
        select * into p from st_profiles where lower(email) = l_login;
      elsif regexp_like(l_login, '^[0-9]{1,20}$') then
        select * into p from st_profiles where login_no = l_login;
      else
        raise no_data_found;
      end if;
    exception when no_data_found then
      fail_login(l_login, c_invalid);
    end;
    if p.password_hash is null or hash_password(p_password, p.password_salt) <> p.password_hash then
      fail_login(l_login, c_invalid);
    end if;
    if p.is_active = 0 then fail_login(l_login, 'هذا الحساب معطّل. تواصل مع مدير النظام.'); end if;
    delete from st_login_failures where login_key = l_login;
    return p.id;
  end;

  function authenticate(p_username in varchar2, p_password in varchar2) return boolean is
    l_id varchar2(36);
  begin
    l_id := verify_login(p_username, p_password);
    return true;
  exception when others then
    return false;
  end;

  procedure post_auth is
    l_login varchar2(400) := lower(trim(latin(v('APP_USER'))));
    l_id    varchar2(36);
  begin
    if instr(l_login, '@') > 0 then
      select id into l_id from st_profiles where lower(email) = l_login;
    else
      select id into l_id from st_profiles where login_no = l_login;
    end if;
    -- اسم مستخدم الجلسة = معرّف الملف الشخصي (ثابت حتى لو تغيّر الرقم أو البريد)
    apex_custom_auth.set_user(l_id);
  end;

  procedure login_check is
    l_id varchar2(36);
    o    json_object_t := json_object_t();
  begin
    l_id := verify_login(apex_application.g_x01, apex_application.g_x02);
    o.put('ok', true);
    commit;
    out_clob(o.to_clob);
  exception when others then
    rollback;
    o.put('ok', false);
    o.put('error', case when sqlcode between -20999 and -20000 then substr(sqlerrm, 12) else 'خطأ في الخادم. حاول لاحقاً.' end);
    out_clob(o.to_clob);
  end;

  -- ───────────────────────── المستخدمون ─────────────────────────

  function user_json(p_id in varchar2) return clob is
    r clob;
  begin
    select json_object(
             'id' value id, 'login_no' value login_no, 'email' value email,
             'full_name' value full_name, 'short_name' value short_name, 'role' value role,
             'is_active' value is_active, 'must_change_password' value must_change_password
             returning clob)
      into r from st_profiles where id = p_id;
    return r;
  exception when no_data_found then
    app_error('المستخدم غير موجود.');
  end;

  function me_json return clob is
    o json_object_t := json_object_t(user_json(g_uid));
  begin
    if g_acting then
      o.put('acting', true);
      o.put('acting_expires_at', ts_iso(g_acting_until));
      o.put('must_change_password', 0);   -- كلمة مروره له، لا لمن يتصفح
    end if;
    o.put('real_id', g_real_uid);
    o.put('schema', sys_context('userenv', 'current_schema'));
    return o.to_clob;
  end;

  function users_list return clob is
    r clob;
  begin
    select json_arrayagg(json_object(
             'id' value id, 'login_no' value login_no, 'email' value email,
             'full_name' value full_name, 'short_name' value short_name, 'role' value role,
             'is_active' value is_active, 'must_change_password' value must_change_password
             returning clob) order by full_name returning clob)
      into r
      from st_profiles
     where id = g_uid or g_role in ('admin', 'head', 'viewer');
    return nvl(r, to_clob('[]'));
  end;

  function clean_no(p in varchar2) return varchar2 is
    l varchar2(400) := regexp_replace(latin(p), '[[:space:]]', '');
  begin
    if l is null then return null; end if;
    if not regexp_like(l, '^[0-9]{1,20}$') then app_error('الرقم يجب أن يكون أرقاماً فقط (حتى 20 خانة).'); end if;
    return l;
  end;

  procedure check_email(p in varchar2) is
  begin
    if p is not null and not regexp_like(p, '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      app_error('صيغة البريد غير صحيحة.');
    end if;
  end;

  procedure check_role(p in varchar2) is
  begin
    if p is null or p not in ('admin', 'head', 'engineer', 'viewer') then app_error('دور غير معروف.'); end if;
  end;

  procedure check_password(p in varchar2) is
  begin
    if p is null or length(p) < min_pw then
      app_error('كلمة المرور يجب أن تكون ' || min_pw || ' أحرف على الأقل.');
    end if;
  end;

  procedure ensure_unique(p_login_no in varchar2, p_email in varchar2, p_except in varchar2) is
    n number;
  begin
    if p_login_no is not null then
      select count(*) into n from st_profiles where login_no = p_login_no and id <> nvl(p_except, '-');
      if n > 0 then app_error('هذا الرقم مسجّل لمستخدم آخر.'); end if;
    end if;
    if p_email is not null then
      select count(*) into n from st_profiles where lower(email) = lower(p_email) and id <> nvl(p_except, '-');
      if n > 0 then app_error('هذا البريد مسجّل مسبقاً.'); end if;
    end if;
  end;

  function user_create(o in json_object_t) return clob is
    l_no    varchar2(20)  := clean_no(jstr(o, 'login_no'));
    l_email varchar2(320) := lower(trim(jstr(o, 'email')));
    l_name  varchar2(200) := trim(jstr(o, 'full_name'));
    l_short varchar2(60)  := trim(jstr(o, 'short_name'));
    l_role  varchar2(10)  := nvl(jstr(o, 'role'), 'engineer');
    l_pw    varchar2(4000):= jstr(o, 'password');
    l_id    varchar2(36)  := new_id;
  begin
    require('admin', 'هذه العملية لمدير النظام فقط.');
    if l_no is null then app_error('الرقم المدني أو الوظيفي مطلوب.'); end if;
    check_email(l_email);
    ensure_unique(l_no, l_email, null);
    if l_name is null then app_error('الاسم الكامل مطلوب.'); end if;
    check_role(l_role);
    if l_pw is null then l_pw := l_no; end if;   -- كلمة المرور الافتراضية = الرقم
    check_password(l_pw);
    insert into st_profiles (id, login_no, email, full_name, short_name, role, must_change_password)
    values (l_id, l_no, l_email, l_name, l_short, l_role,
            case when setting_bool('force_password_change', false) then 1 else 0 end);
    set_password(l_id, l_pw);
    return user_json(l_id);
  end;

  function user_update(o in json_object_t) return clob is
    l_id  varchar2(36) := jstr(o, 'id');
    cur   st_profiles%rowtype;
    l_no  varchar2(20);
    l_email varchar2(320);
    l_name varchar2(200);
    l_role varchar2(10);
    l_active number(1);
  begin
    require('admin', 'هذه العملية لمدير النظام فقط.');
    if l_id is null then app_error('المستخدم غير محدد.'); end if;
    begin
      select * into cur from st_profiles where id = l_id for update;
    exception when no_data_found then app_error('المستخدم غير موجود.');
    end;
    l_name   := case when jhas(o, 'full_name') then trim(jstr(o, 'full_name')) else cur.full_name end;
    if l_name is null then app_error('الاسم الكامل مطلوب.'); end if;
    l_role   := case when jhas(o, 'role') then jstr(o, 'role') else cur.role end;
    check_role(l_role);
    l_active := case when jhas(o, 'is_active') then case when jbool(o, 'is_active') then 1 else 0 end else cur.is_active end;
    l_no     := case when jhas(o, 'login_no') then clean_no(jstr(o, 'login_no')) else cur.login_no end;
    l_email  := case when jhas(o, 'email') then lower(trim(jstr(o, 'email'))) else cur.email end;
    check_email(l_email);
    if l_id = g_real_uid and (l_role <> 'admin' or l_active = 0) then
      app_error('لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.');
    end if;
    -- الرقم إلزامي: لا يُحفظ أي تعديل لمستخدم يبقى بلا رقم
    if l_no is null then app_error('الرقم المدني أو الوظيفي مطلوب. أضف رقم هذا المستخدم أولاً.'); end if;
    ensure_unique(l_no, l_email, l_id);
    update st_profiles
       set full_name = l_name,
           short_name = case when jhas(o, 'short_name') then trim(jstr(o, 'short_name')) else short_name end,
           role = l_role, is_active = l_active, login_no = l_no, email = l_email, updated_at = systimestamp
     where id = l_id;
    -- الحساب المعطّل لا يستطيع الدخول، ولا يبقى أحد يتصفح بحسابه
    if l_active = 0 then delete from st_acting where acting_uid = l_id; end if;
    return user_json(l_id);
  end;

  function user_reset_password(o in json_object_t) return clob is
    l_id varchar2(36) := jstr(o, 'id');
    l_pw varchar2(4000) := jstr(o, 'password');
    n number;
  begin
    require('admin', 'هذه العملية لمدير النظام فقط.');
    if l_id is null then app_error('المستخدم غير محدد.'); end if;
    select count(*) into n from st_profiles where id = l_id;
    if n = 0 then app_error('المستخدم غير موجود.'); end if;
    check_password(l_pw);
    set_password(l_id, l_pw, case when setting_bool('force_password_change', false) then 1 else 0 end);
    return '{"ok":true,"sync":false}';
  end;

  function users_reset_all(o in json_object_t) return clob is
    l_mode  varchar2(20) := case when jstr(o, 'mode') = 'login_no' then 'login_no' else 'same' end;
    l_force number := case when jbool(o, 'force', true) then 1 else 0 end;
    l_inact boolean := jbool(o, 'include_inactive', false);
    l_pw    varchar2(4000) := jstr(o, 'password');
    l_done  number := 0;
    l_skip  json_array_t := json_array_t();
    l_sync  varchar2(4000) := setting_raw('sync_user_id');
    r       json_object_t := json_object_t();
    procedure skip(p_name varchar2, p_reason varchar2) is
      s json_object_t := json_object_t();
    begin
      s.put('name', p_name); s.put('reason', p_reason); l_skip.append(s);
    end;
  begin
    require('admin', 'هذه العملية لمدير النظام فقط.');
    if l_mode = 'same' then check_password(l_pw); end if;
    for u in (select id, full_name, login_no, is_active from st_profiles where id <> g_real_uid order by full_name) loop
      if l_sync is not null and u.id = l_sync then skip(u.full_name, 'حساب مزامنة التجربة (يُستثنى دائماً)');
      elsif u.is_active = 0 and not l_inact then skip(u.full_name, 'حساب معطّل');
      elsif l_mode = 'login_no' and u.login_no is null then skip(u.full_name, 'ليس له رقم');
      elsif l_mode = 'login_no' and length(u.login_no) < min_pw then skip(u.full_name, 'رقمه أقصر من ' || min_pw || ' خانات');
      else
        set_password(u.id, case when l_mode = 'same' then l_pw else u.login_no end, l_force);
        l_done := l_done + 1;
      end if;
    end loop;
    r.put('reset', l_done);
    r.put('skipped', l_skip);
    return r.to_clob;
  end;

  function change_password(o in json_object_t) return clob is
    l_pw varchar2(4000) := jstr(o, 'password');
  begin
    if g_acting then app_error('لا يمكن تغيير كلمة المرور أثناء التصفح بحساب مستخدم آخر.'); end if;
    check_password(l_pw);
    set_password(g_real_uid, l_pw, 0);
    return '{"ok":true}';
  end;

  -- الدخول بحساب مستخدم آخر (مدير النظام): لا يعرف كلمة مروره ولا يغيّرها، وينتهي بعد ساعة
  function act_as(o in json_object_t) return clob is
    l_id varchar2(36) := jstr(o, 'id');
    l_sess number := to_number(v('APP_SESSION'));
    p st_profiles%rowtype;
  begin
    if g_acting then app_error('عد إلى حسابك أولاً.'); end if;
    require('admin', 'هذه العملية لمدير النظام فقط.');
    if l_id is null then app_error('المستخدم غير محدد.'); end if;
    if l_id = g_real_uid then app_error('هذا حسابك أنت.'); end if;
    begin
      select * into p from st_profiles where id = l_id;
    exception when no_data_found then app_error('المستخدم غير موجود.');
    end;
    if p.is_active = 0 then app_error('الحساب معطّل. فعّله أولاً.'); end if;
    delete from st_acting where apex_session = l_sess;
    insert into st_acting (apex_session, real_uid, acting_uid, expires_at)
    values (l_sess, g_real_uid, l_id, systimestamp + interval '1' hour);
    g_uid := p.id; g_role := p.role; g_acting := true; g_acting_until := systimestamp + interval '1' hour;
    return me_json;
  end;

  function stop_acting return clob is
  begin
    delete from st_acting where apex_session = to_number(v('APP_SESSION'));
    g_uid := g_real_uid; g_acting := false;
    select role into g_role from st_profiles where id = g_real_uid;
    return me_json;
  end;

  -- ───────────────────────── المهام ─────────────────────────

  function tasks_query(p_id in number, o in json_object_t) return clob is
    r       clob;
    l_role  varchar2(10) := g_role;
    l_uid   varchar2(36) := g_uid;
    l_eng   varchar2(36) := jstr(o, 'engineerId');
    l_stat  number := jnum(o, 'statusId');
    l_type  number := jnum(o, 'taskTypeId');
    l_corr  number := jnum(o, 'correspondenceTypeId');
    l_from  date := parse_date(jstr(o, 'from'));
    l_to    date := parse_date(jstr(o, 'to'));
    l_del   varchar2(10) := nvl(jstr(o, 'deleted'), 'exclude');
    l_rev   number := case when jbool(o, 'review', false) then 1 else 0 end;
  begin
    if p_id is not null then l_del := 'include'; end if;
    select json_arrayagg(json_object(
             'id' value t.id, 'engineer_id' value t.engineer_id,
             'engineer_name' value t.engineer_name, 'engineer_short' value t.engineer_short,
             'ref_no' value t.ref_no, 'requester' value t.requester, 'employee_name' value t.employee_name,
             'subject' value t.subject,
             'received_date' value to_char(t.received_date, 'YYYY-MM-DD'),
             'completed_date' value to_char(t.completed_date, 'YYYY-MM-DD'),
             'notes' value t.notes,
             'task_type_id' value t.task_type_id, 'task_type' value t.task_type,
             'correspondence_type_id' value t.correspondence_type_id, 'correspondence_type' value t.correspondence_type,
             'status_id' value t.status_id, 'status' value t.status, 'status_kind' value t.status_kind,
             'delay_reason' value t.delay_reason, 'duration_days' value t.duration_days,
             'created_at' value st_api.ts_iso(t.created_at), 'created_by' value t.created_by,
             'updated_at' value st_api.ts_iso(t.updated_at), 'updated_by' value t.updated_by,
             'deleted_at' value st_api.ts_iso(t.deleted_at), 'deleted_by' value t.deleted_by,
             'review_reasons' value t.review_reasons format json,
             'priority' value t.priority
             returning clob)
           order by t.received_date desc nulls first, t.id desc returning clob)
      into r
      from st_v_tasks t
     where ((t.deleted_at is null and (t.engineer_id = l_uid or l_role in ('admin', 'head', 'viewer'))) or l_role = 'admin')
       and (p_id is null or t.id = p_id)
       and (l_eng is null or t.engineer_id = l_eng)
       and (l_stat is null or t.status_id = l_stat)
       and (l_type is null or t.task_type_id = l_type)
       and (l_corr is null or t.correspondence_type_id = l_corr)
       and (l_from is null or t.received_date >= l_from)
       and (l_to is null or t.received_date <= l_to)
       and (l_del = 'include' or (l_del = 'only' and t.deleted_at is not null) or (l_del = 'exclude' and t.deleted_at is null))
       and (l_rev = 0 or t.review_reasons is not null);
    return nvl(r, to_clob('[]'));
  end;

  function task_get(p_id in number) return clob is
    a json_array_t := json_array_t.parse(tasks_query(p_id, json_object_t()));
  begin
    if a.get_size = 0 then app_error('المهمة غير موجودة.'); end if;
    return a.get(0).to_clob;
  end;

  function review_reasons_of(t in json_object_t) return clob is
    e json_element_t;
  begin
    if not t.has('review_reasons') then return null; end if;
    e := t.get('review_reasons');
    if e is null or e.is_null then return null; end if;
    return e.to_clob;
  end;

  function task_insert(t in json_object_t) return number is
    l_id number;
  begin
    insert into st_tasks (engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date,
                          notes, task_type_id, correspondence_type_id, status_id, delay_reason,
                          created_by, priority, review_reasons)
    values (jstr(t, 'engineer_id'), jstr(t, 'ref_no'), jstr(t, 'requester'), jstr(t, 'employee_name'),
            jclob(t, 'subject'), parse_date(jstr(t, 'received_date')), parse_date(jstr(t, 'completed_date')),
            jclob(t, 'notes'), jnum(t, 'task_type_id'), jnum(t, 'correspondence_type_id'), jnum(t, 'status_id'),
            jclob(t, 'delay_reason'), jstr(t, 'created_by'),
            case when jstr(t, 'priority') = 'urgent' then 'urgent' else 'normal' end,
            review_reasons_of(t))
    returning id into l_id;
    return l_id;
  end;

  function task_create(o in json_object_t) return clob is
    l_id number;
  begin
    require('admin,head,engineer', 'المشاهد لا يستطيع إضافة مهام.');
    l_id := task_insert(o.get_object('task'));
    return task_get(l_id);
  end;

  function task_update(o in json_object_t) return clob is
    l_id   number := jnum(o, 'id');
    t      json_object_t := o.get_object('task');
    l_eng  varchar2(36);
    l_del  timestamp with time zone;
    l_ok   boolean;
  begin
    begin
      select engineer_id, deleted_at into l_eng, l_del from st_tasks where id = l_id for update;
    exception when no_data_found then
      app_error('لا تملك صلاحية تعديل هذه المهمة، أو أنها حُذفت.');
    end;
    l_ok := g_role = 'admin'
         or (l_del is null and g_role = 'head')
         or (l_del is null and g_role = 'engineer' and l_eng = g_uid);
    if not l_ok then app_error('لا تملك صلاحية تعديل هذه المهمة، أو أنها حُذفت.'); end if;

    update st_tasks set
      engineer_id            = case when jhas(t, 'engineer_id') and jstr(t, 'engineer_id') is not null then jstr(t, 'engineer_id') else engineer_id end,
      ref_no                 = jstr(t, 'ref_no'),
      requester              = jstr(t, 'requester'),
      employee_name          = jstr(t, 'employee_name'),
      subject                = jclob(t, 'subject'),
      received_date          = parse_date(jstr(t, 'received_date')),
      completed_date         = parse_date(jstr(t, 'completed_date')),
      notes                  = jclob(t, 'notes'),
      task_type_id           = jnum(t, 'task_type_id'),
      correspondence_type_id = jnum(t, 'correspondence_type_id'),
      status_id              = jnum(t, 'status_id'),
      delay_reason           = jclob(t, 'delay_reason'),
      priority               = case when jhas(t, 'priority') then case when jstr(t, 'priority') = 'urgent' then 'urgent' else 'normal' end else priority end,
      review_reasons         = case when jhas(t, 'review_reasons') then review_reasons_of(t) else review_reasons end
    where id = l_id;
    return task_get(l_id);
  end;

  function tasks_bulk_create(o in json_object_t) return clob is
    a json_array_t := o.get_array('list');
    l_id number;
    n number := 0;
  begin
    require('admin,head,engineer', 'المشاهد لا يستطيع إضافة مهام.');
    for i in 0 .. a.get_size - 1 loop
      l_id := task_insert(treat(a.get(i) as json_object_t));
      n := n + 1;
    end loop;
    return '{"count":' || n || '}';
  end;

  function task_set_deleted(o in json_object_t, p_delete in boolean) return clob is
    l_id number := jnum(o, 'id');
  begin
    if g_role is null or g_role <> 'admin' then
      app_error(case when p_delete then 'الحذف لمدير النظام فقط.' else 'الاسترجاع لمدير النظام فقط.' end);
    end if;
    if p_delete then
      update st_tasks set deleted_at = systimestamp, deleted_by = g_uid where id = l_id and deleted_at is null;
    else
      update st_tasks set deleted_at = null, deleted_by = null where id = l_id and deleted_at is not null;
    end if;
    return '{"ok":true}';
  end;

  function review_count return clob is
    n number;
  begin
    select count(*) into n from st_tasks
     where review_reasons is not null and deleted_at is null
       and (engineer_id = g_uid or g_role in ('admin', 'head', 'viewer'));
    return '{"count":' || n || '}';
  end;

  function purge_all_tasks return clob is
    n number;
    o json_object_t := json_object_t();
  begin
    require('admin', 'حذف كل المهام لمدير النظام فقط.');
    select count(*) into n from st_tasks;
    execute immediate 'truncate table st_task_audit';
    execute immediate 'truncate table st_tasks';
    execute immediate 'alter table st_tasks modify id generated by default as identity (start with 1)';
    execute immediate 'alter table st_task_audit modify id generated by default as identity (start with 1)';
    o.put('tasks', n);
    o.put('at', ts_iso(systimestamp));
    return o.to_clob;
  end;

  -- ───────────────────────── القوائم ─────────────────────────

  function lookups_load return clob is
    r clob;
  begin
    select json_object(
             'taskTypes' value (select json_arrayagg(json_object('id' value id, 'name' value name, 'sort_order' value sort_order,
                                  'is_active' value is_active) order by sort_order, name returning clob) from st_task_types) format json,
             'correspondenceTypes' value (select json_arrayagg(json_object('id' value id, 'name' value name, 'sort_order' value sort_order,
                                  'is_active' value is_active) order by sort_order, name returning clob) from st_correspondence_types) format json,
             'statuses' value (select json_arrayagg(json_object('id' value id, 'name' value name, 'kind' value kind,
                                  'sort_order' value sort_order, 'is_active' value is_active) order by sort_order, name returning clob)
                                 from st_task_statuses) format json
             returning clob)
      into r from dual;
    return r;
  end;

  function lookup_save(o in json_object_t) return clob is
    l_kind  varchar2(40) := jstr(o, 'kind');
    it      json_object_t := o.get_object('item');
    l_id    number := jnum(it, 'id');
    l_name  varchar2(100) := trim(jstr(it, 'name'));
    l_sort  number := nvl(jnum(it, 'sort_order'), 0);
    l_act   number := case when jbool(it, 'is_active', true) then 1 else 0 end;
    l_skind varchar2(10) := nvl(jstr(it, 'kind'), 'open');
    r       json_object_t := json_object_t();
  begin
    require('admin,head', 'القوائم لمدير النظام ورئيس القسم فقط.');
    if l_name is null then app_error('اكتب الاسم.'); end if;
    if l_kind = 'taskTypes' then
      if l_id is null then insert into st_task_types (name, sort_order, is_active) values (l_name, l_sort, l_act) returning id into l_id;
      else update st_task_types set name = l_name, sort_order = l_sort, is_active = l_act where id = l_id; end if;
    elsif l_kind = 'correspondenceTypes' then
      if l_id is null then insert into st_correspondence_types (name, sort_order, is_active) values (l_name, l_sort, l_act) returning id into l_id;
      else update st_correspondence_types set name = l_name, sort_order = l_sort, is_active = l_act where id = l_id; end if;
    elsif l_kind = 'statuses' then
      if l_skind not in ('open', 'done', 'cancelled') then app_error('نوع حالة غير معروف.'); end if;
      if l_id is null then insert into st_task_statuses (name, kind, sort_order, is_active) values (l_name, l_skind, l_sort, l_act) returning id into l_id;
      else update st_task_statuses set name = l_name, kind = l_skind, sort_order = l_sort, is_active = l_act where id = l_id; end if;
    else
      app_error('قائمة غير معروفة.');
    end if;
    if sql%rowcount = 0 then app_error('القيمة غير موجودة.'); end if;
    r.put('id', l_id); r.put('name', l_name); r.put('sort_order', l_sort); r.put('is_active', l_act);
    if l_kind = 'statuses' then r.put('kind', l_skind); end if;
    return r.to_clob;
  end;

  -- ───────────────────────── الإعدادات ─────────────────────────

  function settings_load return clob is
    r clob;
  begin
    select json_objectagg(s.setting_key value s.setting_value format json returning clob)
      into r from st_app_settings s;
    return nvl(r, to_clob('{}'));
  end;

  function settings_save(o in json_object_t) return clob is
    s     json_object_t := o.get_object('settings');
    keys  json_key_list;
    l_val clob;
  begin
    require('admin', 'الإعدادات لمدير النظام فقط.');
    keys := s.get_keys;
    for i in 1 .. keys.count loop
      if keys(i) in ('edit_lock_days', 'delay_threshold_days', 'min_password_length', 'force_password_change',
                     'allow_purge_tasks', 'announcement', 'announcement_type', 'announcement_expires_at', 'sync_user_id') then
        l_val := s.get(keys(i)).to_clob;
        merge into st_app_settings a
        using (select keys(i) k from dual) x on (a.setting_key = x.k)
        when matched then update set a.setting_value = l_val, a.updated_at = systimestamp, a.updated_by = g_uid
        when not matched then insert (setting_key, setting_value, updated_by) values (x.k, l_val, g_uid);
      end if;
    end loop;
    return settings_load;
  end;

  -- ───────────────────────── سجل التعديلات ─────────────────────────

  function audit_list(o in json_object_t) return clob is
    r      clob;
    l_task number := jnum(o, 'taskId');
    l_from date := parse_date(jstr(o, 'from'));
    l_to   date := parse_date(jstr(o, 'to'));
    l_lim  number := least(5000, nvl(jnum(o, 'limit'), 500));
    l_f    timestamp with time zone;
    l_t    timestamp with time zone;
  begin
    require('admin,head', 'سجل التعديلات لمدير النظام ورئيس القسم فقط.');
    -- الأيام بتوقيت مسقط (كما في نسخة Supabase)
    if l_from is not null then l_f := from_tz(cast(l_from as timestamp), 'Asia/Muscat'); end if;
    if l_to is not null then l_t := from_tz(cast(l_to + 1 as timestamp), 'Asia/Muscat'); end if;
    select json_arrayagg(json_object(
             'id' value a.id, 'task_id' value a.task_id, 'action' value a.action,
             'changed_by' value a.changed_by, 'changed_at' value st_api.ts_iso(a.changed_at),
             'changed_fields' value a.changed_fields format json,
             'old_data' value a.old_data format json,
             'new_data' value a.new_data format json
             returning clob) order by a.changed_at desc, a.id desc returning clob)
      into r
      from (select * from st_task_audit
             where (l_task is null or task_id = l_task)
               and (l_f is null or changed_at >= l_f)
               and (l_t is null or changed_at < l_t)
             order by changed_at desc, id desc
             fetch first l_lim rows only) a;
    return nvl(r, to_clob('[]'));
  end;

  -- ───────────────────────── النقل من Supabase ─────────────────────────
  -- تستدعيه الواجهة من «تحديث بيانات التجربة من الإنتاج» في صفحة الإعدادات:
  -- المتصفح يقرأ بيانات الإنتاج من Supabase بحساب مدير النظام هناك، ثم يرسلها هنا على دفعات.

  procedure require_real_admin is
  begin
    if g_acting then app_error('عد إلى حسابك أولاً.'); end if;
    require('admin', 'هذه العملية لمدير النظام فقط.');
  end;

  function migrate_begin(o in json_object_t) return clob is
    l_mode    varchar2(20) := case when jstr(o, 'mode') = 'same' then 'same' else 'login_no' end;
    l_pw      varchar2(4000) := jstr(o, 'password');
    l_force   number := case when jbool(o, 'force', false) then 1 else 0 end;
    a         json_array_t;
    p         json_object_t;
    l_id      varchar2(36);
    l_no      varchar2(20);
    l_email   varchar2(320);
    l_ids     sys.odcivarchar2list := sys.odcivarchar2list();
    l_created number := 0;
    l_removed number := 0;
    l_notes   json_array_t := json_array_t();
    n         number;
    r         json_object_t := json_object_t();
    procedure note(p_name varchar2, p_note varchar2) is
      x json_object_t := json_object_t();
    begin x.put('name', p_name); x.put('note', p_note); l_notes.append(x); end;
  begin
    require_real_admin;
    if l_mode = 'same' then check_password(l_pw); end if;
    if l_pw is not null and length(l_pw) < min_pw then app_error('كلمة المرور ' || min_pw || ' أحرف على الأقل.'); end if;
    g_migrating := true;

    delete from st_task_audit;
    delete from st_tasks;
    delete from st_acting;

    -- القوائم بنفس أرقامها في الإنتاج
    delete from st_task_types;
    delete from st_correspondence_types;
    delete from st_task_statuses;
    a := o.get_array('task_types');
    for i in 0 .. a.get_size - 1 loop
      p := treat(a.get(i) as json_object_t);
      insert into st_task_types (id, name, sort_order, is_active)
      values (jnum(p, 'id'), jstr(p, 'name'), nvl(jnum(p, 'sort_order'), 0), case when jbool(p, 'is_active', true) then 1 else 0 end);
    end loop;
    a := o.get_array('correspondence_types');
    for i in 0 .. a.get_size - 1 loop
      p := treat(a.get(i) as json_object_t);
      insert into st_correspondence_types (id, name, sort_order, is_active)
      values (jnum(p, 'id'), jstr(p, 'name'), nvl(jnum(p, 'sort_order'), 0), case when jbool(p, 'is_active', true) then 1 else 0 end);
    end loop;
    a := o.get_array('task_statuses');
    for i in 0 .. a.get_size - 1 loop
      p := treat(a.get(i) as json_object_t);
      insert into st_task_statuses (id, name, kind, sort_order, is_active)
      values (jnum(p, 'id'), jstr(p, 'name'), nvl(jstr(p, 'kind'), 'open'), nvl(jnum(p, 'sort_order'), 0),
              case when jbool(p, 'is_active', true) then 1 else 0 end);
    end loop;

    -- الإعدادات كما في الإنتاج
    delete from st_app_settings;
    a := o.get_array('settings');
    for i in 0 .. a.get_size - 1 loop
      p := treat(a.get(i) as json_object_t);
      insert into st_app_settings (setting_key, setting_value, updated_by)
      values (jstr(p, 'key'), p.get('value').to_clob, g_real_uid);
    end loop;

    -- المستخدمون: حسابك أنت يبقى بكلمة مروره ودور «مدير النظام»
    a := o.get_array('profiles');
    for i in 0 .. a.get_size - 1 loop
      l_ids.extend; l_ids(l_ids.count) := jstr(treat(a.get(i) as json_object_t), 'id');
    end loop;
    delete from st_profiles where id <> g_real_uid and id not in (select column_value from table(l_ids));
    l_removed := sql%rowcount;

    for i in 0 .. a.get_size - 1 loop
      p := treat(a.get(i) as json_object_t);
      l_id := jstr(p, 'id');
      l_no := jstr(p, 'login_no');
      l_email := lower(jstr(p, 'email'));
      if l_email like '%@tasks.internal' then l_email := null; end if;   -- بريد داخلي من Supabase
      select count(*) into n from st_profiles where id = l_id;
      if n = 0 then
        insert into st_profiles (id, login_no, email, full_name, short_name, role, is_active, must_change_password, created_at)
        values (l_id, l_no, l_email, jstr(p, 'full_name'), jstr(p, 'short_name'), jstr(p, 'role'),
                case when jbool(p, 'is_active', true) then 1 else 0 end, l_force, nvl(parse_ts(jstr(p, 'created_at')), systimestamp));
        l_created := l_created + 1;
      elsif l_id = g_real_uid then
        update st_profiles set login_no = l_no, email = l_email, full_name = jstr(p, 'full_name'),
               short_name = jstr(p, 'short_name'), role = 'admin', is_active = 1, updated_at = systimestamp
         where id = l_id;
      else
        update st_profiles set login_no = l_no, email = l_email, full_name = jstr(p, 'full_name'),
               short_name = jstr(p, 'short_name'), role = jstr(p, 'role'),
               is_active = case when jbool(p, 'is_active', true) then 1 else 0 end,
               must_change_password = l_force, updated_at = systimestamp
         where id = l_id;
      end if;
      if l_id <> g_real_uid then
        if l_mode = 'same' then
          set_password(l_id, l_pw);
        elsif l_no is not null and length(l_no) >= min_pw then
          set_password(l_id, l_no);
        elsif l_pw is not null then
          set_password(l_id, l_pw);
          note(jstr(p, 'full_name'), case when l_no is null then 'ليس له رقم' else 'رقمه قصير' end || '، فأُعطي كلمة المرور الموحدة');
        else
          note(jstr(p, 'full_name'), case when l_no is null then 'ليس له رقم' else 'رقمه أقصر من ' || min_pw || ' خانات' end
               || '، فلم تُعيَّن له كلمة مرور. عيّنها من «المستخدمون».');
        end if;
      end if;
    end loop;

    r.put('users', a.get_size);
    r.put('created', l_created);
    r.put('deactivated', l_removed);
    r.put('notes', l_notes);
    return r.to_clob;
  end;

  function migrate_tasks(o in json_object_t) return clob is
    a json_array_t := o.get_array('rows');
    t json_object_t;
  begin
    require_real_admin;
    g_migrating := true;
    for i in 0 .. a.get_size - 1 loop
      t := treat(a.get(i) as json_object_t);
      insert into st_tasks (id, engineer_id, ref_no, requester, employee_name, subject, received_date, completed_date,
                            notes, task_type_id, correspondence_type_id, status_id, delay_reason,
                            created_at, created_by, updated_at, updated_by, deleted_at, deleted_by, review_reasons, priority)
      values (jnum(t, 'id'), jstr(t, 'engineer_id'), jstr(t, 'ref_no'), jstr(t, 'requester'), jstr(t, 'employee_name'),
              jclob(t, 'subject'), parse_date(jstr(t, 'received_date')), parse_date(jstr(t, 'completed_date')),
              jclob(t, 'notes'), jnum(t, 'task_type_id'), jnum(t, 'correspondence_type_id'), jnum(t, 'status_id'),
              jclob(t, 'delay_reason'),
              nvl(parse_ts(jstr(t, 'created_at')), systimestamp), jstr(t, 'created_by'),
              nvl(parse_ts(jstr(t, 'updated_at')), systimestamp), jstr(t, 'updated_by'),
              parse_ts(jstr(t, 'deleted_at')), jstr(t, 'deleted_by'),
              review_reasons_of(t), nvl(jstr(t, 'priority'), 'normal'));
    end loop;
    return '{"count":' || a.get_size || '}';
  end;

  function migrate_audit(o in json_object_t) return clob is
    a json_array_t := o.get_array('rows');
    t json_object_t;
  begin
    require_real_admin;
    for i in 0 .. a.get_size - 1 loop
      t := treat(a.get(i) as json_object_t);
      insert into st_task_audit (id, task_id, action, changed_by, changed_at, changed_fields, old_data, new_data)
      values (jnum(t, 'id'), jnum(t, 'task_id'), jstr(t, 'action'), jstr(t, 'changed_by'),
              nvl(parse_ts(jstr(t, 'changed_at')), systimestamp),
              case when t.has('changed_fields') and not t.get('changed_fields').is_null then t.get('changed_fields').to_clob end,
              case when t.has('old_data') and not t.get('old_data').is_null then t.get('old_data').to_clob end,
              case when t.has('new_data') and not t.get('new_data').is_null then t.get('new_data').to_clob end);
    end loop;
    return '{"count":' || a.get_size || '}';
  end;

  function migrate_end return clob is
    r json_object_t := json_object_t();
    n number;
  begin
    require_real_admin;
    -- الترقيم يكمل بعد أكبر رقم منقول
    for t in (select column_value tn from table(sys.odcivarchar2list(
                'ST_TASKS', 'ST_TASK_AUDIT', 'ST_TASK_TYPES', 'ST_CORRESPONDENCE_TYPES', 'ST_TASK_STATUSES'))) loop
      execute immediate 'alter table ' || t.tn || ' modify id generated by default as identity (start with limit value)';
    end loop;
    select count(*) into n from st_tasks;
    r.put('tasks', n);
    select count(*) into n from st_task_audit;
    r.put('audit', n);
    r.put('at', ts_iso(systimestamp));
    return r.to_clob;
  end;

  -- ───────────────────────── التوزيع ─────────────────────────

  function error_json(p_code in number, p_msg in varchar2) return clob is
    e   json_object_t := json_object_t();
    msg varchar2(4000);
  begin
    if p_code between -20999 and -20000 then
      msg := substr(p_msg, 12);
      msg := regexp_replace(msg, chr(10) || 'ORA-.*$', '', 1, 0, 'n');
    elsif p_code = -1 then
      msg := case
               when instr(p_msg, 'LOGIN_NO') > 0 then 'هذا الرقم مسجّل لمستخدم آخر.'
               when instr(p_msg, 'EMAIL') > 0 then 'هذا البريد مسجّل مسبقاً.'
               else 'هذه القيمة موجودة مسبقاً.' end;
    elsif p_code = -2291 then
      msg := 'قيمة مرتبطة غير موجودة (مهندس أو قائمة).';
    elsif p_code = -2290 then
      msg := 'القيمة لا تطابق قواعد البيانات: ' || p_msg;
    else
      msg := 'خطأ غير متوقع في الخادم: ' || p_msg;
    end if;
    e.put('st', 0);
    e.put('error', msg);
    if p_code = -20010 then e.put('expired', 'session'); end if;
    if p_code = -20011 then e.put('expired', 'acting'); end if;
    return e.to_clob;
  end;

  function dispatch(p_action in varchar2, p_payload in clob) return clob is
    o json_object_t;
    r clob;
  begin
    g_migrating := false;
    o := case when p_payload is null or dbms_lob.getlength(p_payload) = 0 then json_object_t()
              else json_object_t.parse(p_payload) end;
    resolve_user;
    r := case p_action
      when 'me'                 then me_json
      when 'act_as'             then act_as(o)
      when 'stop_acting'        then stop_acting
      when 'change_password'    then change_password(o)
      when 'tasks_list'         then tasks_query(null, o)
      when 'task_get'           then task_get(jnum(o, 'id'))
      when 'task_create'        then task_create(o)
      when 'task_update'        then task_update(o)
      when 'task_remove'        then task_set_deleted(o, true)
      when 'task_restore'       then task_set_deleted(o, false)
      when 'tasks_bulk_create'  then tasks_bulk_create(o)
      when 'review_count'       then review_count
      when 'lookups_load'       then lookups_load
      when 'lookup_save'        then lookup_save(o)
      when 'users_list'         then users_list
      when 'user_create'        then user_create(o)
      when 'user_update'        then user_update(o)
      when 'user_reset_password' then user_reset_password(o)
      when 'users_reset_all'    then users_reset_all(o)
      when 'settings_load'      then settings_load
      when 'settings_save'      then settings_save(o)
      when 'audit_list'         then audit_list(o)
      when 'purge_all_tasks'    then purge_all_tasks
      when 'migrate_begin'      then migrate_begin(o)
      when 'migrate_tasks'      then migrate_tasks(o)
      when 'migrate_audit'      then migrate_audit(o)
      when 'migrate_end'        then migrate_end
      else null end;
    if r is null then app_error('عملية غير معروفة: ' || p_action); end if;
    g_migrating := false;
    commit;
    return '{"st":1,"data":' || r || '}';
  exception when others then
    g_migrating := false;
    rollback;
    return error_json(sqlcode, sqlerrm);
  end;

  procedure ajax is
  begin
    out_clob(dispatch(apex_application.g_x01, apex_application.g_clob_01));
  end;

end st_api;
/

-- =====================================================================
--  المشغّلات (مقابل tasks_before_write و tasks_review_guard و tasks_audit في Supabase)
-- =====================================================================

-- قبل حفظ مهمة: القيم التلقائية، والقيود، وقفل التعديل، وأسباب المراجعة
create or replace trigger st_tasks_biu
before insert or update on st_tasks
for each row
declare
  v_role     varchar2(10) := st_api.g_role;
  v_uid      varchar2(36) := st_api.g_uid;
  v_kind     varchar2(10);
  v_old_kind varchar2(10);
  v_lock     number;
begin
  if st_api.g_migrating then return; end if;

  -- أسباب المراجعة: المصفوفة الفارغة = لا تحتاج مراجعة. يضعها الاستيراد (مدير النظام) فقط، وغيره يمسحها فقط
  if :new.review_reasons is not null
     and regexp_like(dbms_lob.substr(:new.review_reasons, 200, 1), '^[[:space:]]*\[[[:space:]]*\][[:space:]]*$') then
    :new.review_reasons := null;
  end if;
  if nvl(v_role, '-') <> 'admin' and v_uid is not null and :new.review_reasons is not null
     and (inserting or not st_api.clob_eq(:new.review_reasons, :old.review_reasons)) then
    st_api.app_error('أسباب المراجعة يضعها الاستيراد فقط.');
  end if;

  if inserting then
    if v_role is null then                       -- إدخال من خارج التطبيق (مثل SQL Workshop)
      :new.created_by := nvl(:new.created_by, :new.engineer_id);
    else
      if v_role = 'viewer' then st_api.app_error('المشاهد لا يستطيع إضافة مهام.'); end if;
      if :new.engineer_id is null or v_role = 'engineer' then
        :new.engineer_id := v_uid;               -- المهندس يضيف لنفسه فقط
      end if;
      -- الاستيراد (مدير النظام) يسجّل المهمة باسم مهندسها؛ ومن أدخلها فعلاً يُحفظ في السجل (entered_by)
      :new.created_by := case when v_role = 'admin' then nvl(:new.created_by, v_uid) else v_uid end;
    end if;
    :new.created_at := systimestamp;
    :new.updated_at := systimestamp;
    :new.updated_by := :new.created_by;
    :new.deleted_at := null;
    :new.deleted_by := null;
  else
    -- حقول لا تتغير
    :new.created_at := :old.created_at;
    :new.created_by := :old.created_by;
    :new.updated_at := systimestamp;
    :new.updated_by := nvl(v_uid, :old.updated_by);

    if v_role in ('engineer', 'viewer') then
      if :new.engineer_id <> :old.engineer_id then st_api.app_error('لا يمكن نقل المهمة إلى مهندس آخر.'); end if;
      if (:new.deleted_at is null) <> (:old.deleted_at is null) or :new.deleted_at <> :old.deleted_at then
        st_api.app_error('الحذف لمدير النظام فقط.');
      end if;
    end if;
    if v_role = 'head' and ((:new.deleted_at is null) <> (:old.deleted_at is null) or :new.deleted_at <> :old.deleted_at) then
      st_api.app_error('الحذف لمدير النظام فقط.');
    end if;

    -- قفل التعديل: مهمة مكتملة مضى على انتهائها أكثر من «مدة القفل» (0 = بدون قفل). لا يُطبَّق على المدير ورئيس القسم
    if v_role = 'engineer' then
      v_lock := st_api.setting_int('edit_lock_days', 0);
      select max(kind) into v_old_kind from st_task_statuses where id = :old.status_id;
      if v_lock > 0 and v_old_kind = 'done' and :old.completed_date is not null
         and :old.completed_date + v_lock < st_api.today then
        st_api.app_error('المهمة مقفلة: مضى على إنجازها أكثر من ' || v_lock
                         || ' يوم. اطلب من مدير النظام أو رئيس القسم تعديلها.');
      end if;
    end if;
  end if;

  -- تنظيف النصوص (النص الفارغ في Oracle = NULL)
  :new.ref_no        := trim(:new.ref_no);
  :new.requester     := trim(:new.requester);
  :new.employee_name := trim(:new.employee_name);
  :new.subject       := trim(:new.subject);
  :new.notes         := trim(:new.notes);
  :new.delay_reason  := trim(:new.delay_reason);

  -- مهمة مستوردة تنتظر المراجعة: تُحفظ كما في الملف، والقواعد تُطبَّق عند «تمت المراجعة» (مسح الأسباب)
  if :new.review_reasons is not null then return; end if;

  if :new.subject is null or dbms_lob.getlength(:new.subject) = 0 then st_api.app_error('الموضوع مطلوب.'); end if;
  if :new.received_date is null then st_api.app_error('تاريخ الاستقبال مطلوب.'); end if;

  -- الحالة المكتملة تحتاج تاريخ انتهاء، وغير المكتملة لا تحمل تاريخ انتهاء
  select max(kind) into v_kind from st_task_statuses where id = :new.status_id;
  if v_kind = 'done' and :new.completed_date is null then
    st_api.app_error('المهمة المكتملة تحتاج «تاريخ الانتهاء».');
  end if;
  if v_kind = 'open' then :new.completed_date := null; end if;
  if :new.completed_date is not null and :new.completed_date < :new.received_date then
    st_api.app_error('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ الاستقبال.');
  end if;
end;
/

-- بعد حفظ مهمة: سجل التعديلات (نفس شكل JSON في نسخة Supabase)
create or replace trigger st_tasks_audit
after insert or update on st_tasks
for each row
declare
  n        json_object_t := json_object_t();
  o        json_object_t := json_object_t();
  od       json_object_t := json_object_t();
  nd       json_object_t := json_object_t();
  fields   json_array_t := json_array_t();
  keys     json_key_list;
  v_action varchar2(10);
  type t_list is table of varchar2(64);
  changed  t_list := t_list();
  tmp      varchar2(64);
begin
  if st_api.g_migrating then return; end if;

  st_api.jp_n(n, 'id', :new.id);                   st_api.jp_s(n, 'engineer_id', :new.engineer_id);
  st_api.jp_s(n, 'ref_no', :new.ref_no);           st_api.jp_s(n, 'requester', :new.requester);
  st_api.jp_s(n, 'employee_name', :new.employee_name);
  st_api.jp_c(n, 'subject', :new.subject);
  st_api.jp_d(n, 'received_date', :new.received_date);
  st_api.jp_d(n, 'completed_date', :new.completed_date);
  st_api.jp_c(n, 'notes', :new.notes);
  st_api.jp_n(n, 'task_type_id', :new.task_type_id);
  st_api.jp_n(n, 'correspondence_type_id', :new.correspondence_type_id);
  st_api.jp_n(n, 'status_id', :new.status_id);
  st_api.jp_c(n, 'delay_reason', :new.delay_reason);
  st_api.jp_t(n, 'created_at', :new.created_at);   st_api.jp_s(n, 'created_by', :new.created_by);
  st_api.jp_t(n, 'deleted_at', :new.deleted_at);   st_api.jp_s(n, 'deleted_by', :new.deleted_by);
  st_api.jp_j(n, 'review_reasons', :new.review_reasons);
  st_api.jp_s(n, 'priority', :new.priority);

  if inserting then
    -- إذا أدخلها شخص باسم غيره (الاستيراد)، يُحفظ من أدخلها فعلاً
    if st_api.g_uid is not null and st_api.g_uid <> nvl(:new.created_by, '-') then
      n.put('entered_by', st_api.g_uid);
    end if;
    insert into st_task_audit (task_id, action, changed_by, new_data)
    values (:new.id, 'insert', :new.created_by, n.to_clob);
    return;
  end if;

  st_api.jp_n(o, 'id', :old.id);                   st_api.jp_s(o, 'engineer_id', :old.engineer_id);
  st_api.jp_s(o, 'ref_no', :old.ref_no);           st_api.jp_s(o, 'requester', :old.requester);
  st_api.jp_s(o, 'employee_name', :old.employee_name);
  st_api.jp_c(o, 'subject', :old.subject);
  st_api.jp_d(o, 'received_date', :old.received_date);
  st_api.jp_d(o, 'completed_date', :old.completed_date);
  st_api.jp_c(o, 'notes', :old.notes);
  st_api.jp_n(o, 'task_type_id', :old.task_type_id);
  st_api.jp_n(o, 'correspondence_type_id', :old.correspondence_type_id);
  st_api.jp_n(o, 'status_id', :old.status_id);
  st_api.jp_c(o, 'delay_reason', :old.delay_reason);
  st_api.jp_t(o, 'created_at', :old.created_at);   st_api.jp_s(o, 'created_by', :old.created_by);
  st_api.jp_t(o, 'deleted_at', :old.deleted_at);   st_api.jp_s(o, 'deleted_by', :old.deleted_by);
  st_api.jp_j(o, 'review_reasons', :old.review_reasons);
  st_api.jp_s(o, 'priority', :old.priority);

  keys := n.get_keys;
  for i in 1 .. keys.count loop
    if not st_api.clob_eq(n.get(keys(i)).to_clob, o.get(keys(i)).to_clob) then
      changed.extend; changed(changed.count) := keys(i);
    end if;
  end loop;
  if changed.count = 0 then return; end if;     -- لا تغيير فعلي

  -- ترتيب أسماء الحقول أبجدياً (كما في نسخة Supabase)
  for i in 1 .. changed.count loop
    for j in i + 1 .. changed.count loop
      if changed(j) < changed(i) then tmp := changed(i); changed(i) := changed(j); changed(j) := tmp; end if;
    end loop;
  end loop;
  for i in 1 .. changed.count loop
    fields.append(changed(i));
    od.put(changed(i), o.get(changed(i)));
    nd.put(changed(i), n.get(changed(i)));
  end loop;

  v_action := case
    when :old.deleted_at is null and :new.deleted_at is not null then 'delete'
    when :old.deleted_at is not null and :new.deleted_at is null then 'restore'
    else 'update' end;

  insert into st_task_audit (task_id, action, changed_by, changed_fields, old_data, new_data)
  values (:new.id, v_action, nvl(st_api.g_uid, :new.updated_by), fields.to_clob, od.to_clob, nd.to_clob);
end;
/
