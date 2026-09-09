# 8. الأصول الثابتة

## 8.1 المفهوم

كل أصل ثابت = سجل أصلي (تكلفة الشراء، تاريخ الشراء، العمر الإنتاجي، طريقة الإهلاك) + حساب GL خاص به أو حساب جماعي مع كروت أصول، + مجمع إهلاك حسابي مقابله.

## 8.2 المخطط

```sql
CREATE TABLE fixed_asset_categories (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     BIGINT NOT NULL REFERENCES companies(id),
  name_ar        VARCHAR(200) NOT NULL,
  gl_asset_account_id   BIGINT NOT NULL REFERENCES accounts(id),  -- تكلفة الأصل
  gl_depreciation_account_id BIGINT NOT NULL REFERENCES accounts(id), -- مصروف الإهلاك
  gl_accum_dep_account_id    BIGINT NOT NULL REFERENCES accounts(id), -- مجمع الإهلاك
  default_useful_life_months INT NOT NULL DEFAULT 60,
  default_method VARCHAR(15) NOT NULL DEFAULT 'SLM'  -- SLM: قسط ثابت
);

CREATE TABLE fixed_assets (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     BIGINT NOT NULL REFERENCES companies(id),
  code           VARCHAR(30) NOT NULL,
  name_ar        VARCHAR(200) NOT NULL,
  category_id    BIGINT NOT NULL REFERENCES fixed_asset_categories(id),
  branch_id      BIGINT REFERENCES branches(id),
  acquisition_date DATE NOT NULL,
  acquisition_cost NUMERIC(18,2) NOT NULL,
  salvage_value  NUMERIC(18,2) NOT NULL DEFAULT 0,
  useful_life_months INT NOT NULL,
  method         VARCHAR(15) NOT NULL DEFAULT 'SLM',
  -- SLM قسط ثابت، DDB قسط متناقص مزدوج، UNITS وحدات إنتاج
  status         VARCHAR(15) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, FULLY_DEPRECIATED, DISPOSED, SOLD
  accumulated_depreciation NUMERIC(18,2) NOT NULL DEFAULT 0,
  gl_account_id  BIGINT REFERENCES accounts(id),  -- حساب الأصل (إن كان حساب خاصاً لكل أصل)
  UNIQUE (company_id, code)
);

CREATE TABLE asset_depreciation_runs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL,
  period_code VARCHAR(7) NOT NULL,   -- '2026-09'
  status      VARCHAR(15) NOT NULL DEFAULT 'DRAFT', -- DRAFT, POSTED
  journal_entry_id BIGINT REFERENCES journal_entries(id),
  total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  UNIQUE (company_id, period_code)
);

CREATE TABLE asset_depreciation_lines (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id    BIGINT NOT NULL REFERENCES asset_depreciation_runs(id) ON DELETE CASCADE,
  asset_id  BIGINT NOT NULL REFERENCES fixed_assets(id),
  amount    NUMERIC(18,2) NOT NULL,
  accumulated_after NUMERIC(18,2) NOT NULL
);
```

## 8.3 طرق الإهلاك

| الطريقة | الحساب الشهري |
|---------|----------------|
| SLM (قسط ثابت) | (التكلفة − الخردة) ÷ العمر بالأشهر |
| DDB (متناقص مزدوج) | القيمة الدفترية × (2 ÷ العمر بالسنوات) ÷ 12، مع تحويل لقسط ثابت في السنة الأخيرة |
| UNITS (إنتاج) | (التكلفة − الخردة) × (إنتاج الفترة ÷ إجمالي الإنتاج المقدر) |

**القاعدة:** الإهلاك يبدأ من الشهر التالي للاستخدام (سياسة قابلة للتهيئة) ويتوقف عند الوصول للقيمة الخردة.

## 8.4 دورة الإهلاك الشهرية

1. مهمة مجدولة أول كل شهر (أو يدوياً) تنشئ `asset_depreciation_runs` للفترة.
2. لكل أصل نشط: احسب قسط الفترة + حد أقصى حتى مجمع الإهلاك = التكلفة − الخردة.
3. اعرض المعاينة → اعتماد → قيد واحد مجمّع:
   - مدين: مصروف الإهلاك (حسب فئات/فروع)
   - دائن: مجمع الإهلاك
4. تحديث `accumulated_depreciation` لكل أصل داخل نفس المعاملة.

## 8.5 التصرف في الأصل (بيع/إتلاف/كتابة)

```
عند التصرف:
  1) أوقف الإهلاك من تاريخ التصرف
  2) قيد:
     مدين: النقدية/البنك (سعر البيع) إن وُجد
     مدين: مجمع الإهلاك (رصيده)
     مدين: خسارة بيع أصل (إن كانت الخسارة)
     دائن: تكلفة الأصل
     دائن: ض.ق.م مخرجات (إن كان بيعاً خاضعاً)
     دائن: ربح بيع أصل (إن كان ربحاً)
  3) status = SOLD أو DISPOSED
```

## 8.6 إعادة التقييم والجرد

- إعادة تقييم (اختياري): قيد يعدّل التكلفة وفق تقييم مكتتب، مع تتبع الفائض/العجز في حسابات حقوق ملكية.
- جرد الأصول: قائمة أصول لكل فرع/مسؤول مع رمز باركود لكل أصل، وتسجيل نتيجة التحقق الميداني.

## 8.7 التقارير

- كروت أصول: التكلفة، الإهلاك التراكمي، القيمة الدفترية.
- جدول الإهلاك المستقبلي (خطة الإهلاك).
- حركة إضافة/تصرف خلال الفترة (مطابقة لما يتطلبه المراجعون).
- توزيع مصروف الإهلاك على الفروع ومراكز التكلفة.
