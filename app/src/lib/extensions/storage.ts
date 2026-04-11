import { query } from "@/lib/db/connection";
import type { StacExtension } from "./types";

interface ExtensionRow {
  id: string;
  name: string;
  prefix: string;
  version: string;
  description: string;
  schema: Record<string, unknown>;
  source: string;
  source_url: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToExtension(row: ExtensionRow): StacExtension {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    version: row.version,
    description: row.description,
    schema: row.schema,
    source: row.source as "local" | "external",
    sourceUrl: row.source_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listExtensions(): Promise<StacExtension[]> {
  const result = await query<ExtensionRow>(
    `SELECT * FROM stac_higher.extensions ORDER BY name ASC`,
  );
  return result.rows.map(rowToExtension);
}

export async function getExtension(
  id: string,
): Promise<StacExtension | null> {
  const result = await query<ExtensionRow>(
    `SELECT * FROM stac_higher.extensions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? rowToExtension(result.rows[0]) : null;
}

export async function createExtension(data: {
  name: string;
  prefix: string;
  version: string;
  description: string;
  schema: Record<string, unknown>;
  source: "local" | "external";
  sourceUrl?: string | null;
}): Promise<StacExtension> {
  const result = await query<ExtensionRow>(
    `INSERT INTO stac_higher.extensions (name, prefix, version, description, schema, source, source_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.name,
      data.prefix,
      data.version,
      data.description,
      JSON.stringify(data.schema),
      data.source,
      data.sourceUrl ?? null,
    ],
  );
  return rowToExtension(result.rows[0]);
}

export async function updateExtension(
  id: string,
  data: Partial<{
    name: string;
    prefix: string;
    version: string;
    description: string;
    schema: Record<string, unknown>;
    sourceUrl: string | null;
  }>,
): Promise<StacExtension> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(data.name);
  }
  if (data.prefix !== undefined) {
    sets.push(`prefix = $${idx++}`);
    values.push(data.prefix);
  }
  if (data.version !== undefined) {
    sets.push(`version = $${idx++}`);
    values.push(data.version);
  }
  if (data.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(data.description);
  }
  if (data.schema !== undefined) {
    sets.push(`schema = $${idx++}`);
    values.push(JSON.stringify(data.schema));
  }
  if (data.sourceUrl !== undefined) {
    sets.push(`source_url = $${idx++}`);
    values.push(data.sourceUrl);
  }

  sets.push(`updated_at = now()`);
  values.push(id);

  const result = await query<ExtensionRow>(
    `UPDATE stac_higher.extensions SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );

  if (result.rows.length === 0) {
    throw new Error(`Extension not found: ${id}`);
  }
  return rowToExtension(result.rows[0]);
}

export async function deleteExtension(id: string): Promise<void> {
  await query(`DELETE FROM stac_higher.extensions WHERE id = $1`, [id]);
}

export async function getExtensionBySourceUrl(
  url: string,
): Promise<StacExtension | null> {
  const result = await query<ExtensionRow>(
    `SELECT * FROM stac_higher.extensions WHERE source_url = $1`,
    [url],
  );
  return result.rows[0] ? rowToExtension(result.rows[0]) : null;
}
