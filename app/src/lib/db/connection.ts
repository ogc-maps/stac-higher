import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://username:password@localhost:5433/postgis";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function getClient(): Promise<pg.PoolClient> {
  return getPool().connect();
}
