# 5. المشتريات والموردون (AP)

## 5.1 الموردون

```sql
CREATE TABLE vendors (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  code          VARCHAR(20) NOT NULL,
  name_ar       VARCHAR(200) NOT NULL,
  tax_number    VARCHAR(50),
  payment_terms_days INT NOT NULL DEFAULT 30,
  gl_account_id BIGINT NOT NULL REFERENCES accounts(id), -- حساب المورد في الذمم الدائنة
  currency      CHAR(3) NOT NULL DEFAULT 'SAR',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);
```

حقول إضافية: عنوان، جهات اتصال، حد ائتماني من المورد (اختياري)، حساب سلف/سحب.

## 5.2 دورة الشراء

```
طلب شراء (اختياري) ─► أمر شراء ─► فاتورة شراء (+ حركة مخزنية) ─► سند صرف
      │                  │              │
      └── اعتماد داخلي   └── مطابقة 3-way: PO ↔ GRN (استلام) ↔ الفاتورة
```

### 3-Way Matching
قبل اعتماد فاتورة الشراء، تُطابق تلقائياً:
1. **أمر الشراء**: الأصناف والكميات والأسعار.
2. **سند الاستلام (GRN)**: الكميات الفعلية المستلمة.
3. **الفاتورة**: الأسعار والضريبة.

فروق صغيرة (حتى 2% أو حد مبلغ) تُقبل بصراحة في الإعداد؛ أكبر منها تتطلب صلاحية خاصة.

## 5.3 فاتورة الشراء

```sql
CREATE TABLE purchase_invoices (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  branch_id     BIGINT REFERENCES branches(id),
  invoice_no    VARCHAR(30) NOT NULL,
  vendor_id     BIGINT NOT NULL REFERENCES vendors(id),
  vendor_invoice_no VARCHAR(50),
  invoice_date  DATE NOT NULL,
  due_date      DATE NOT NULL,
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id),
  currency      CHAR(3) NOT NULL,
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  subtotal      NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total         NUMERIC(18,2) NOT NULL,
  status        VARCHAR(15) NOT NULL DEFAULT 'DRAFT', -- DRAFT, CONFIRMED, PAID, PARTIALLY_PAID, CANCELLED
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  created_by    BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, invoice_no)
);

CREATE TABLE purchase_invoice_lines (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id  BIGINT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  line_no     INT NOT NULL,
  item_id     BIGINT REFERENCES items(id),   -- NULL إذا كان بند خدمة/مصروف
  expense_account_id BIGINT REFERENCES accounts(id), -- للبنود غير المخزنية
  is_expense  BOOLEAN NOT NULL DEFAULT FALSE,
  quantity    NUMERIC(18,3) NOT NULL,
  unit_price  NUMERIC(18,4) NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_rate_id BIGINT REFERENCES tax_rates(id),
  line_total  NUMERIC(18,2) NOT NULL
);
```

### المحاسبة
- عند التأكيد: حركة مخزون إضافة (بالتكلفة الفعلية) + قيد:
  - مدين: المخزون (بالتكلفة) — أو حساب المصروف للبنود غير المخزنية.
  - مدين: ض.ق.م مدخلات.
  - دائن: المورد (بالإجمالي).
- إذا كان المورد بعملة مختلفة، تُحفظ الفاتورة بعملته ويُحسب الفرق عند السداد.

## 5.4 الدفعات (سندات الصرف)

```sql
CREATE TABLE payments (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  branch_id     BIGINT REFERENCES branches(id),
  payment_no    VARCHAR(30) NOT NULL,
  payment_date  DATE NOT NULL,
  payee_type    VARCHAR(20) NOT NULL,   -- VENDOR, EMPLOYEE, OTHER
  payee_id      BIGINT,
  bank_account_id BIGINT REFERENCES bank_accounts(id),
  cashbox_id    BIGINT REFERENCES cashboxes(id),
  method        VARCHAR(20) NOT NULL,   -- CASH, BANK_TRANSFER, CHECK, CARD
  check_no      VARCHAR(50),
  check_due_date DATE,
  currency      CHAR(3) NOT NULL,
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  amount        NUMERIC(18,2) NOT NULL,
  status        VARCHAR(15) NOT NULL DEFAULT 'DRAFT', -- DRAFT, CONFIRMED, CLEARED, CANCELLED
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  UNIQUE (company_id, payment_no)
);

CREATE TABLE payment_allocations (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id   BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_type VARCHAR(30) NOT NULL,   -- PURCHASE_INVOICE, ...
  invoice_id   BIGINT NOT NULL,
  amount       NUMERIC(18,2) NOT NULL
);
```

**قواعد:**
- السداد يوزَّع على فواتير محددة (`payment_allocations`)؛ لا سداد "على الحساب" إلا بقيود على حساب مؤقت ومتابعة يدوية.
- الشيكات الصادرة لها حالة: صادر → مستحق → مصروف/مرتجع.
- سلف الموردين: دفعة مقدمة قبل فاتورة، تُخصم تلقائياً من الفواتير المستقبلية أو يدوياً.

## 5.5 التقارير

- كشف حساب مورد (مع تفاصيل القيود المرتبطة).
- أعمار الديون الدائنة (Current / 30 / 60 / 90 / +90).
- تقرير المشتريات بالصنف والمورد والفترة.
- مقارنة السعر: تطور سعر الشراء للصنف من الموردين المختلفين.
