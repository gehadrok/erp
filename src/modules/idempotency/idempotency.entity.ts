import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Idempotency keys for financial operations (13.3): the same
 * Idempotency-Key must never execute twice; the stored response is
 * replayed within the retention window.
 */
@Entity('idempotency_keys')
@Index(['createdAt'])
export class IdempotencyKey {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  key!: string;

  @Column({ type: 'varchar', length: 60 })
  scope!: string;

  @Column({ type: 'jsonb' })
  response!: Record<string, unknown>;

  @Column({ type: 'int', default: 200 })
  statusCode!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
