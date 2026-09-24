import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createServer as createHttpServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "@/http/app";

// Regression cover for the express layer. It had none before createApp() was
// split out of the entrypoint: importing server-http.ts bound port 3010, so
// nothing could reach the routes, CORS, headers or error handling.
//
// node:http rather than fetch: tests/setup.ts replaces globalThis.fetch with a
// throw-guard so an unmocked upstream call fails loudly, and that guard would
// swallow these requests too.

let server: Server;
let port: number;

beforeAll(async () => {
  server = createHttpServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: () => any;
}

function call(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers: opts.headers ?? {} },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body,
            json: () => JSON.parse(body),
          }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("routes are mounted", () => {
  it("GET /health", async () => {
    const res = await call("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  // RFC 9728 discovery. A client that gets a 401 reads this to find the
  // authorization server, so breaking it breaks the whole OAuth flow.
  it("GET /.well-known/oauth-protected-resource", async () => {
    const res = await call("GET", "/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.resource).toBeTruthy();
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.bearer_methods_supported).toEqual(["header"]);
    expect(body.scopes_supported).toEqual(["mcp"]);
  });

  it.each([
    ["POST", '{"jsonrpc":"2.0","method":"tools/list","id":1}'],
    ["GET", undefined],
    ["DELETE", undefined],
  ])("%s /mcp reaches the handler and refuses an anonymous caller", async (method, body) => {
    const res = await call(method, "/mcp", { headers: JSON_HEADERS, body });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Bearer");
  });

  it("unknown paths are 404, not a crash", async () => {
    expect((await call("GET", "/nope")).status).toBe(404);
  });
});

describe("CORS", () => {
  const origEnv = process.env.MCP_ALLOWED_ORIGINS;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.MCP_ALLOWED_ORIGINS;
    else process.env.MCP_ALLOWED_ORIGINS = origEnv;
  });

  it("answers the preflight with 204 and the method/header allowances", async () => {
    const res = await call("OPTIONS", "/mcp", { headers: { origin: "https://example.test" } });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
    expect(res.headers["access-control-allow-headers"]).toContain("MCP-Session-Id");
  });

  // Current documented behaviour: reflect by default. #38 changes this; the test
  // is here so that change is a deliberate edit rather than a silent one.
  it("reflects an arbitrary origin while MCP_ALLOWED_ORIGINS is unset", async () => {
    delete process.env.MCP_ALLOWED_ORIGINS;
    const res = await call("GET", "/health", { headers: { origin: "https://evil.test" } });
    expect(res.headers["access-control-allow-origin"]).toBe("https://evil.test");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["vary"]).toBe("Origin");
  });

  it("honours an allowlist when one is set", async () => {
    process.env.MCP_ALLOWED_ORIGINS = "https://good.test";
    const allowed = await call("GET", "/health", { headers: { origin: "https://good.test" } });
    const denied = await call("GET", "/health", { headers: { origin: "https://evil.test" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://good.test");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still exposes the session id header clients need to read", async () => {
    const res = await call("GET", "/health", { headers: { origin: "https://example.test" } });
    expect(res.headers["access-control-expose-headers"]).toContain("MCP-Session-Id");
  });
});

describe("response headers", () => {
  it("does not advertise express", async () => {
    expect((await call("GET", "/health")).headers["x-powered-by"]).toBeUndefined();
  });

  it("sets nosniff, including on an error response", async () => {
    expect((await call("GET", "/health")).headers["x-content-type-options"]).toBe("nosniff");
    const bad = await call("POST", "/mcp", { headers: JSON_HEADERS, body: "{bad" });
    expect(bad.headers["x-content-type-options"]).toBe("nosniff");
  });
});

// A malformed body used to surface body-parser's SyntaxError as an HTML stack
// trace naming paths under /app/node_modules.
describe("error handling", () => {
  it("returns generic JSON for a malformed body", async () => {
    const res = await call("POST", "/mcp", { headers: JSON_HEADERS, body: "{bad" });
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual({
      error: "bad_request",
      error_description: "The request could not be parsed.",
    });
  });

  it("leaks no stack trace, file path or parser internals", async () => {
    const res = await call("POST", "/mcp", { headers: JSON_HEADERS, body: "{bad" });
    expect(res.body).not.toMatch(/node_modules|body-parser|SyntaxError|\bat \w+/);
  });
});
