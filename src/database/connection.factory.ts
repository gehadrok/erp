import 'reflect-metadata';
import 'dotenv/config';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

export const APP_DATA_SOURCE = 'APP_DATA_SOURCE';

/**
 * Tenant context for a single database transaction.
 * All runtime queries run under RLS with app.company_id set via SET LOCAL.
 */
export interface CompanyContext {
  companyId: number;
  userId: number;
}

/**
 * Runtime data source (erp_app role). Every repository obtained through
 * CompanyScopedRepo is transaction-bound and RLS-guarded.
 */
@Injectable()
export class RuntimeDatabaseService implements OnModuleInit, OnModuleDestroy {
  private ds: DataSource | null = null;

  constructor(@Inject(APP_DATA_SOURCE) private readonly options: { url: string }) {}

  async onModuleInit(): Promise<void> {
    this.ds = new DataSource({
      type: 'postgres',
      url: this.options.url,
      entities: [],
      synchronize: false,
      logging: false,
    });
    await this.ds.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    await this.ds?.destroy();
  }

  get dataSource(): DataSource {
    if (!this.ds) throw new Error('Runtime database not initialized');
    return this.ds;
  }

  /**
   * Runs fn inside ONE transaction with the company context applied via
   * SET LOCAL app.company_id / app.user_id (rows are then filtered by RLS).
   */
  async withCompany<T>(ctx: CompanyContext, fn: (em: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.company_id', $1, true)`, [String(ctx.companyId)]);
      await em.query(`SELECT set_config('app.user_id', $1, true)`, [String(ctx.userId)]);
      return fn(em);
    });
  }

  /** Company-scoped repository bound to an entity manager inside a transaction. */
  repo<T extends ObjectLiteral>(em: EntityManager, target: EntityTarget<T>) {
    return em.getRepository(target);
  }
}
