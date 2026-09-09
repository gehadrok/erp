import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Append-only audit log (12.4). UPDATE/DELETE are revoked at the DB role level
 * and the table is write-only for erp_app.
 */
@Entity('audit_log')
@Index(['entity', 'entityId', 'occurredAt'])
@Index(['companyId', 'occurredAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt!: Date;

  @Column({ type: 'bigint' })
  userId!: string;

  @Column({ type: 'bigint', nullable: true })
  companyId?: string | null;

  @Column({ type: 'varchar', length: 20 })
  action!: string;

  @Column({ type: 'varchar', length: 60 })
  entity!: string;

  @Column({ type: 'text', nullable: true })
  entityId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldValues?: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  newValues?: Record<string, unknown> | null;

  @Column({ type: 'inet', nullable: true })
  ip?: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent?: string | null;
}
