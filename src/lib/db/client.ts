import postgres from "postgres";
import { buildConnectionString, buildPoolOptions } from "./pool-factory";

const conn = buildConnectionString();
let _appPool: ReturnType<typeof postgres> | null = null;
let _tenantPool: ReturnType<typeof postgres> | null = null;
let _servicePool: ReturnType<typeof postgres> | null = null;

function createPool(connectionString: string) {
  // postgres.camelcase is a runtime property; cast to satisfy strict tsc.
  const camelTransform = (postgres as unknown as { camelcase: object }).camelcase;
  return postgres(connectionString, {
    ...buildPoolOptions(),
    transform: camelTransform as postgres.Options<{}>["transform"],
  });
}

export function getAppPool() {
  if (!_appPool) {
    _appPool = createPool(conn.app);
  }
  return _appPool;
}

export function getTenantPool() {
  if (!_tenantPool) {
    _tenantPool = createPool(conn.tenant);
  }
  return _tenantPool;
}

export function getServicePool() {
  if (!_servicePool) {
    _servicePool = createPool(conn.service);
  }
  return _servicePool;
}
