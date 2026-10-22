import { describe, it, expect, afterEach } from "vitest";
import { createServer as createHttpServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp, resolveBindHost } from "@/http/app";
import { extractAuth, handlePost, legacyAppIdAllowed, sessions } from "@/http/handlers";
import { buildQueryParams, getBaseUrl } from "@/utils/og";
import { withAppId } from "@/utils/og-image-api";
import { serviceUrl } from "@/utils/serviceUrl";

// Phase 2: checks that used to switch themselves off when a setting was missing
// or a header was present.

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; sessions.clear(); });

const KEY = "11111111-1111-4111-8111-111111111111";

function makeRes() {
  return {
    statusCode: 0, body: null as any, headers: {} as Record<string, string>,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
}

describe("legacy x-app-id", () => {
  it("is off unless MCP_ALLOW_LEGACY_APP_ID is true", () => {
    delete process.env.MCP_ALLOW_LEGACY_APP_ID;
    expect(legacyAppIdAllowed()).toBe(false);
    process.env.MCP_ALLOW_LEGACY_APP_ID = "1";
    expect(legacyAppIdAllowed()).toBe(false);
    process.env.MCP_ALLOW_LEGACY_APP_ID = "true";
    expect(legacyAppIdAllowed()).toBe(true);
  });

  it("is not a credential while off", async () => {
    delete process.env.MCP_ALLOW_LEGACY_APP_ID;
    expect(await extractAuth({ headers: { "x-app-id": KEY } } as any)).toBeNull();

    const res = makeRes();
    await handlePost({ headers: { "x-app-id": KEY }, body: {} } as any, res as any);
    expect(res.statusCode).toBe(401);
    expect(res.body.error_description).not.toMatch(/x-app-id/);
  });

  it("is accepted when enabled and well formed", async () => {
    process.env.MCP_ALLOW_LEGACY_APP_ID = "true";
    expect(await extractAuth({ headers: { "x-app-id": KEY } } as any)).toEqual({ appId: KEY });
  });

  it.each(["short", `${KEY}&app_id=other`, "a b c d e f g h i j", "x".repeat(200)])(
    "refuses a malformed value %j even when enabled",
    async (value) => {
      process.env.MCP_ALLOW_LEGACY_APP_ID = "true";
      expect(await extractAuth({ headers: { "x-app-id": value } } as any)).toBeNull();
    },
  );
});

describe("the caller's app_id cannot be overridden by an option", () => {
  it("keeps the credential when options carry app_id", () => {
    const qs = new URLSearchParams(buildQueryParams({ app_id: "someone-else", full_render: true }, KEY));
    expect(qs.getAll("app_id")).toEqual([KEY]);
    expect(qs.get("full_render")).toBe("true");
  });
});

describe("the image agent app_id is encoded", () => {
  it("cannot add or replace query parameters", () => {
    const url = new URL(withAppId("https://agent.test/sessions?x=1", `${KEY}&admin=1`));
    expect(url.searchParams.get("app_id")).toBe(`${KEY}&admin=1`);
    expect(url.searchParams.get("admin")).toBeNull();
    expect(url.searchParams.get("x")).toBe("1");
  });
});

describe("service base URLs", () => {
  it("falls back to the default when unset", () => {
    delete process.env.TEST_SERVICE_URL;
    expect(serviceUrl("TEST_SERVICE_URL", "https://default.test")).toBe("https://default.test");
  });

  it.each(["https://api.test", "https://api.test/base/", "http://localhost:8000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "accepts %s",
    (value) => {
      process.env.TEST_SERVICE_URL = value;
      expect(() => serviceUrl("TEST_SERVICE_URL", "https://default.test")).not.toThrow();
    },
  );

  it.each([
    "http://api.test",
    "ftp://api.test",
    "https://user:pass@api.test",
    "https://api.test?app_id=x",
    "not a url",
  ])("refuses %s", (value) => {
    process.env.TEST_SERVICE_URL = value;
    expect(() => serviceUrl("TEST_SERVICE_URL", "https://default.test")).toThrow(/TEST_SERVICE_URL/);
  });

  it("strips a trailing slash so paths join cleanly", () => {
    process.env.TEST_SERVICE_URL = "https://api.test/";
    expect(serviceUrl("TEST_SERVICE_URL", "https://default.test")).toBe("https://api.test");
  });

  it("is what the API client uses", () => {
    process.env.OG_BASE_URL = "http://attacker.test";
    expect(() => getBaseUrl()).toThrow(/OG_BASE_URL/);
  });
});

describe("bind address and Host header", () => {
  let server: Server;
  let port: number;

  async function start() {
    server = createHttpServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  }
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function get(path: string, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("binds loopback unless MCP_HOST says otherwise", () => {
    delete process.env.MCP_HOST;
    expect(resolveBindHost()).toBe("127.0.0.1");
    process.env.MCP_HOST = "0.0.0.0";
    expect(resolveBindHost()).toBe("0.0.0.0");
  });

  it("refuses a foreign Host on /mcp when bound to loopback", async () => {
    delete process.env.MCP_HOST;
    delete process.env.MCP_ALLOWED_HOSTS;
    await start();
    expect(await get("/mcp", "attacker.test")).toBe(403);
    expect(await get("/mcp", `localhost:${port}`)).not.toBe(403);
    expect(await get("/health", "attacker.test")).toBe(200);
  });

  it("checks against MCP_ALLOWED_HOSTS when set", async () => {
    process.env.MCP_HOST = "0.0.0.0";
    process.env.MCP_ALLOWED_HOSTS = "mcp.example.test";
    await start();
    expect(await get("/mcp", "mcp.example.test")).not.toBe(403);
    expect(await get("/mcp", "localhost")).toBe(403);
  });

  it("does not check the Host on all interfaces with no list", async () => {
    process.env.MCP_HOST = "0.0.0.0";
    delete process.env.MCP_ALLOWED_HOSTS;
    await start();
    expect(await get("/mcp", "anything.test")).not.toBe(403);
  });
});
