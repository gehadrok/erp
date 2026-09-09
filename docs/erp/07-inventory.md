# 7. المخازن والمخزون

## 7.1 الأصناف والمستودعات

```sql
CREATE TABLE item_categories (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  name_ar    VARCHAR(200) NOT NULL,
  parent_id  BIGINT REFERENCES item_categories(id)
);

CREATE TABLE units (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  code       VARCHAR(20) NOT NULL,       -- PCS, KG, BOX
  name_ar    VARCHAR(50) NOT NULL,
  UNIQUE (company_id, code)
);

CREATE TABLE item_units (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id     BIGINT NOT NULL REFERENCES items(id),
  unit_id     BIGINT NOT NULL REFERENCES units(id),
  factor      NUMERIC(18,6) NOT NULL,    -- 1 وحدة هذه = factor من الوحدة الأساسية
  is_base     BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (item_id, unit_id)
);

CREATE TABLE items (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  code          VARCHAR(40) NOT NULL,
  barcode       VARCHAR(50),
  name_ar       VARCHAR(200) NOT NULL,
  category_id   BIGINT REFERENCES item_categories(id),
  base_unit_id  BIGINT NOT NULL REFERENCES units(id),
  item_type     VARCHAR(15) NOT NULL DEFAULT 'STOCK', -- STOCK, SERVICE, FIXED_ASSET
  cost_method   VARCHAR(10) NOT NULL DEFAULT 'WA',    -- WA (متوسط مرجح) أو FIFO
  min_level     NUMERIC(18,3) NOT NULL DEFAULT 0,
  max_level     NUMERIC(18,3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(18,3) NOT NULL DEFAULT 0,
  default_tax_rate_id BIGINT REFERENCES tax_rates(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);

CREATE TABLE warehouses (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id),
  branch_id  BIGINT REFERENCES branches(id),
  code       VARCHAR(20) NOT NULL,
  name_ar    VARCHAR(200) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (company_id, code)
);
```

## 7.2 الحركات المخزنية

```sql
CREATE TABLE inventory_moves (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL,
  branch_id     BIGINT,
  move_no       VARCHAR(30) NOT NULL,
  move_date     DATE NOT NULL,
  move_type     VARCHAR(20) NOT NULL,
  -- IN (إضافة), OUT (صرف), TRANSFER (تحويل), ADJUSTMENT (تسوية جرد)
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id BIGINT REFERENCES warehouses(id), -- للتحويل
  source_doc    VARCHAR(40),             -- purchase_invoices, sales_invoices, ...
  source_id     BIGINT,
  status        VARCHAR(15) NOT NULL DEFAULT 'CONFIRMED',
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  UNIQUE (company_id, move_no)
);

CREATE TABLE inventory_move_lines (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  move_id     BIGINT NOT NULL REFERENCES inventory_moves(id) ON DELETE CASCADE,
  item_id     BIGINT NOT NULL REFERENCES items(id),
  unit_id     BIGINT NOT NULL REFERENCES units(id),
  quantity    NUMERIC(18,3) NOT NULL,    -- موجب دائماً؛ الاتجاه يحدده move_type
  unit_cost   NUMERIC(18,4) NOT NULL DEFAULT 0,
  line_cost   NUMERIC(18,2) NOT NULL DEFAULT 0
);

-- أرصدة لحظية (تُحدّث في نفس معاملة الحركة)
CREATE TABLE stock_balances (
  company_id   BIGINT NOT NULL,
  item_id      BIGINT NOT NULL REFERENCES items(id),
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  quantity     NUMERIC(18,3) NOT NULL DEFAULT 0,
  avg_cost     NUMERIC(18,4) NOT NULL DEFAULT 0,  -- للصنف بأسلوب WA
  PRIMARY KEY (item_id, warehouse_id)
);

-- طبقات التكلفة (لـ FIFO ولحساب COGS بدقة)
CREATE TABLE stock_cost_layers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   BIGINT NOT NULL,
  item_id      BIGINT NOT NULL,
  warehouse_id BIGINT NOT NULL,
  in_date      DATE NOT NULL,
  qty_in       NUMERIC(18,3) NOT NULL,
  qty_remaining NUMERIC(18,3) NOT NULL,
  unit_cost    NUMERIC(18,4) NOT NULL,
  source_doc   VARCHAR(40),
  source_id    BIGINT
);
CREATE INDEX idx_layers_item ON stock_cost_layers (item_id, warehouse_id, in_date);
```

## 7.3 طرق التكلفة

### متوسط مرجح (WA) — الافتراضي
```
متوسط جديد = (كمية قديمة × متوسط قديم + كمية واردة × تكلفة واردة) / (كمية قديمة + كمية واردة)
كل صرف = الكمية × المتوسط الحالي
```
- بسيط وثابت. تحديث المتوسط عند كل إضافة فقط؛ الصرف لا يغيّر المتوسط.

### FIFO
- الصرف يستهلك أقدم طبقة أولاً من `stock_cost_layers`.
- COGS الدقيق لكل فاتورة = مجموع (كمية × تكلفة الطبقة المستهلكة).
- أكثر دقة؛ تحتاج فحص الطبقات عند كل صرف (فهرس مناسب يجعله سريعاً).

**قاعدة:** طريقة التكلفة لكل صنف ولا تتغير إلا بنهاية سنة مالية بعد تسوية.

## 7.4 التحويل بين المستودعات

- مستند واحد نوعه `TRANSFER` بأسطر `from → to`.
- داخل نفس المعاملة: خصم من `from` (عند متوسطه/طبقاته) + إضافة إلى `to`.
- نقل بين مستودعين بتكلفة متوسط مختلفة: يُعاد تقييم `avg_cost` في المستودع المستقبل وفق الكمية والتكلفة الواردة (أو يُثبّت تكلفة النقل بسياسة الشركة).

## 7.5 الجرد وتسوية الفروق

1. **أمر جرد**: تجميد الحركات على المستودع (اختياري) + توليد ورقة جرد بالأرصدة الدفترية.
2. **إدخال الجرد الفعلي** (جهاز جمع بيانات/باركود أو يدوياً).
3. **مقارنة تلقائية**: دفتري مقابل فعلي → فرق.
4. **اعتماد تسوية**: حركة `ADJUSTMENT` تضبط الرصيد:
   - زيادة: إضافة طبقة بتكلفة المتوسط الحالي.
   - نقص: صرف بالمتوسط الحالي على حساب "عجز وتسويات مخزون".
5. قيد محاسبي: مدين عجز مخزون (مصروف) / دائن المخزون — والعكس للزيادة.

## 7.6 حدود ومؤشرات

- تنبيه عند النزول تحت `reorder_level`.
- تقرير حركة صنف (بطاقة صنف) بكل الحركات والتكلفة والرصيد التراكمي.
- تقرير أصناف راكدة (لا حركة خلال N يوماً).
- تقييم المخزون الحالي (الكمية × المتوسط).
