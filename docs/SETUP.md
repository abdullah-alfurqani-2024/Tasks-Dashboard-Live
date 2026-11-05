# دليل التركيب خطوة بخطوة

المدة: نحو 15 دقيقة. لا تحتاج تثبيت أي برنامج على جهازك.

---

## 1) تنفيذ ملفات قاعدة البيانات

1. افتح مشروعك في [Supabase](https://supabase.com/dashboard).
2. من القائمة الجانبية اختر **SQL Editor**، ثم **New query**.
3. انسخ محتوى كل ملف من الملفات التالية والصقه، ثم اضغط **Run**. نفّذها **بالترتيب**، ملفاً بعد ملف:

| الترتيب | الملف | ماذا يفعل |
|:-:|---|---|
| 1 | `supabase/sql/01_schema.sql` | ينشئ الجداول |
| 2 | `supabase/sql/02_functions.sql` | ينشئ القواعد التلقائية والسجل والحذف الناعم |
| 3 | `supabase/sql/03_security.sql` | يضع صلاحيات كل دور (RLS) |
| 4 | `supabase/sql/04_seed.sql` | يضيف القوائم الأولية والإعدادات |

- كل جداول النظام تُنشأ في سكيما مستقلة اسمها **`support_tasks`**، فلا تلمس جداولك الموجودة في `public`.
- يجب أن تظهر رسالة **Success** بعد كل ملف.
- يمكن إعادة تنفيذ أي ملف دون ضرر، فهي لا تكرر البيانات ولا تحذفها.

## 1-ب) إتاحة السكيما الجديدة للواجهة

واجهة Supabase البرمجية (Data API) لا ترى إلا السكيمات المضافة صراحةً، وافتراضياً تكون `public` فقط.

1. اذهب إلى **Project Settings ← Data API**، وفي بعض الإصدارات **Project Settings ← API ← Data API Settings**.
2. في خانة **Exposed schemas** أضف `support_tasks` بجانب `public`، ولا تحذف `public` لأن مشروعك السابق يستخدمها.
3. اضغط **Save**.

لا تضفها في **Extra search path**، فلا حاجة لذلك.

**للتحقق:** في **SQL Editor** نفّذ الاستعلام التالي، ويجب أن تظهر 8 أسماء: 7 جداول (`profiles` و`tasks` و`task_types` وغيرها) والعرض `v_tasks`:

```sql
select table_name from information_schema.tables where table_schema = 'support_tasks' order by 1;
```

## 2) إنشاء أول مدير للنظام

1. اذهب إلى **Authentication ← Users ← Add user ← Create new user**.
2. اكتب بريدك وكلمة مرور قوية، وفعّل **Auto Confirm User**، ثم اضغط **Create user**.
3. افتح الملف `supabase/sql/05_first_admin.sql` وعدّل فيه:
   - بريدك، كما كتبته في الخطوة 2؛
   - اسمك الكامل؛
   - الاسم المختصر.
4. نفّذ الملف في **SQL Editor**، فيظهر في النتيجة سطر فيه بريدك والدور `admin`.

بعد ذلك يضيف هذا المدير بقية المستخدمين من شاشة **المستخدمون** داخل النظام.

## 3) نشر دالة إدارة المستخدمين

إضافة المستخدمين وتعطيلهم وإعادة كلمات مرورهم تحتاج صلاحية لا يجوز وضعها في المتصفح. لذلك تتم عبر دالة تعمل على خوادم Supabase.

1. اذهب إلى **Edge Functions**، ثم **Deploy a new function**، ثم **Via Editor**.
2. اكتب اسم الدالة بالضبط: `admin-users`.
3. احذف المثال الموجود، والصق محتوى الملف `supabase/functions/admin-users/index.ts`.
4. اضغط **Deploy function**.
5. تأكد أن خيار **Verify JWT** (أو Enforce JWT verification) **مفعّل**. هذا هو الوضع الافتراضي.

ملاحظات:

- لا تحتاج إضافة أي مفتاح (Secret) يدوياً، فـ Supabase يوفّر للدالة رابط المشروع ومفتاح `service_role` تلقائياً.
- الدالة تتحقق أولاً من أن من يستدعيها مدير نظام نشط، وترفض أي شخص غيره.

## 4) إعدادات تسجيل الدخول

1. اذهب إلى **Authentication ← Sign In / Providers**، أو **Authentication ← Providers ← Email** في بعض الإصدارات.
   - أوقف **Allow new users to sign up**، حتى لا يسجّل أحد نفسه. المدير وحده يضيف الحسابات.
   - **تنبيه للمشروع المشترك:** حسابات الدخول (Authentication) مشتركة بين كل ما في مشروع Supabase. إذا كان مشروعك السابق يعتمد على التسجيل الذاتي فاترك هذا الخيار كما هو. النظام يبقى آمناً، لأن أي حساب ليس له صف في `support_tasks.profiles` يُرفض دخوله ولا يرى أي بيانات.
   - أبقِ مزوّد **Email** مفعّلاً.
2. اذهب إلى **Authentication ← URL Configuration**.
   - إذا كان **Site URL** مستخدماً لمشروعك السابق فلا تغيّره، وأضف رابط النظام في **Redirect URLs** بدلاً منه. النظام لا يعتمد على روابط البريد، فهذه الخطوة اختيارية.
   - وإلا فاجعل **Site URL** رابط النظام على GitHub Pages، وستحصل عليه في الخطوة 6، مثل: `https://abdullah-alfurqani-2025.github.io/اسم-المستودع/`.

## 5) ربط الواجهة بقاعدة البيانات

1. اذهب إلى **Project Settings**، ثم **Data API** أو **API**:
   - انسخ **Project URL**، وشكله مثل `https://abcdefghijkl.supabase.co`. هو نفس رابط مشروعك الحالي، لأن النظام يعمل داخل المشروع نفسه في سكيما مستقلة.
2. اذهب إلى **Project Settings ← API Keys**:
   - انسخ المفتاح **anon public**، أو **Publishable key** في المشاريع الجديدة.
3. افتح الملف `js/config.js` في المستودع، واكتب القيمتين:

```js
supabase: {
  url: 'https://abcdefghijkl.supabase.co',
  anonKey: 'eyJhbGciOi...',
},
```

> ⚠️ **لا تضع مفتاح `service_role` أو `secret` هنا أبداً.** المفتاح العام وحده مصمَّم ليكون في المتصفح، والحماية مفروضة بصلاحيات قاعدة البيانات.

## 6) النشر على GitHub Pages

1. في المستودع على GitHub اذهب إلى **Settings ← Pages**.
2. في **Source** اختر **Deploy from a branch**.
3. في **Branch** اختر `main` والمجلد `/ (root)`، ثم اضغط **Save**.
4. بعد دقيقة أو دقيقتين يظهر الرابط أعلى الصفحة، فافتحه وسجّل الدخول بحساب المدير.
5. ارجع إلى الخطوة 4 واكتب هذا الرابط في **Site URL**.

---

## بعد التركيب

1. **القوائم:** راجع أنواع المهام والمراسلات والحالات وعدّلها. (في قاعدة بيانات أُنشئت بالقيم الأولية القديمة: نفّذ `supabase/sql/06_lists.sql` مرة واحدة لضبطها على قوائم القسم).
   - لكل حالة نوع: مفتوحة، أو مكتملة، أو ملغاة.
   - هذا النوع يحدد هل تاريخ الانتهاء مطلوب، وكيف تُحسب نسبة الإنجاز والتأخير.
2. **المستخدمون:** أضف المهندسين ورئيس القسم والمشاهدين.
   - النظام ينشئ لكل حساب كلمة مرور مؤقتة، تنسخها وترسلها لصاحبه.
   - يُطلب من المستخدم تغييرها عند أول دخول.
3. **الإعدادات:** حدد مدة قفل التعديل للمهندسين (0 = بدون قفل)، وحد التأخير، وأقل طول لكلمة المرور (6 هو أقل ما تقبله Supabase)، وهل يُلزم المستخدم بتغيير كلمة المرور التي تضعها له عند أول دخول.
4. **الاستيراد:** انقل بيانات Google Sheets السابقة.
   - من Google Sheets اختر **File ← Download ← Microsoft Excel (.xlsx)**، ثم ارفع الملف في شاشة **الاستيراد**.
   - **الملف الرئيسي** (فيه عمود «اسم المهندس»): اختر «من عمود اسم المهندس».
   - **ملف مهندس واحد:** اختر «كل المهام لمهندس واحد».
   - يجب إضافة المهندسين في شاشة المستخدمون **قبل** الاستيراد، حتى تُطابق أسماؤهم.
   - المهام المكررة تُتجاهل تلقائياً، فإعادة استيراد الملف نفسه آمنة.

## حل المشاكل

| المشكلة | الحل |
|---|---|
| «حسابك غير مسجّل في النظام» | المستخدم موجود في Authentication لكن ليس له صف في `profiles`. للمدير الأول: نفّذ `05_first_admin.sql`. لغيره: أضفه من شاشة المستخدمون. |
| «سكيما النظام غير مضافة في Exposed schemas» | أضف `support_tasks` في **Data API ← Exposed schemas** (الخطوة 1-ب). |
| «لا توجد صلاحية على سكيما النظام» | أعد تنفيذ `03_security.sql`. |
| تريد اسماً آخر للسكيما | استبدل `support_tasks` بالاسم الجديد في كل ملفات `supabase/sql`، وفي `schema` داخل `js/config.js`، وفي `SCHEMA` داخل دالة `admin-users`، ثم أضف الاسم الجديد في Exposed schemas. |
| «دالة إدارة المستخدمين غير منشورة» | اسم الدالة يجب أن يكون `admin-users` بالضبط (الخطوة 3). |
| «البريد أو كلمة المرور غير صحيحة» للمدير الأول | تأكد أنك فعّلت **Auto Confirm User** عند إنشائه. |
| الصفحة تعمل بالوضع التجريبي بعد الربط | تأكد من حفظ `js/config.js` في فرع `main`، ثم حدّث الصفحة بـ Ctrl+F5. |
| يظهر الوضع التجريبي وفيه بيانات قديمة | الوضع التجريبي يحفظ في متصفحك فقط. «إعادة البيانات التجريبية» من قائمة المستخدم تعيده لحالته الأولى. |
| المشروع متوقف (Paused) | الخطة المجانية توقف المشروع بعد أسبوع بلا استخدام. افتح لوحة Supabase واضغط **Restore**، والبيانات لا تضيع. |

## النسخ الاحتياطي

- الخطة المجانية لا تشمل نسخاً احتياطياً تلقائياً يمكن تنزيله.
- انسخ البيانات دورياً بإحدى طريقتين:
  - صدّر **التقرير** بكل الفترات إلى Excel من النظام؛
  - أو من **Table Editor ← tasks ← Export to CSV** في لوحة Supabase.

## نقل النظام كاملاً إلى حساب GitHub وحساب Supabase جديدين

أربع مراحل. في الكود ثلاثة ملفات فقط فيها أسماء الحسابات الحالية. `NEW` = اسم حساب GitHub الجديد.

### المرحلة 1: مشروعا Supabase في الحساب الجديد

**أ) مشروع الإنتاج**
1. أنشئ الحساب ثم **New project**، واحفظ كلمة مرور قاعدة البيانات عندك فقط.
2. **SQL Editor:** نفّذ `supabase/production/setup_production.sql` (كل ملفات قاعدة البيانات بالترتيب).
3. **Project Settings ← Data API ← Exposed schemas:** أضف `support_tasks`.
4. **Authentication:**
   - **Sign In / Providers ← Email:** «Minimum password length» = 6.
   - أوقف «Allow new users to sign up».
