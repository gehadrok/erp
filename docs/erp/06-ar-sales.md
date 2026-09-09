# 6. المبيعات والعملاء (AR)

## 6.1 العملاء

```sql
CREATE TABLE customers (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  code          VARCHAR(20) NOT NULL,
  name_ar       VARCHAR(200) NOT NULL,
  tax_number    VARCHAR(50),
  credit_limit  NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_terms_days INT NOT NULL DEFAULT 30,
  gl_account_id BIGINT NOT NULL REFERENCES accounts(id),
  currency      CHAR(3) NOT NULL DEFAULT 'SAR',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);
```

## 6.2 دورة البيع

```
عرض سعر ─► فاتورة بيع (+ حركة مخزنية + قيد) ─► سند قبض
    │              │
    │              └─► فاتورة إلكترونية (توقيع + إرسال)
    │              └─► أرصدة لحظية، حد ائتماني
    └───► صالح 30 يوماً، قابل للتحويل لفاتورة
```

## 6.3 فاتورة البيع

```sql
CREATE TABLE sales_invoices (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  branch_id     BIGINT REFERENCES branches(id),
  invoice_no    VARCHAR(30) NOT NULL,
  customer_id   BIGINT NOT NULL REFERENCES customers(id),
  invoice_date  DATE NOT NULL,
  due_date      DATE NOT NULL,
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id),
  currency      CHAR(3) NOT NULL,
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  subtotal      NUMERIC(18,2) NOT NULL,
  tax_amount    NUMERIC(18,2) NOT NULL,
  discount_amount NUMERIC(18,2) NOT NULL,
  total         NUMERIC(18,2) NOT NULL,
  status        VARCHAR(15) NOT NULL DEFAULT 'DRAFT', -- DRAFT, CONFIRMED, PAID, PARTIALLY_PAID, CANCELLED
  einvoice_uuid VARCHAR(64),
  einvoice_status VARCHAR(20),  -- NONE, SIGNED, SUBMITTED, ACCEPTED, REJECTED, CLEARED
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  created_by    BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);

CREATE TABLE sales_invoice_lines (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id  BIGINT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_no     INT NOT NULL,
  item_id     BIGINT NOT NULL REFERENCES items(id),
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  quantity    NUMERIC(18,3) NOT NULL,
  unit_price  NUMERIC(18,4) NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_rate_id BIGINT REFERENCES tax_rates(id),
  line_total  NUMERIC(18,2) NOT NULL,
  cogs_amount NUMERIC(18,2) NOT NULL DEFAULT 0  -- تُملأ عند التأكيد من طبقات التكلفة
);
```

### خطوات تأكيد فاتورة البيع (معاملة واحدة)
1. تحقق من رصيد الصنف في المستودع (بما يسمح بالإعدادات بالسالب أو لا).
2. خصم من طبقات التكلفة (FIFO/WA) واحسب COGS.
3. أنشئ حركة مخزنية + قيد: مدين العميل / دائن المبيعات + ض.ق.م مخرجات؛ قيد COGS: مدين تكلفة المبيعات / دائن المخزون.
4. حد ائتماني: تحذير أو منع حسب الإعداد.
5. أنشئ سجل فاتورة إلكترونية (طابور توقيع/إرسال).

## 6.4 المرتجعات

```sql
CREATE TABLE sales_returns (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL,
  branch_id     BIGINT,
  return_no     VARCHAR(30) NOT NULL,
  customer_id   BIGINT NOT NULL,
  original_invoice_id BIGINT REFERENCES sales_invoices(id),
  return_date   DATE NOT NULL,
  total         NUMERIC(18,2) NOT NULL,
  status        VARCHAR(15) NOT NULL DEFAULT 'DRAFT',
  journal_entry_id BIGINT,
  UNIQUE (company_id, return_no)
);
-- أسطر مشابهة لفاتورة البيع، مع ربط كل سطر بسطر الفاتورة الأصلية
```

- المرتجع يعكس الضريبة عبر إشعار دائن (Credit Note) في الفاتورة الإلكترونية.
- يعيد الكمية للمخزون بالتكلفة الأصلية للصنف (حتى لا يتغير متوسط التكلفة بشكل خاطئ).

## 6.5 التحصيل (سندات القبض)

```sql
CREATE TABLE receipts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL,
  branch_id     BIGINT,
  receipt_no    VARCHAR(30) NOT NULL,
  receipt_date  DATE NOT NULL,
  payer_type    VARCHAR(20) NOT NULL,   -- CUSTOMER, OTHER
  payer_id      BIGINT,
  bank_account_id BIGINT REFERENCES bank_accounts(id),
  cashbox_id    BIGINT REFERENCES cashboxes(id),
  method        VARCHAR(20) NOT NULL,   -- CASH, BANK_TRANSFER, CHECK, CARD
  check_no      VARCHAR(50),
  check_due_date DATE,
  currency      CHAR(3) NOT NULL,
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  amount        NUMERIC(18,2) NOT NULL,
  status        VARCHAR(15) NOT NULL DEFAULT 'DRAFT',
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  UNIQUE (company_id, receipt_no)
);

CREATE TABLE receipt_allocations (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id   BIGINT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  invoice_type VARCHAR(30) NOT NULL,
  invoice_id   BIGINT NOT NULL,
  amount       NUMERIC(18,2) NOT NULL
);
```

- طريقة التحصيل: نقدية، تحويل بنكي، شيك، بطاقة.
- الشيكات الواردة لها حالات: وارد → مودع → محصّل / مرتجع.
- تحصيل بعملة مختلفة → يُحسب فرق عملة محقق ويُرحّل لحساب فروق الصرف.

## 6.6 حد ائتماني

```
رصيد العميل = مجموع فواتيره غير المحصلة − دفعاته المقدمة
عند فاتورة جديدة:
  إن كان (الرصيد + الفاتورة) > حد الائتمان:
     إن كانت السياسة "تحذير": يسمح مع تسجيل تجاوز في التدقيق
     إن كانت السياسة "منع": يرفض الحفظ
السياسة لكل عميل أو لكل شركة (تحذير/منع/تجاهل).
```

## 6.7 التقارير

- كشف حساب عميل مع أعمار الديون.
- تقرير أعمار الذمم المدينة (Aging) — Current / 30 / 60 / 90 / +90.
- المبيعات حسب: العميل، الصنف، المندوب، الفرع، الفترة.
- هامش الربح لكل فاتورة (الإيراد − COGS).
- الفواتير المتأخرة والمحصلة خلال النطاق.
