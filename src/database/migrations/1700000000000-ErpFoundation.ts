import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase A — database foundation.
 * Creates core tenancy tables (companies, branches, currencies, exchange rates,
 * sequences), identity/authorization (users, roles, permissions, assignments),
 * the append-only audit log, idempotency keys, row-level security policies and
 * DB role grants per docs/erp/02, 03 and 12.
 */
export class ErpFoundation1700000000000 implements MigrationInterface {
  name = 'ErpFoundation1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================ core tenancy ============================
    await queryRunner.query(`
      CREATE TABLE companies (
        id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code                  VARCHAR(10) NOT NULL UNIQUE,
        name_ar               VARCHAR(200) NOT NULL,
        name_en               VARCHAR(200),
        tax_number            VARCHAR(50),
        base_currency         CHAR(3) NOT NULL DEFAULT 'SAR',
        fiscal_year_start     INT NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),
        is_active             BOOLEAN NOT NULL DEFAULT TRUE,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE branches (
        id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id  BIGINT NOT NULL REFERENCES companies(id),
        code        VARCHAR(10) NOT NULL,
        name_ar     VARCHAR(200) NOT NULL,
        address     TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE (company_id, code)
      )`);

    await queryRunner.query(`
      CREATE TABLE currencies (
        code            CHAR(3) PRIMARY KEY,
        name_ar         VARCHAR(50) NOT NULL,
        symbol          VARCHAR(10),
        decimal_places  INT NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4)
      )`);

    await queryRunner.query(`
      CREATE TABLE exchange_rates (
        id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id  BIGINT NOT NULL REFERENCES companies(id),
        currency    CHAR(3) NOT NULL REFERENCES currencies(code),
        rate_date   DATE NOT NULL,
        rate        NUMERIC(18,8) NOT NULL CHECK (rate > 0),
        UNIQUE (company_id, currency, rate_date)
      )`);

    await queryRunner.query(`
      CREATE TABLE sequences (
        id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id  BIGINT NOT NULL REFERENCES companies(id),
        doc_type    VARCHAR(30) NOT NULL,
        branch_id   BIGINT REFERENCES branches(id),
        prefix      VARCHAR(20) NOT NULL DEFAULT '',
        next_no     BIGINT NOT NULL DEFAULT 1,
        padding     INT NOT NULL DEFAULT 5
      )`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_sequences_scope
      ON sequences (company_id, doc_type, COALESCE(branch_id, 0))`);

    // ============================ identity / authz ============================
    await queryRunner.query(`
      CREATE TABLE users (
        id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        email          VARCHAR(200) NOT NULL UNIQUE,
        password_hash  TEXT NOT NULL,
        name_ar        VARCHAR(200) NOT NULL,
        is_active      BOOLEAN NOT NULL DEFAULT TRUE,
        totp_secret    TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`
      CREATE TABLE roles (
        id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        company_id  BIGINT REFERENCES companies(id), -- NULL = global role
        code        VARCHAR(30) NOT NULL,
        name_ar     VARCHAR(100) NOT NULL,
        UNIQUE (company_id, code)
      )`);

    await queryRunner.query(`
      CREATE TABLE permissions (
        id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code  VARCHAR(60) NOT NULL UNIQUE
      )`);

    await queryRunner.query(`
      CREATE TABLE role_permissions (
        id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        role_id        BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id  BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        UNIQUE (role_id, permission_id)
      )`);

    await queryRunner.query(`
      CREATE TABLE user_company_roles (
        id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id    BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role_id       BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        branch_scope  VARCHAR(10) NOT NULL DEFAULT 'ALL' CHECK (branch_scope IN ('ALL','BRANCH')),
        branch_id     BIGINT REFERENCES branches(id),
        CHECK ((branch_scope = 'ALL') = (branch_id IS NULL)),
        UNIQUE (user_id, company_id, role_id)
      )`);

    // ============================ audit + idempotency ============================
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_id      BIGINT NOT NULL REFERENCES users(id),
        company_id   BIGINT,
        action       VARCHAR(20) NOT NULL,
        entity       VARCHAR(60) NOT NULL,
        entity_id    TEXT,
        old_values   JSONB,
        new_values   JSONB,
        ip           INET,
        user_agent   TEXT
      )`);

    await queryRunner.query(`CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id, occurred_at)`);
    await queryRunner.query(`CREATE INDEX idx_audit_company_date ON audit_log (company_id, occurred_at)`);

    await queryRunner.query(`
      CREATE TABLE idempotency_keys (
        id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        key         VARCHAR(120) NOT NULL,
        scope       VARCHAR(60) NOT NULL,
        response    JSONB NOT NULL,
        status_code INT NOT NULL DEFAULT 200,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (scope, key)
      )`);

    // ============================ RLS ============================
    // erp_app is subject to row-level security; company context comes from
    // set_config('app.company_id', ...) inside each transaction (12.3).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION app_company_id() RETURNS BIGINT
      LANGUAGE plpgsql STABLE AS $$
      DECLARE v BIGINT;
      BEGIN
        BEGIN
          v := NULLIF(current_setting('app.company_id', true), '')::BIGINT;
        EXCEPTION WHEN OTHERS THEN v := NULL; END;
        RETURN v;
      END $$`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION rls_company_isolation() RETURNS BOOLEAN
      LANGUAGE plpgsql STABLE AS $$
      BEGIN
        RETURN app_company_id() IS NOT NULL
           AND company_id::TEXT = app_company_id()::TEXT;
      END $$`);

    const rlsTables = ['branches', 'exchange_rates', 'sequences', 'idempotency_keys'];
    for (const t of rlsTables) {
      await queryRunner.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      await queryRunner.query(`
        CREATE POLICY company_isolation ON ${t}
        USING (rls_company_isolation())
        WITH CHECK (rls_company_isolation())`);
    }

    // ============================ grants ============================
    // erp_migrator owns everything (runs as the DB owner via membership).
    // erp_app: DML on business tables, SELECT on currencies, no DDL.
    // erp_readonly: SELECT on everything except audit internals.
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO erp_app, erp_readonly`);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        companies, branches, currencies, exchange_rates, sequences,
        users, roles, permissions, role_permissions, user_company_roles,
        idempotency_keys
      TO erp_app`);
    await queryRunner.query(`
      GRANT SELECT, INSERT ON audit_log TO erp_app`);
    await queryRunner.query(`
      GRANT SELECT ON companies, branches, currencies, exchange_rates, sequences,
        users, roles, permissions, role_permissions, user_company_roles, audit_log,
        idempotency_keys
      TO erp_readonly`);
    await queryRunner.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order.
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_keys`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_log`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_company_roles`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS roles`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
    await queryRunner.query(`DROP TABLE IF EXISTS sequences`);
    await queryRunner.query(`DROP TABLE IF EXISTS exchange_rates`);
    await queryRunner.query(`DROP TABLE IF EXISTS currencies`);
    await queryRunner.query(`DROP TABLE IF EXISTS branches`);
    await queryRunner.query(`DROP TABLE IF EXISTS companies`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS rls_company_isolation`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS app_company_id`);
  }
}
