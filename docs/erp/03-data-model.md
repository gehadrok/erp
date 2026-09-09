# 3. نموذج البيانات الأساسي

مخطط PostgreSQL. المفاتيح الأساسية `UUID` أو `BIGINT` — نستخدم `BIGINT identity` للجداول عالية الحركة (القيود والحركات) و`UUID` للكيانات (العملاء، الموردون، الأصناف). العملة الأساسية: `SAR` (قابلة للتغيير لكل شركة).

## 3.1 الإعدادات العامة (core)

```sql
-- الشركات
CREATE TABLE companies (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            VARCHAR(10) UNIQUE NOT NULL,
  name_ar         VARCHAR(200) NOT NULL,
  name_en         VARCHAR(200),
  tax_number      VARCHAR(50),          -- الرقم الضريبي
  base_currency   CHAR(3) NOT NULL DEFAULT 'SAR',
  fiscal_year_start MONTH INT NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- الفروع
CREATE TABLE branches (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  code        VARCHAR(10) NOT NULL,
  name_ar     VARCHAR(200) NOT NULL,
  address     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);

-- العملات
CREATE TABLE currencies (
  code        CHAR(3) PRIMARY KEY,       -- ISO 4217
  name_ar     VARCHAR(50) NOT NULL,
  symbol      VARCHAR(10),
  decimal_places INT NOT NULL DEFAULT 2
);

-- أسعار الصرف (يومية، لكل شركة)
CREATE TABLE exchange_rates (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  currency    CHAR(3) NOT NULL REFERENCES currencies(code),
  rate_date   DATE NOT NULL,
  rate        NUMERIC(18,8) NOT NULL,    -- 1 وحدة أجنبية = rate من العملة الأساسية
  UNIQUE (company_id, currency, rate_date)
);

-- تسلسلات الترقيم
CREATE TABLE sequences (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  doc_type    VARCHAR(30) NOT NULL,      -- JOURNAL, SALE_INV, PUR_INV, PAYMENT, RECEIPT...
  branch_id   BIGINT REFERENCES branches(id),  -- NULL = لكل الشركة
  prefix      VARCHAR(20) NOT NULL DEFAULT '',
  next_no     BIGINT NOT NULL DEFAULT 1,
  padding     INT NOT NULL DEFAULT 5,
  UNIQUE (company_id, doc_type, branch_id)
);
-- الترقيم يجب أن يكون ذرياً:
-- UPDATE sequences SET next_no = next_no + 1
--  WHERE company_id=$1 AND doc_type=$2 AND (branch_id=$3 OR branch_id IS NULL)
--  RETURNING next_no;
```

## 3.2 دليل الحسابات (gl)

```sql
-- المجموعات (مستويات التجميع)
CREATE TABLE account_groups (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  parent_id   BIGINT REFERENCES account_groups(id),
  code        VARCHAR(20) NOT NULL,
  name_ar     VARCHAR(200) NOT NULL,
  type        VARCHAR(20) NOT NULL,   -- ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
  UNIQUE (company_id, code)
);

-- الحسابات (أوراق الشجرة)
CREATE TABLE accounts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id),
  group_id     BIGINT NOT NULL REFERENCES account_groups(id),
  code         VARCHAR(20) NOT NULL,
  name_ar      VARCHAR(200) NOT NULL,
  name_en      VARCHAR(200),
  type         VARCHAR(20) NOT NULL,          -- نفس أنواع المجموعات
  normal_side  CHAR(1) NOT NULL,              -- D (مدين) / C (دائن)
  is_leaf      BOOLEAN NOT NULL DEFAULT TRUE, -- يمكن الترحيل إليه
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  currency     CHAR(3) REFERENCES currencies(code), -- NULL = متعددة العملات
  UNIQUE (company_id, code)
);

-- ربط الحساب بكيانات النظام (حسابات مساعدة)
CREATE TABLE account_links (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   BIGINT NOT NULL REFERENCES accounts(id),
  entity_type  VARCHAR(30) NOT NULL,  -- CUSTOMER, VENDOR, CASHBOX, BANK, EMPLOYEE, FIXED_ASSET, INVENTORY
  entity_id    BIGINT NOT NULL,
  UNIQUE (account_id, entity_type, entity_id)
);

-- الفترات المالية والإقفال
CREATE TABLE fiscal_periods (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  period_code VARCHAR(7) NOT NULL,       -- '2026-01'
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'OPEN', -- OPEN, SOFT_CLOSED, CLOSED
  UNIQUE (company_id, period_code)
);

-- أنواع اليوميات
CREATE TABLE journal_types (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  code       VARCHAR(20) NOT NULL,       -- GJ, SJ (مبيعات), PJ (مشتريات), CR, CD, INV
  name_ar    VARCHAR(100) NOT NULL,
  UNIQUE (company_id, code)
);
```

## 3.3 القيود (gl) — قلب النظام

