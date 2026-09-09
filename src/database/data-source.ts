import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as entities from '../modules';
import { ErpFoundation1700000000000 } from './migrations/1700000000000-ErpFoundation';

/**
 * Data source used by the TypeORM CLI for running migrations (DDL owner = erp_migrator).
 * Runtime (API) uses the separate connection factory in connection.factory.ts.
 */
export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ??
    'postgres://erp_migrator:erp_migrator_pw@localhost:5433/erp',
  entities: Object.values(entities),
  migrations: [ErpFoundation1700000000000],
  migrationsTransactionMode: 'each',
  logging: false,
});
