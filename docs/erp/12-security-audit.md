# 12. الأمان، التدقيق، تعدد الشركات

## 12.1 المصادقة والجلسات

- تسجيل دخول بالبريد/الاسم + كلمة مرور (argon2id) + تحقق بخطوة ثانية (TOTP) اختياري لكن موصى به لمديري النظام.
- الجلسات: رموز قصيرة العمر (access 15 د) + refresh مخزن آمن (HttpOnly cookie) — أو جلسات Redis قابلة للإبطال فوراً.
- إبطال فوري عند تسجيل الخروج أو تغيير الصلاحيات.
- حماية من التخمين: قفل مؤقت بعد 5 محاولات فاشلة + سجل محاولات الدخول.

## 12.2 الصلاحيات (RBAC + نطاق)

```sql
CREATE TABLE roles (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id BIGINT REFERENCES companies(id),  -- NULL = دور عام
  code       VARCHAR(30) NOT NULL,
  name_ar    VARCHAR(100) NOT NULL
);

CREATE TABLE permissions (
  id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code  VARCHAR(60) NOT NULL UNIQUE   -- sales.invoice.confirm, gl.entry.post, reports.payroll.view
);

CREATE TABLE role_permissions (
  role_id       BIGINT NOT NULL REFERENCES roles(id),
  permission_id BIGINT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         VARCHAR(200) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name_ar       VARCHAR(200) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  totp_secret   TEXT
);

CREATE TABLE user_company_roles (
  user_id    BIGINT NOT NULL REFERENCES users(id),
  company_id BIGINT NOT NULL REFERENCES companies(id),
  role_id    BIGINT NOT NULL REFERENCES roles(id),
  branch_scope VARCHAR(10) NOT NULL DEFAULT 'ALL', -- ALL أو فرع محدد
  PRIMARY KEY (user_id, company_id, role_id)
);
```

**نموذج الفحص في كل طلب:**
```
هل المستخدم نشط؟
  → هل له دور في هذه الشركة؟ (عزل الشركات)
    → هل يملك الصلاحية المطلوبة؟ (مثلاً gl.entry.post)
      → هل النطاق يشمل الفرع المطلوب؟
        → هل الفترة المالية مفتوحة والقيد في الحالة الصحيحة؟
```

صلاحيات حساسة تُفرض على مستوى الخدمة وليس الواجهة فقط: `post`، `reverse`، `close_period`، `reopen_period`، `delete` (المحدود جداً)، `payroll.view`.

## 12.3 تعدد الشركات والفروع

- **عزل على مستوى الصف**: كل جدول أعمال يحمل `company_id`، وكل استعلام يُمرر تلقائياً عبر طبقة Repository فرضية:
  - الشركة الحالية تُستخرج من الجلسة (لا من معامل الطلب) — منع أي تمرير يدوي مشبوه.
  - اختبارات آلية تتأكد أن أي استعلام بلا فلتر شركة يفشل.
- **الفروع**: فلتر اختياري؛ بعض التقارير تجمع الفروع والبعض يعزلها.
- **التبديل بين الشركات**: من الواجهة، ويغير `company_id` في الجلسة مع تسجيل ذلك.

## 12.4 سجل التدقيق

- كل كتابة على جداول حساسة (قيود، فواتير، مسير، صلاحيات) تُسجل: من، متى، ماذا (قبل/بعد JSONB)، من أي IP.
- التسجيل داخل نفس معاملة الكتابة (لن يضيع حدث).
- سجل التدقيق **للقراءة فقط**: لا تعديل ولا حذف من أي مستخدم بما فيهم DBA (سياسة + مراقبة).
- شاشة تدقيق لكل مستند: من أنشأ، اعتمد، رحّل، عكس — خط زمني.

## 12.5 حماية البيانات

- TLS 1.2+ لكل الاتصالات، HSTS.
- تشفير الحقول شديدة الحساسية (أسرار تكامل، شهادات) بمفتاح من KMS/Secret manager.
- نسخ احتياطي: يومي كامل + WAL مستمر، تشفير النسخ، اختبار استعادة ربع سنوي موثق.
- سياسة احتفاظ: البيانات المالية 10 سنوات؛ سجل الدخول سنتان.

## 12.6 مراقبة التشغيل

- سجلات مركزية (structured JSON) + تجميع (Loki/ELK).
- مقاييس: زمن استجابة الترحيل، طول طابور الفواتير الإلكترونية، نسبة فشل الإرسال، حجم قاعدة البيانات.
- تنبيهات: فشل إرسال فواتير > 5 متتالية، قائمة انتظار متضخمة، فشل النسخ الاحتياطي، محاولات دخول فاشلة متكررة.