5. **أول مدير:** **Authentication ← Users ← Add user** (بريدك وكلمة مرور، مع Auto Confirm)، ثم ضع بياناتك في `supabase/production/first_admin.sql` ونفّذه.
6. **Edge Functions:** دالتان بنفس الاسم، والكود من الملفات:
   - `admin-users` ← `supabase/functions/admin-users/index.ts` (Verify JWT **مفعّل**)
   - `auth-login` ← `supabase/functions/auth-login/index.ts` (Verify JWT **متوقف**)
7. **Project Settings ← API Keys:** انسخ **Project URL** و**Publishable key**.

**ب) مشروع التجربة**
1. **New project** في نفس الحساب.
2. **SQL Editor:** نفّذ `supabase/staging/setup_staging.sql`، ثم أضف نفسك من Users ونفّذ `supabase/staging/first_admin.sql`.
3. **Exposed schemas:** أضف `support_tasks_staging`.
4. **Authentication:** نفس إعدادات الإنتاج.
5. **Edge Functions:** ثلاث دوال:
   - `admin-users-staging` ← نفس كود `admin-users` (Verify JWT **مفعّل**)
   - `auth-login-staging` ← نفس كود `auth-login` (Verify JWT **متوقف**)
   - `refresh-staging` ← `supabase/functions/refresh-staging/index.ts` (Verify JWT **مفعّل**)
