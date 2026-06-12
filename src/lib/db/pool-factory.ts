import fs from "fs";
import postgres from "postgres";

export const DB_PROVIDER = process.env.DB_PROVIDER ?? "local";

export function buildConnectionString(): {
  app: string;
  tenant: string;
  service: string;
} {
  return {
    app: process.env.DATABASE_URL!,
    tenant: process.env.DATABASE_URL_TENANT ?? process.env.DATABASE_URL!,
    service: process.env.DATABASE_URL_SERVICE!,
  };
}

export function buildPoolOptions(): postgres.Options<{}> {
  const base: any = {
    max: Number(process.env.PG_MAX ?? 10),
    idle_timeout: Number(process.env.PG_IDLE_TIMEOUT ?? 30),
  };

  if (DB_PROVIDER === "supabase") {
    return { ...base, ssl: "require" } as any;
  }

  if (process.env.NODE_ENV === "production") {
    if (process.env.DB_SSL_CA) {
      return {
        ...base,
        ssl: { ca: fs.readFileSync(process.env.DB_SSL_CA) },
      } as any;
    }
    return { ...base, ssl: "require" } as any;
  }

  return { ...base, ssl: false } as any;
}
