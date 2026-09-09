import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 200, unique: true })
  email!: string;

  @Column({ type: 'text' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 200 })
  nameAr!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  totpSecret?: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}

@Entity('roles')
@Unique(['companyId', 'code'])
export class Role {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  /** NULL = global role (as documented in 12.2) */
  @Column({ type: 'bigint', nullable: true })
  companyId?: string | null;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  nameAr!: string;
}

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  /** e.g. gl.entry.post, sales.invoice.confirm (12.2) */
  @Column({ type: 'varchar', length: 60, unique: true })
  code!: string;
}

@Entity('role_permissions')
@Unique(['roleId', 'permissionId'])
export class RolePermission {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  roleId!: string;

  @Column({ type: 'bigint' })
  permissionId!: string;
}

@Entity('user_company_roles')
@Unique(['userId', 'companyId', 'roleId'])
export class UserCompanyRole {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  userId!: string;

  @Column({ type: 'bigint' })
  companyId?: string | null;

  @Column({ type: 'bigint' })
  roleId!: string;

  /** ALL or a specific branch id (documented branch scope) */
  @Column({ type: 'varchar', length: 10, default: 'ALL' })
  branchScope!: string;

  /** Set when branchScope = 'BRANCH'; NULL means all branches */
  @Column({ type: 'bigint', nullable: true })
  branchId?: string | null;
}