6. انسخ **Project URL** و**Publishable key** لهذا المشروع أيضاً.

### المرحلة 2: مستودع GitHub في الحساب الجديد

1. بالحساب الجديد افتح **github.com/new/import**:
   - **URL:** رابط المستودع الحالي.
   - **Public** (الاستضافة المجانية لـ Pages تحتاج مستودعاً عاماً).

   الاستيراد ينسخ الفرعين `main` و`staging` مع كل التاريخ. وهو أفضل من Fork، لأنه لا يربط المستودع الجديد بالقديم.
2. **عدّل ثلاثة ملفات** في الفرعين `main` و`staging` معاً:

   | الملف | ما يتغير |
   |---|---|
   | `js/config.js` | `hosts` ← `NEW.github.io`، ورابط ومفتاح عام لكل مشروع |
   | `.github/workflows/pages.yml` | الشرط `github.repository == 'NEW/Tasks-Dashboard-Live'`. **بدونه لا يُنشر الموقع** |
   | `.github/workflows/mirror.yml` | يُحذف، أو يُوجَّه إلى مستودع مرجعي جديد مع سر `REFERENCE_TOKEN` جديد |

3. **Settings ← Actions ← General:** تأكد أن Actions مفعّلة.
4. **Settings ← Pages ← Source:** **GitHub Actions**.
5. **Settings ← Environments ← github-pages ← Deployment branches:** أضف `staging` بجانب `main`.
6. **Settings ← Rules ← Rulesets:** قاعدة `protect-main` على الفرع الافتراضي:
   - Restrict deletions.
   - Block force pushes.
   - Require a pull request (Required approvals = 0).
   - بدون Linear history، وبدون Signed commits، وبدون Status checks.
