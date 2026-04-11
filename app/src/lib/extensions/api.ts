import type { StacExtension, ExtensionFormData } from "./types";

async function extensionFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api/extensions${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function fetchExtensions(): Promise<StacExtension[]> {
  const data = await extensionFetch<{ extensions: StacExtension[] }>("");
  return data.extensions;
}

export async function fetchExtension(id: string): Promise<StacExtension> {
  return extensionFetch<StacExtension>(`/${encodeURIComponent(id)}`);
}

export async function createExtension(
  data: ExtensionFormData,
): Promise<StacExtension> {
  return extensionFetch<StacExtension>("", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateExtension(
  id: string,
  data: ExtensionFormData,
): Promise<StacExtension> {
  return extensionFetch<StacExtension>(`/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteExtension(id: string): Promise<void> {
  await extensionFetch(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function importExtension(url: string): Promise<StacExtension> {
  return extensionFetch<StacExtension>("/import", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}
