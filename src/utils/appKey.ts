/**
 * Trades the API key id carried by an OAuth access token (og_app_id) for the
 * key itself, which is what the OpenGraph API accepts as app_id.
 *
 * The account API requires both the caller's access token and this server's
 * MCP_SERVICE_TOKEN, so the key never has to ride inside the JWT.
 *
 * Environment variables:
 *   MCP_SERVICE_TOKEN — shared secret with apifur-api's /internal/mcp/app-key
 *   APIFUR_API_URL    — defaults to https://dashboard-api.opengraph.io
 */

import { serviceUrl } from "@/utils/serviceUrl";
import { ACCOUNT_API_TIMEOUT_MS, fetchWithTimeout, readErrorBody, readJson } from "@/utils/http";

const SERVICE = "The OpenGraph.io account API";

// Auth runs on every request, so lookups are cached. A revoked key is still
// refused by the OpenGraph API itself; the TTL only bounds how long this server
// keeps using a key the account API would no longer hand out.
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 10_000;

const cache = new Map<string, { appId: string; expiresAt: number }>();

/** The access token no longer names a key its user may bill to. Re-authorizing is the fix. */
export class AppKeyRejectedError extends Error {
  constructor(status: number) {
    super(`${SERVICE} refused the API key for this access token (status ${status}).`);
    this.name = "AppKeyRejectedError";
  }
}

/** Ours to fix, not the caller's: answering 401 would send every client through OAuth again for nothing. */
function unavailable(message: string): Error {
  return Object.assign(new Error(message), { status: 503 });
}

export const getAccountApiBaseUrl = (): string =>
  serviceUrl("APIFUR_API_URL", "https://dashboard-api.opengraph.io");

export async function resolveAppKey(
  accessToken: string,
  apiKeyId: string,
  organizationId: string,
  now = Date.now(),
): Promise<string> {
  const cacheKey = `${organizationId}:${apiKeyId}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.appId;

  const serviceToken = process.env.MCP_SERVICE_TOKEN;
  if (!serviceToken) throw unavailable("MCP_SERVICE_TOKEN is not set, so OAuth sessions cannot reach the OpenGraph API.");

  const response = await fetchWithTimeout(SERVICE, `${getAccountApiBaseUrl()}/internal/mcp/app-key`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-MCP-Service-Token": serviceToken,
      Accept: "application/json",
    },
  }, ACCOUNT_API_TIMEOUT_MS);

  if (!response.ok) {
    const body: any = await readErrorBody(SERVICE, response);
    // The service-token gate answers 401 UNAUTHORIZED and 503 NOT_CONFIGURED; every
    // other 401 or 404 is about the access token or the key it names.
    const serviceRefused = body?.error?.code === "UNAUTHORIZED" || body?.error?.code === "NOT_CONFIGURED";
    if ((response.status === 401 || response.status === 404) && !serviceRefused) {
      throw new AppKeyRejectedError(response.status);
    }
    throw unavailable(`${SERVICE} could not resolve the API key (status ${response.status}).`);
  }

  const body = await readJson<{ appId?: unknown }>(SERVICE, response);
  if (typeof body?.appId !== "string" || !body.appId) {
    throw unavailable(`${SERVICE} returned no API key.`);
  }

  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(cacheKey, { appId: body.appId, expiresAt: now + CACHE_TTL_MS });
  return body.appId;
}

export function clearAppKeyCache(): void {
  cache.clear();
}
