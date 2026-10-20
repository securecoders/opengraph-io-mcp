import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer as createHttpServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createApp } from "@/http/app";
import { countSessionsFromIp, handlePost, makeRoomForOwner, sessions } from "@/http/handlers";
import { createServer } from "@/mcp";
import {
  CALL_BURST,
  MAX_SESSIONS,
  MAX_SESSIONS_PER_IP,
  MAX_SESSIONS_PER_OWNER,
  MAX_SUBSCRIPTIONS,
  SESSION_CREATE_LIMIT,
  TokenBucket,
  resolveTrustProxy,
} from "@/utils/limits";
import { ToolNames } from "@/tools/constants";

// #30: nothing bounded how many sessions, subscriptions or calls one client could
// make. Each of these would have run unbounded before.

function entry(owner: string, lastSeenAt: number, onClose?: () => void, ip?: string) {
  return {
    transport: { close: async () => { onClose?.(); } } as any,
    cleanup: async () => {},
    owner,
    lastSeenAt,
    ip,
  };
}

const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

function fakeRes() {
  return {
    statusCode: 0, body: null as any, headers: {} as Record<string, string>,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
}

const priorLegacy = process.env.MCP_ALLOW_LEGACY_APP_ID;
beforeEach(() => { sessions.clear(); process.env.MCP_ALLOW_LEGACY_APP_ID = "true"; });
afterEach(() => {
  sessions.clear();
  if (priorLegacy === undefined) delete process.env.MCP_ALLOW_LEGACY_APP_ID;
  else process.env.MCP_ALLOW_LEGACY_APP_ID = priorLegacy;
});

describe("TokenBucket", () => {
  it("allows the burst, refuses the next, and refills over time", () => {
    let now = 0;
    const bucket = new TokenBucket(3, 1, () => now);
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, true]);
    expect(bucket.take()).toBe(false);
    now = 1000;
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });
});

describe("sessions per owner", () => {
  it("drops the owner's least recently used session to make room", () => {
    for (let i = 0; i < MAX_SESSIONS_PER_OWNER; i++) sessions.set(`s${i}`, entry("sub:a", 1000 + i));
    sessions.set("other", entry("sub:b", 0));

    makeRoomForOwner("sub:a");

    expect(sessions.has("s0")).toBe(false);
    expect(sessions.has("s1")).toBe(true);
    expect(sessions.has("other")).toBe(true);
  });

  it("closes the evicted session's transport, not just its map entry", () => {
    let closed = 0;
    for (let i = 0; i < MAX_SESSIONS_PER_OWNER; i++) sessions.set(`s${i}`, entry("sub:a", 1000 + i, () => { closed += 1; }));
    makeRoomForOwner("sub:a");
    expect(closed).toBe(1);
  });

  it("leaves an owner under the limit alone", () => {
    sessions.set("s0", entry("sub:a", 0));
    makeRoomForOwner("sub:a");
    expect(sessions.has("s0")).toBe(true);
  });
});

describe("process-wide session ceiling", () => {
  it("refuses a new session at capacity without building a server", async () => {
    for (let i = 0; i < MAX_SESSIONS; i++) sessions.set(`s${i}`, entry(`app:${i}`, Date.now()));
    const res: any = {
      statusCode: 0, body: null, headers: {} as Record<string, string>,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.body = b; return this; },
      setHeader(k: string, v: string) { this.headers[k] = v; },
    };
    const req: any = {
      headers: { "x-app-id": "33333333-3333-4333-8333-333333333333" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    };

    await handlePost(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.headers["Retry-After"]).toBe("60");
    expect(sessions.size).toBe(MAX_SESSIONS);
  });

  it("does not evict the caller's own session when it is about to refuse them anyway", async () => {
    for (let i = 0; i < MAX_SESSIONS_PER_OWNER; i++) sessions.set(`own${i}`, entry("app:44444444-4444-4444-8444-444444444444", i));
    for (let i = sessions.size; i < MAX_SESSIONS; i++) sessions.set(`s${i}`, entry(`app:${i}`, Date.now()));
    const res: any = {
      statusCode: 0, headers: {} as Record<string, string>,
      status(c: number) { this.statusCode = c; return this; },
      json() { return this; },
      setHeader(k: string, v: string) { this.headers[k] = v; },
    };
    const req: any = {
      headers: { "x-app-id": "44444444-4444-4444-8444-444444444444" },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    };

    await handlePost(req, res);

    expect(res.statusCode).toBe(503);
    expect(sessions.has("own0")).toBe(true);
  });
});