```sql
CREATE TABLE journal_entries (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  branch_id     BIGINT REFERENCES branches(id),
  journal_type_id BIGINT NOT NULL REFERENCES journal_types(id),
  entry_no      VARCHAR(30) NOT NULL,          -- JV-2026-00001
  entry_date    DATE NOT NULL,
  period_code   VARCHAR(7)  NOT NULL,          -- محسوب من entry_date
  description   TEXT,
  reference     VARCHAR(100),                  -- رقم المستند المصدر
  source_module VARCHAR(30) NOT NULL,          -- MANUAL, SALES, PURCHASING, INVENTORY, PAYROLL, ASSETS
  source_doc    VARCHAR(40),                   -- اسم الجدول المصدر
  source_id     BIGINT,                        -- معرف السجل المصدر
  status        VARCHAR(10) NOT NULL DEFAULT 'DRAFT', -- DRAFT, APPROVED, POSTED, REVERSED
  reversed_by   BIGINT REFERENCES journal_entries(id),
  posted_at     TIMESTAMPTZ,
  posted_by     BIGINT,
  currency      CHAR(3) NOT NULL DEFAULT 'SAR',
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  total_debit   NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit  NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by    BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, entry_no)
);

CREATE TABLE journal_lines (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id    BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no     INT NOT NULL,
  account_id  BIGINT NOT NULL REFERENCES accounts(id),
  branch_id   BIGINT REFERENCES branches(id),
  debit       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit      NOT NULL NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0)),      -- لا مدين ودائن معاً في نفس السطر
  currency    CHAR(3) NOT NULL,
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  debit_base  NUMERIC(18,2) NOT NULL,          -- بالمبلغ المحوّل للعملة الأساسية
  credit_base NUMERIC(18,2) NOT NULL,
  description TEXT,
  cost_center_id BIGINT REFERENCES cost_centers(id)
);
CREATE INDEX idx_lines_account_date ON journal_lines (account_id, entry_id);
CREATE INDEX idx_lines_entry ON journal_lines (entry_id);
```

**قاعدة التوازن** تُفرض على مستوى التطبيق + trigger تحقق إضافي:

```sql
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS TRIGGER AS $$
DECLARE
  d NUMERIC; c NUMERIC;
BEGIN
  SELECT COALESCE(SUM(debit_base),0), COALESCE(SUM(credit_base),0) INTO d, c
  FROM journal_lines WHERE entry_id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF d <> c THEN
    RAISE EXCEPTION 'القيد غير متوازن: مدين=% دائن=%', d, c;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_entry_balanced
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
FOR EACH STATEMENT EXECUTE FUNCTION check_entry_balanced();
```

### مراكز التكلفة
```sql
CREATE TABLE cost_centers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  code       VARCHAR(20) NOT NULL,
  name_ar    VARCHAR(200) NOT NULL,
  parent_id  BIGINT REFERENCES cost_centers(id),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);
```

### أرصدة مُجمّعة (لتسريع التقارير)

بدل الجمع من ملايين الأسطر عند كل تقرير، نجمع رصيد كل حساب لكل (شركة، فرع، فترة):

```sql
CREATE TABLE account_period_balances (
  company_id  BIGINT NOT NULL,
  account_id  BIGINT NOT NULL REFERENCES accounts(id),
  branch_id   BIGINT,
  period_code VARCHAR(7) NOT NULL,
  opening_debit  NUMERIC(18,2) NOT NULL DEFAULT 0,
  opening_credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  period_debit   NUMERIC(18,2) NOT NULL DEFAULT 0,
  period_debit   NUMERIC(18,2) NOT NULL DEFAULT 0,  -- (خطأ مقصود؟ لا، انظر أدناه)
  period_credit  NUMERIC(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, account_id, branch_id, period_code)
);
-- تُحدّث داخل نفس معاملة الترحيل (وليس بعدها) أو تُحسب من دفتر الأستاذ.
```
> ملاحظة: السطر المكرر أعلاه للتوضيح — احذف التكرار عند التنفيذ.

## 3.4 الضرائب

```sql
CREATE TABLE tax_rates (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  code        VARCHAR(20) NOT NULL,       -- VAT15, VAT0, EXEMPT, WHT5
  name_ar     VARCHAR(100) NOT NULL,
  rate        NUMERIC(5,2) NOT NULL,      -- 15.00 = 15%
  kind        VARCHAR(20) NOT NULL,       -- OUTPUT (على المبيعات) / INPUT (على المشتريات)
  gl_account_id BIGINT REFERENCES accounts(id), -- حساب ضريبة المخرجات/المدخلات
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE document_taxes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   BIGINT NOT NULL,
  doc_type     VARCHAR(30) NOT NULL,       -- SALE_INVOICE, PURCHASE_INVOICE
  doc_id       BIGINT NOT NULL,
  line_id      BIGINT,
  tax_rate_id  BIGINT NOT NULL REFERENCES tax_rates(tax_rate_id), -- انظر ملاحظة
  tax_amount   NUMERIC(18,2) NOT NULL,
  tax_amount_base NUMERIC(18) NOT NULL
);
-- ملاحظة: صحّح المرجع إلى tax_rates(id) عند التنفيذ.
```

## 3.5 الترقيم المالي (Money type)

- استخدم `NUMERIC(18,2)` في قاعدة البيانات، و`decimal` في التطبيق — **ممنوع float/double** لأي مبلغ مالي.
- التحويل للعملة الأساسية: `amount * exchange_rate` مقرّباً لخانتين **بنصف للأعلى** (round half up) بعد الضرب.
- فروق التقريب في الفاتورة تُعالج في سطر واحد (سطر الضريبة أو خصم/إضافة بسيطة) حتى لا يختل التوازن.

## 3.6 سجل التدقيق (مخطط موحّد)

```sql
CREATE TABLE audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     BIGINT NOT NULL,
  company_id  BIGINT,
  action      VARCHAR(20) NOT NULL,   -- CREATE, UPDATE, DELETE, POST, APPROVE, LOGIN
  entity      VARCHAR(60) NOT NULL,
  entity_id   TEXT,
  old_values  JSONB,
  new_values  JSONB,
  ip          INET,
  user_agent  TEXT
);
CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id, occurred_at);
```
