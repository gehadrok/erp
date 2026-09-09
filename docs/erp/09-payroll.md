# 9. الرواتب (Payroll)

## 9.1 الهيكل الوظيفي

```sql
CREATE TABLE departments (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  code       VARCHAR(20) NOT NULL,
  name_ar    VARCHAR(200) NOT NULL,
  parent_id  BIGINT REFERENCES departments(id),
  gl_expense_account_id BIGINT REFERENCES accounts(id), -- توزيع تكلفة الرواتب
  UNIQUE (company_id, code)
);

CREATE TABLE employees (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  code          VARCHAR(20) NOT NULL,
  name_ar       VARCHAR(200) NOT NULL,
  department_id BIGINT REFERENCES departments(id),
  job_title     VARCHAR(100),
  hire_date     DATE NOT NULL,
  contract_type VARCHAR(20) NOT NULL,    -- FULL_TIME, PART_TIME, CONTRACT
  basic_salary  NUMERIC(18,2) NOT NULL,
  bank_iban     VARCHAR(34),
  social_insurance_no VARCHAR(30),
  gl_advance_account_id BIGINT REFERENCES accounts(id), -- سلف الموظف
  status        VARCHAR(15) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ON_LEAVE, TERMINATED
  termination_date DATE,
  UNIQUE (company_id, code)
);

CREATE TABLE salary_components (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  code        VARCHAR(20) NOT NULL,      -- BASIC, HOUSING, TRANSPORT, GOSI, LOAN_DEDUCT
  name_ar     VARCHAR(100) NOT NULL,
  kind        VARCHAR(10) NOT NULL,      -- EARNING / DEDUCTION
  calc_type   VARCHAR(10) NOT NULL,      -- FIXED / PERCENT / FORMULA
  percent_of  BIGINT REFERENCES salary_components(id), -- للنسبة من مكوّن آخر
  formula     TEXT,                      -- لغة معادلات آمنة (مثال أدناه)
  gl_account_id BIGINT NOT NULL REFERENCES accounts(id), -- حساب المصروف/الالتزام
  is_taxable  BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE employee_salary_components (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id       BIGINT NOT NULL REFERENCES employees(id),
  component_id      BIGINT NOT NULL REFERENCES salary_components(id),
  amount            NUMERIC(18,2),       -- للنوع FIXED
  percent_value     NUMERIC(5,2),        -- للنوع PERCENT
  effective_from    DATE NOT NULL,
  effective_to      DATE
);
```

## 9.2 مسير الرواتب

```sql
CREATE TABLE payroll_runs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   BIGINT NOT NULL,
  branch_id    BIGINT,
  period_code  VARCHAR(7) NOT NULL,      -- '2026-09'
  status       VARCHAR(15) NOT NULL DEFAULT 'DRAFT', -- DRAFT, CALCULATED, APPROVED, POSTED, PAID
  total_gross  NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_net    NUMERIC(18,2) NOT NULL DEFAULT 0,
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  UNIQUE (company_id, period_code)
);

CREATE TABLE payroll_lines (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  component_id BIGINT NOT NULL REFERENCES salary_components(id),
  amount      NUMERIC(18,2) NOT NULL
);
```

### دورة المسير الشهري
1. **تجهيز**: جلب الموظفين النشطين + مكوّنات رواتبهم + المتغيرات (غياب، إجازة بدون راتب، سلف تُستقطع).
2. **احتساب**: تنفيذ المعادلات بالترتيب (الأساسيات ثم البدلات ثم الاستقطاعات). القاعدة: `net = Σ أرباح − Σ استقطاعات`.
3. **مراجعة**: شاشة مقارنة بالشهر السابق + استثناءات (تغير > 20%).
4. **اعتماد** → توليد قيد مجمّع:
   - مدين: حسابات مصروف الرواتب (لكل مكوّن أرباح، موزعة على الإدارات/الفروع)
   - دائن: رواتب مستحقة (الصافي) + تأمينات اجتماعية مستحقة + سلف مستقطعة + أي التزام ضريبي
5. **صرف**: سند صرف جماعي/بنكي يغلق "رواتب مستحقة".
6. **ملف WPS/الحوالة البنكية**: تصدير ملف بنكي بالمقرر المحلي.

## 9.3 المعادلات

لغة معادلات آمنة (تقييم مقيد، بلا وصول للنظام):

```
// أمثلة
GOSI = BASIC * 0.0975
HOUSING = BASIC * 0.25
OVERTIME = (BASIC / 30 / 8) * 1.5 * OT_HOURS
ABSENCE_DEDUCT = (BASIC / 30) * ABSENT_DAYS
```

المتغيرات المتاحة: `BASIC`، عدد ساعات العمل الإضافي `OT_HOURS`، أيام الغياب `ABSENT_DAYS`، إلخ. المعادلات تُختبر في بيئة تجريبية قبل تفعيلها، وأي تغيير يُسجل في التدقيق.

## 9.4 السلف والنهاية

- سلفة موظف = دفعة تُرحّل على حساب سلف الموظف (أصل) وتُستقطع بالأقساط من المسير.
- إجازات ومستحقات نهاية الخدمة: تُحسب وفق قانون العمل المحلي (مثلاً نصف شهر لكل سنة لأول 5 سنوات، ثم شهر) وتُرحّل كمصروف عند الاستحقاق.
- مقابلات نهاية الخدمة: تسوية سلف، إجازة غير مستخدمة، وأي استحقاقات، ثم قيد صرف.

## 9.5 التقارير

- مسير رواتب مفصل وملخص لكل فترة.
- تكلفة الرواتب لكل إدارة/فرع/مركز تكلفة.
- تقرير السلف وأرصدتها.
- تقرير التأمينات الاجتماعية (للإقرار الشهري).
- مقارنة مسير شهرين/سنتين.
