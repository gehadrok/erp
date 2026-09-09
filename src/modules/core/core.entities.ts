import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 10, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  nameAr!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  nameEn?: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  taxNumber?: string | null;

  @Column({ type: 'char', length: 3, default: 'SAR' })
  baseCurrency!: string;

  @Column({ type: 'int', default: 1 })
  fiscalYearStartMonth!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

@Entity('branches')
@Unique(['companyId', 'code'])
export class Branch {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  companyId!: string;

  @Column({ type: 'varchar', length: 10 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  nameAr!: string;

  @Column({ type: 'text', nullable: true })
  address?: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}

@Entity('currencies')
export class Currency {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'char', length: 3, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 50 })
  nameAr!: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  symbol?: string | null;

  @Column({ type: 'int', default: 2 })
  decimalPlaces!: number;
}

@Entity('exchange_rates')
@Unique(['companyId', 'currency', 'rateDate'])
@Index(['companyId', 'currency', 'rateDate'])
export class ExchangeRate {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  companyId!: string;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({ type: 'date' })
  rateDate!: string;

  @Column({ type: 'numeric', precision: 18, scale: 8 })
  rate!: string;
}

@Entity('sequences')
@Unique(['companyId', 'docType', 'branchId'])
export class Sequence {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  companyId!: string;

  @Column({ type: 'varchar', length: 30 })
  docType!: string;

  @Column({ type: 'bigint', nullable: true })
  branchId?: string | null;

  @Column({ type: 'varchar', length: 20, default: '' })
  prefix!: string;

  @Column({ type: 'bigint', default: 1 })
  nextNo!: string;

  @Column({ type: 'int', default: 5 })
  padding!: number;
}
