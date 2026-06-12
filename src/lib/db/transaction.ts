import { getAppPool, getTenantPool, getServicePool } from "./client";

/**
 * Run a transaction as `app_user` scoped to a single org and user.
 */
export async function withOrgTx<T>(
  orgId: string,
  userId: string,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  // postgres's begin() has an opaque return type that TS can't fully infer;
  // the actual runtime value is the callback's return value.
  return getAppPool().begin(async (tx: any) => {
    await tx`SET LOCAL ROLE app_user`;
    await tx.unsafe(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    await tx.unsafe(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
    return fn(tx);
  }) as unknown as Promise<T>;
}

/**
 * Run a transaction as `tenant_admin` scoped to a tenant and acting user.
 */
export async function withTenantTx<T>(
  tenantId: string,
  userId: string,
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  return getTenantPool().begin(async (tx: any) => {
    await tx`SET LOCAL ROLE tenant_admin`;
    await tx.unsafe(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    await tx.unsafe(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
    return fn(tx);
  }) as unknown as Promise<T>;
}

/**
 * Run a transaction using the service role (bypass RLS). No SET LOCAL required.
 */
export async function withServiceTx<T>(
  fn: (tx: any) => Promise<T>,
): Promise<T> {
  return getServicePool().begin(async (tx: any) => {
    return fn(tx);
  }) as unknown as Promise<T>;
}
