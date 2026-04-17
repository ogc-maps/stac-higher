interface CacheEntry {
  schema: unknown;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map<string, CacheEntry>();

export function getCachedSchema(url: string): unknown | null {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    return null;
  }
  return entry.schema;
}

export function setCachedSchema(url: string, schema: unknown): void {
  cache.set(url, { schema, expiresAt: Date.now() + TTL_MS });
}

export async function getOrFetchSchema(url: string): Promise<unknown> {
  const cached = getCachedSchema(url);
  if (cached !== null) return cached;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch schema from ${url}: ${res.status} ${res.statusText}`);
  }
  const schema = await res.json();
  setCachedSchema(url, schema);
  return schema;
}
