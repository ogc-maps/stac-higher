import { $activeEndpoint, $endpoints } from "@/stores/endpointStore";
import type { StacEndpoint } from "@/stores/endpointStore";
import { StacApiError } from "./types";

interface FetchOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  endpointUrl?: string;
}

function getBaseUrl(overrideUrl?: string): string {
  if (overrideUrl) return overrideUrl.replace(/\/+$/, "");
  const endpoint = $activeEndpoint.get();
  if (!endpoint) throw new StacApiError("No active STAC endpoint configured", 0);
  return endpoint.url.replace(/\/+$/, "");
}

function getEndpointForUrl(url: string): StacEndpoint | undefined {
  const normalized = url.replace(/\/+$/, "");
  return $endpoints.get().find((e) => normalized.startsWith(e.url.replace(/\/+$/, "")));
}

function shouldProxy(endpointUrl?: string): { proxy: boolean; endpointBase: string } {
  if (endpointUrl) {
    const ep = getEndpointForUrl(endpointUrl);
    return { proxy: ep?.proxy === true, endpointBase: ep?.url ?? endpointUrl };
  }
  const ep = $activeEndpoint.get();
  return { proxy: ep?.proxy === true, endpointBase: ep?.url ?? "" };
}

export async function stacFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { method = "GET", body, signal, endpointUrl } = options;
  const baseUrl = getBaseUrl(endpointUrl);
  const targetUrl = `${baseUrl}${path}`;
  const { proxy, endpointBase } = shouldProxy(endpointUrl);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let fetchUrl: string;
  if (proxy) {
    fetchUrl = "/api/proxy";
    headers["X-Proxy-Target"] = targetUrl;
    headers["X-Proxy-Endpoint"] = endpointBase;
  } else {
    fetchUrl = targetUrl;
  }

  const response = await fetch(fetchUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail ?? errorBody.message ?? JSON.stringify(errorBody);
    } catch {
      detail = await response.text().catch(() => undefined);
    }
    throw new StacApiError(
      `STAC API error: ${response.status} ${response.statusText}`,
      response.status,
      detail,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}
