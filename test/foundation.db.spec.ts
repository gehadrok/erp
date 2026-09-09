import { DataSource } from 'typeorm';
import { startDbHarness, DbHarness } from './db-harness';

let harness: DbHarness;
let admin: DataSource;
let app: DataSource;

beforeAll(async () => {
  harness = await startDbHarness();
  admin = harness.admin;
  app = harness.app;
}, 180_000);

afterAll(async () => {
  await harness?.stop();
});

async function setCompany(ds: DataSource, companyId: string | null): Promise<void> {
  if (companyId === null) {
    await ds.query(`SELECT set_config('app.company_id', '', true)`);
  } else {
    await ds.query(`SELECT set_config('app.company_id', $1, true)`, [companyId]);
  }
}

describe('Phase A: migrations & schema', () => {
  it('migrations are recorded and repeatable on a fresh DB', async () => {
    const rows = await admin.query(`SELECT migration_name FROM migrations ORDER BY id`);
    expect(rows).toHaveLength(1);
    expect(rows[0].migration_name).toBe('ErpFoundation1700000000000');
  });

  it('companies require currency + month checks', async () => {
    await expect(
      admin.query(`INSERT INTO companies (code, name_ar, base_currency, fiscal_year_start)
                   VALUES ('BAD', 'شركة', 'XX', 13)`),
    ).rejects.toThrow();
  });

  it('user_company_roles enforces ALL xor BRANCH consistency', async () => {
    await admin.query(`INSERT INTO companies (code, name_ar) VALUES ('T1', 'x') RETURNING id`);
    const comp = await admin.query(`SELECT id FROM companies WHERE code='T1'`);
    const cid = String(comp[0].id);
    const usr = await admin.query(
      `INSERT INTO users (email, password_hash, name_ar) VALUES ('u1@t.local','x','u') RETURNING id`,
    );
    const rol = await admin.query(
      `INSERT INTO roles (company_id, code, name_ar) VALUES ($1,'R1','r') RETURNING id`,
      [cid],
    );
    // BRANCH scope without branch_id must fail the CHECK
    await expect(
      admin.query(
        `INSERT INTO user_company_roles (user_id, company_id, role_id, branch_scope)
         VALUES ($1, $2, $3, 'BRANCH')`,
        [String(usr[0].id), cid, String(rol[0].id)],
      ),
    ).rejects.toThrow();
  });
});

describe('Phase A: RLS isolation', () => {
  let c1: string;
  let c2: string;

  beforeAll(async () => {
    const r1 = await admin.query(
      `INSERT INTO companies (code, name_ar) VALUES ('RLS1', 'أول') RETURNING id`,
    );
    const r2 = await admin.query(
      `INSERT INTO companies (code, name_ar) VALUES ('RLS2', 'ثان') RETURNING id`,
    );
    c1 = String(r1[0].id);
    c2 = String(r2[0].id);
    await admin.query(
      `INSERT INTO branches (company_id, code, name_ar) VALUES ($1,'B1','فرع أول')`, [c1],
    );
    await admin.query(
      `INSERT INTO branches (company_id, code, name_ar) VALUES ($1,'B2','فرع ثان')`, [c2],
    );
  });

  it('erp_app sees only its own company rows', async () => {
    await setCompany(app, c1);
    const visible = await app.query(`SELECT code FROM branches ORDER BY code`);
    expect(visible).toHaveLength(1);
    expect(visible[0].code).toBe('B1');
  });

  it('switching company context switches visibility', async () => {
    await setCompany(app, c2);
    const visible = await app.query(`SELECT code FROM branches ORDER BY code`);
    expect(visible).toHaveLength(1);
    expect(visible[0].code).toBe('B2');
  });

  it('no company context => no rows, and inserts are rejected', async () => {
    await setCompany(app, null);
    const visible = await app.query(`SELECT code FROM branches`);
    expect(visible).toHaveLength(0);

    await expect(
      app.query(`INSERT INTO branches (company_id, code, name_ar) VALUES ($1,'BX','x')`, [c1]),
    ).rejects.toThrow();
  });

  it('cross-tenant update is a no-op under RLS', async () => {
    await setCompany(app, c1);
    const res = await app.query(`UPDATE branches SET address='hacked' WHERE code='B2' RETURNING id`);
    expect(res).toHaveLength(0);
  });
});

describe('Phase A: grants enforce the documented security model', () => {
  it('erp_app cannot DELETE audit rows', async () => {
    const comp = await admin.query(`SELECT id FROM companies WHERE code='RLS1'`);
    const cid = String(comp[0].id);
    const usr = await admin.query(
      `INSERT INTO users (email, password_hash, name_ar) VALUES ('aud@t.local','x','a') RETURNING id`,
    );
    await setCompany(app, cid);
    await app.query(
      `INSERT INTO audit_log (user_id, company_id, action, entity, entity_id)
       VALUES ($1, $2, 'CREATE', 'companies', $2)`,
      [String(usr[0].id), cid],
    );
    await expect(app.query(`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/i);
  });

  it('erp_app cannot DDL', async () => {
    await expect(app.query(`CREATE TABLE sneaky (id int)`)).rejects.toThrow(/permission denied/i);
  });
});

describe('Phase A: sequences & idempotency', () => {
  it('sequence numbers never collide under the COALESCE unique index', async () => {
    const comp = await admin.query(`SELECT id FROM companies WHERE code='RLS1'`);
    const cid = String(comp[0].id);
    await admin.query(
      `INSERT INTO sequences (company_id, doc_type, branch_id, prefix)
       VALUES ($1, 'JOURNAL', NULL, 'JV-')`, [cid],
    );
    await expect(
      admin.query(
        `INSERT INTO sequences (company_id, doc_type, branch_id, prefix)
         VALUES ($1, 'JOURNAL', NULL, 'JV-')`,
        [cid],
      ),
    ).rejects.toThrow();
  });

  it('idempotency keys are unique per scope', async () => {
    const comp = await admin.query(`SELECT id FROM companies WHERE code='RLS1'`);
    const cid = String(comp[0].id);
    await setCompany(app, cid);
    await app.query(
      `INSERT INTO idempotency_keys (key, scope, response) VALUES ('k1','gl.entry.post','{"ok":true}')`,
    );
    await expect(
      app.query(
        `INSERT INTO idempotency_keys (key, scope, response) VALUES ('k1','gl.entry.post','{"ok":true}')`,
      ),
    ).rejects.toThrow();
  });
});