describe("sessions per address", () => {
  // Owners cost nothing to mint (any x-app-id today, a free signup later), so
  // without this one address could fill the global ceiling at the open rate.
  it("refuses a new session once an address holds the maximum", async () => {
    for (let i = 0; i < MAX_SESSIONS_PER_IP; i++) sessions.set(`s${i}`, entry(`app:${i}`, Date.now(), undefined, "203.0.113.9"));
    const res = fakeRes();

    await handlePost({ ip: "203.0.113.9", headers: { "x-app-id": "55555555-5555-4555-8555-555555555555" }, body: INITIALIZE } as any, res as any);

    expect(res.statusCode).toBe(429);
    expect(countSessionsFromIp("203.0.113.9")).toBe(MAX_SESSIONS_PER_IP);
  });

  it("counts only sessions from that address", () => {
    sessions.set("a", entry("app:a", 0, undefined, "203.0.113.9"));
    sessions.set("b", entry("app:b", 0, undefined, "198.51.100.1"));
    expect(countSessionsFromIp("203.0.113.9")).toBe(1);
  });
});

describe("per-session call budget", () => {
  async function connect(sessionId: string | null = "http-session") {
    const { server, cleanup } = createServer({ local: sessionId === null });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    if (sessionId) (serverT as any).sessionId = sessionId;
    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([client.connect(clientT), (server as any).connect(serverT)]);
    return { client, cleanup };
  }

  it("answers a busy error once the burst is spent", async () => {
    const { client, cleanup } = await connect();
    try {
      // No access token, so this tool answers locally without an upstream call.
      const call = () => client.callTool({ name: ToolNames.GET_CONNECTION_CONTEXT, arguments: {} }) as Promise<any>;
      for (let i = 0; i < CALL_BURST; i++) {
        const res = await call();
        expect(JSON.stringify(res)).not.toMatch(/Too many tool calls/);
      }
      const over = await call();
      expect(over.isError).toBe(true);
      expect(JSON.stringify(over)).toMatch(/Too many tool calls/);
    } finally {
      await cleanup().catch(() => {});
    }
  });

  it("does not apply to stdio, which has no session and one local user", async () => {
    const { client, cleanup } = await connect(null);
    try {
      for (let i = 0; i < CALL_BURST + 5; i++) {
        const res = await client.callTool({ name: ToolNames.GET_CONNECTION_CONTEXT, arguments: {} });
        expect(JSON.stringify(res)).not.toMatch(/Too many tool calls/);
      }
    } finally {
      await cleanup().catch(() => {});
    }
  });

  it("caps subscriptions per session", async () => {
    const { client, cleanup } = await connect();
    try {
      for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        await client.subscribeResource({ uri: `asset://s/${i}` });
      }
      await expect(client.subscribeResource({ uri: "asset://s/one-more" })).rejects.toThrow(/at most/);
      await expect(client.subscribeResource({ uri: `asset://${"x".repeat(5000)}` })).rejects.toThrow(/too long/);
      // Re-subscribing to something already held is not growth.
      await expect(client.subscribeResource({ uri: "asset://s/0" })).resolves.toBeDefined();
    } finally {
      await cleanup().catch(() => {});
    }
  });
});

describe("trust proxy", () => {
  const original = process.env.MCP_TRUST_PROXY;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_TRUST_PROXY;
    else process.env.MCP_TRUST_PROXY = original;
  });

  it.each([
    [undefined, 1],
    ["", 1],
    ["0", 0],
    ["2", 2],
    ["false", false],
    ["true", 1],
    ["nonsense", 1],
  ])("MCP_TRUST_PROXY=%s resolves to %s", (value, expected) => {
    if (value === undefined) delete process.env.MCP_TRUST_PROXY;
    else process.env.MCP_TRUST_PROXY = value;
    expect(resolveTrustProxy()).toBe(expected);
  });
});

describe("session creation rate limit", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createHttpServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function post(body: unknown, headers: Record<string, string> = {}): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1", port, path: "/mcp", method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        },
        (res) => { res.resume(); res.on("end", () => resolve(res.statusCode!)); },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  }

  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

  it("refuses new sessions from one address past the limit", async () => {
    // No credential, so each is answered 401 by the handler, but each still
    // counts: the limiter sits in front of anything that could build a server.
    for (let i = 0; i < SESSION_CREATE_LIMIT; i++) {
      expect(await post(initialize)).toBe(401);
    }
    expect(await post(initialize)).toBe(429);
  });

  it("does not count requests inside an existing session", async () => {
    for (let i = 0; i < SESSION_CREATE_LIMIT + 5; i++) {
      expect(await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": "x" })).not.toBe(429);
    }
  });
});

