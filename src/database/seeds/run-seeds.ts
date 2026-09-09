import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * Reference-data seeds. Safe to re-run (idempotent upserts).
 * Seeds are NOT migrations: production stays schema-only.
 */
const CURRENCIES: Array<[string, string, string | null, number]> = [
  ['SAR', 'ريال سعودي', 'ر.س', 2],
  ['USD', 'دولار أمريكي', '$', 2],
  ['EUR', 'يورو', '€', 2],
  ['AED', 'درهم إماراتي', 'د.إ', 2],
  ['EGP', 'جنيه مصري', 'ج.م', 2],
];

const PERMISSIONS: string[] = [
  // core / settings
  'core.company.manage',
  'core.branch.manage',
  'core.user.manage',
  'core.role.manage',
  'core.sequence.manage',
  // gl
  'gl.account.manage',
  'gl.entry.create',
  'gl.entry.approve',
  'gl.entry.post',
  'gl.entry.reverse',
  'gl.period.close',
  'gl.period.reopen',
  'gl.report.view',
  // modules (reserved for later phases)
  'inventory.item.manage',
  'inventory.move.confirm',
  'purchasing.invoice.confirm',
  'sales.invoice.confirm',
  'cash.receipt.create',
  'cash.payment.create',
  'payroll.run.approve',
  'assets.run.approve',
  'reports.payroll.view',
  'audit.log.view',
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgres://erp_migrator:erp_migrator_pw@localhost:5433/erp';
  const ds = new DataSource({ type: 'postgres', url, logging: false });
  await ds.initialize();

  const qr = ds.createQueryRunner();
  try {
    await qr.startTransaction();
    try {
      for (const [code, nameAr, symbol, decimals] of CURRENCIES) {
        await qr.query(
          `INSERT INTO currencies (code, name_ar, symbol, decimal_places)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar, symbol = EXCLUDED.symbol`,
          [code, nameAr, symbol, decimals],
        );
      }

      for (const code of PERMISSIONS) {
        await qr.query(
          `INSERT INTO permissions (code) VALUES ($1) ON CONFLICT (code) DO NOTHING`,
          [code],
        );
      }

      // Demo company + admin role for development only.
      if ((process.env.SEED_DEMO_DATA ?? 'true') !== 'false') {
        const companyRes = await qr.query(
          `INSERT INTO companies (code, name_ar, name_en, base_currency)
           VALUES ('MAIN', 'شركة رئيسية', 'Main Company', 'SAR')
           ON CONFLICT (code) DO UPDATE SET name_ar = EXCLUDED.name_ar
           RETURNING id`,
          [],
        );
        const companyId = String(companyRes[0].id);
        await qr.query(
          `INSERT INTO branches (company_id, code, name_ar)
           SELECT $1, 'HQ', 'الفرع الرئيسي'
           WHERE NOT EXISTS (SELECT 1 FROM branches WHERE company_id = $1 AND code = 'HQ')`,
          [companyId],
        );
        await qr.query(
          `INSERT INTO roles (company_id, code, name_ar)
           SELECT $1, 'ADMIN', 'مدير النظام'
           WHERE NOT EXISTS (SELECT 1 FROM roles WHERE company_id = $1 AND code = 'ADMIN')`,
          [companyId],
        );
        await qr.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
           WHERE r.company_id::text = $1 AND r.code = 'ADMIN'
           ON CONFLICT (role_id, permission_id) DO NOTHING`,
          [companyId],
        );
      }

      await qr.commitTransaction();
    } catch (e) {
      await qr.rollbackTransaction();
      throw e;
    }
  } finally {
    await qr.release();
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
