import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { DataSource } from 'typeorm';
import * as entities from '../src/modules';
import { ErpFoundation1700000000000 } from '../src/database/migrations/1700000000000-ErpFoundation';

export interface DbHarness {
  admin: DataSource;
  migrator: DataSource;
  app: DataSource;
  stop(): Promise<void>;
}

/**
 * Boots a throwaway PostgreSQL 16, creates the documented DB roles,
 * runs the real migrations, then returns three connections:
 *  - admin:    superuser (bootstrap only)
 *  - migrator: DDL role (erp_migrator)
 *  - app:      runtime DML role (erp_app) — RLS applies
 */
export async function startDbHarness(): Promise<DbHarness> {
  const container: StartedTestContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_DB: 'erp',
      POSTGRES_USER: 'erp_owner',
      POSTGRES_PASSWORD: 'erp_owner_pw',
    })
    .withExposedPorts(5432)
    .start();

  const adminUrl = `postgres://erp_owner:erp_owner_pw@${container.getHost()}:${container.getMappedPort(5432)}/erp`;
  const admin = new DataSource({ type: 'postgres', url: adminUrl, logging: false });
  await admin.initialize();

  await admin.query(`CREATE ROLE erp_migrator LOGIN PASSWORD 'erp_migrator_pw'`);
  await admin.query(`CREATE ROLE erp_app LOGIN PASSWORD 'erp_app_pw'`);
  await admin.query(`CREATE ROLE erp_readonly LOGIN PASSWORD 'erp_readonly_pw'`);
  await admin.query(`GRANT erp_app, erp_readonly TO erp_migrator`);

  const migrator = new DataSource({
    type: 'postgres',
    url: adminUrl.replace(/\/\/[^@]*@/, '//erp_migrator:erp_migrator_pw@'),
    entities: Object.values(entities),
    migrations: [ErpFoundation1700000000000],
    logging: false,
  });
  await migrator.initialize();
  await migrator.runMigrations({ transaction: 'each' });

  const app = new DataSource({
    type: 'postgres',
    url: adminUrl.replace(/\/\/[^@]*@/, '//erp_app:erp_app_pw@'),
    entities: Object.values(entities),
    logging: false,
  });
  await app.initialize();

  return {
    admin,
    migrator,
    app,
    stop: async () => {
      await app.destroy().catch(() => undefined);
      await migrator.destroy().catch(() => undefined);
      await admin.destroy().catch(() => undefined);
      await container.stop().catch(() => undefined);
    },
  };
}
