import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveAppKey, clearAppKeyCache, AppKeyRejectedError } from "@/utils/appKey";

const env = { ...process.env };
const guard = globalThis.fetch;

function respond(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

beforeEach(() => {
  clearAppKeyCache();
  process.env.MCP_SERVICE_TOKEN = "svc-token";
  process.env.APIFUR_API_URL = "https://account.test";
});

afterEach(() => {
  process.env = { ...env };
  globalThis.fetch = guard;
});

describe("resolveAppKey", () => {
  it("sends the access token and the service token, and returns the key", async () => {
    const fetchMock = respond(200, { appId: "the-real-key" });
    globalThis.fetch = fetchMock as any;

    await expect(resolveAppKey("user.jwt", "key-id", "org-1")).resolves.toBe("the-real-key");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://account.test/internal/mcp/app-key");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer user.jwt");
    expect(headers["X-MCP-Service-Token"]).toBe("svc-token");
  });

  it("caches per organization and key id until the TTL runs out", async () => {
    const fetchMock = respond(200, { appId: "the-real-key" });
    globalThis.fetch = fetchMock as any;
    const t0 = 1_000_000;

    await resolveAppKey("a.jwt", "key-id", "org-1", t0);
    await resolveAppKey("b.jwt", "key-id", "org-1", t0 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await resolveAppKey("c.jwt", "key-id", "org-2", t0 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await resolveAppKey("d.jwt", "key-id", "org-1", t0 + 6 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, { message: "Invalid or expired bearer token" }],
    [404, { error: { code: "API_KEY_NOT_FOUND" } }],
  ])("treats a %i about the access token as a rejection", async (status, body) => {
    globalThis.fetch = respond(status, body) as any;
    await expect(resolveAppKey("user.jwt", "key-id", "org-1")).rejects.toBeInstanceOf(AppKeyRejectedError);
  });

  it.each([
    [401, { error: { code: "UNAUTHORIZED", message: "Invalid service token" } }],
    [503, { error: { code: "NOT_CONFIGURED" } }],
    [500, {}],
  ])("treats a %i from the service gate or an outage as unavailable, not a rejection", async (status, body) => {
    globalThis.fetch = respond(status, body) as any;
    const err = await resolveAppKey("user.jwt", "key-id", "org-1").catch((e) => e);
    expect(err).not.toBeInstanceOf(AppKeyRejectedError);
    expect(err.status).toBe(503);
  });

  it("refuses to call out without a service token", async () => {
    delete process.env.MCP_SERVICE_TOKEN;
    const fetchMock = respond(200, { appId: "the-real-key" });
    globalThis.fetch = fetchMock as any;

    const err = await resolveAppKey("user.jwt", "key-id", "org-1").catch((e) => e);
    expect(err.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not cache a failure", async () => {
    globalThis.fetch = respond(500, {}) as any;
    await resolveAppKey("user.jwt", "key-id", "org-1").catch(() => {});

    globalThis.fetch = respond(200, { appId: "the-real-key" }) as any;
    await expect(resolveAppKey("user.jwt", "key-id", "org-1")).resolves.toBe("the-real-key");
  });
});