7. **أول نشر:** **Actions ← نشر الموقع ← Run workflow**، ثم افتح:
   - الإنتاج: `https://NEW.github.io/Tasks-Dashboard-Live/`
   - التجربة: `https://NEW.github.io/Tasks-Dashboard-Live/test/`

### المرحلة 3: ربط التجربة بالإنتاج (زر نسخ البيانات)

1. **في نظام الإنتاج ← المستخدمون:** أضف «مزامنة التجربة» بدور **مشاهد** برقم وكلمة مرور، ثم «تعديل» ← حدّد **«حساب مزامنة التجربة»**.
2. **في مشروع التجربة ← Edge Functions ← Secrets:**

   | السر | القيمة |
   |---|---|
   | `PROD_URL` | رابط مشروع الإنتاج |
   | `PROD_KEY` | المفتاح العام لمشروع الإنتاج |
   | `PROD_SYNC_LOGIN` | رقم حساب المزامنة |
   | `PROD_SYNC_PASSWORD` | كلمة مروره |

### المرحلة 4: البيانات

حسابات الدخول وكلمات المرور لا تُنقل، لأن لكل مشروع Supabase حساباته.
1. **المستخدمون:** يُضافون من جديد بأرقامهم، وكلمة المرور الأولى = الرقم.
2. **المهام:** من النظام القديم: **التقرير ← كل الفترات ← Excel**، ثم **الاستيراد** في الجديد.
3. **الإعدادات والقوائم:** تُضبط من الشاشات.
4. **التجربة:** «تحديث بيانات التجربة من الإنتاج».

> **تنبيه:** الاستيراد من Excel ينقل المهام فقط، و**سجل التعديلات القديم لا ينتقل**.
> البديل نسخ قاعدة البيانات كاملة بأدوات PostgreSQL، وهذا يحتاج كلمة مرور قاعدة البيانات فيُنفَّذ على جهاز المالك.

النظام القديم يبقى يعمل حتى يُوقف، فيمكن تجربة الجديد بجانبه قبل التحويل.
