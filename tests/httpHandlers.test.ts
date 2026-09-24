import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/oauth", () => ({
  verifyAccessToken: vi.fn(),
}));

// handlePost's new-session branch is the only caller. Mocking it is what lets
// the leak test below assert the server is never built for a request the
// transport would reject anyway.
vi.mock("../src/mcp.js", () => ({
  createServer: vi.fn(() => ({ server: { connect: async () => {} }, cleanup: async () => {} })),
}));

import { verifyAccessToken } from "@/utils/oauth";
import { createServer } from "../src/mcp.js";
import { handlePost, handleGet, handleDelete, sessions, resolveIdleMs } from "@/http/handlers";

const SID = "session-1";

function makeRes() {
  return {
    statusCode: null as number | null,
    body: null as any,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
}

function makeReq(headers: Record<string, string> = {}) {
  return { headers, body: { jsonrpc: "2.0", method: "tools/list", id: 1 } } as any;
}

let handled: number;

beforeEach(() => {
  handled = 0;
  sessions.clear();
  sessions.set(SID, {
    transport: { handleRequest: async () => { handled += 1; } } as any,
    cleanup: async () => {},
    owner: "sub:user-1",
    lastSeenAt: Date.now(),
  });
  vi.mocked(verifyAccessToken).mockReset();
  vi.mocked(createServer).mockClear();
});

// The whole point of the session guard: holding a session id must not be enough
// to act, because the stored context carries the opener's live access token.
describe.each([
  ["handlePost", handlePost],
  ["handleGet", handleGet],
  ["handleDelete", handleDelete],
])("%s session guard", (_name, handler) => {
  it("rejects a known session presenting no credentials", async () => {
    const res = makeRes();
    await handler(makeReq({ "mcp-session-id": SID }), res as any);

    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toContain("Bearer");
    expect(handled).toBe(0);
  });

  it("rejects a valid token belonging to a different principal", async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "user-2", appId: "key-b", organizationId: "org-1", scope: "mcp",
    });
    const res = makeRes();
    await handler(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any);

    expect(res.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it("rejects an invalid token on a known session", async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(new Error("expired"));
    const res = makeRes();
    await handler(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any);

    expect(res.statusCode).toBe(401);
    expect(handled).toBe(0);
  });

  it("serves the owner", async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "user-1", appId: "key-a", organizationId: "org-1", scope: "mcp",
    });
    const res = makeRes();
    await handler(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any);

    expect(res.statusCode).toBe(null);
    expect(handled).toBe(1);
  });
});

describe("legacy x-app-id sessions", () => {
  it("binds to the app id and rejects a different one", async () => {
    sessions.set(SID, {
      transport: { handleRequest: async () => { handled += 1; } } as any,
      cleanup: async () => {}, owner: "app:key-a", lastSeenAt: Date.now(),
    });
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, "x-app-id": "key-b" }), res as any);

    expect(res.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it("serves a matching app id", async () => {
    sessions.set(SID, {
      transport: { handleRequest: async () => { handled += 1; } } as any,
      cleanup: async () => {}, owner: "app:key-a", lastSeenAt: Date.now(),
    });
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, "x-app-id": "key-a" }), res as any);

    expect(handled).toBe(1);
  });
});

// An unknown session id used to be answered before the credential was checked,
// which told anyone holding a session id whether it was still live. It now
// answers 401 without a credential, and only a caller who authenticated learns
// the session is gone.
describe("unknown session ids", () => {
  it.each([["handlePost", handlePost], ["handleGet", handleGet], ["handleDelete", handleDelete]])(
    "%s answers 401, not a distinguishable status, when no credential is presented",
    async (_n, handler) => {
      const res = makeRes();
      await handler(makeReq({ "mcp-session-id": "nope" }), res as any);
      expect(res.statusCode).toBe(401);
      expect(handled).toBe(0);
    });

  it.each([["handlePost", handlePost], ["handleGet", handleGet], ["handleDelete", handleDelete]])(
    "%s answers 404 to an authenticated caller so the client re-initializes",
    async (_n, handler) => {
      vi.mocked(verifyAccessToken).mockResolvedValue({
        subject: "user-1", appId: "key-a", organizationId: "org-1", scope: "mcp",
      });
      const res = makeRes();
      await handler(makeReq({ "mcp-session-id": "nope", authorization: "Bearer t" }), res as any);
      expect(res.statusCode).toBe(404);
      expect(res.body?.error?.code).toBe(-32001);
      expect(handled).toBe(0);
    });

  it("gives an unknown and a known session the same answer without a credential", async () => {
    const unknown = makeRes();
    const known = makeRes();
    await handleGet(makeReq({ "mcp-session-id": "nope" }), unknown as any);
    await handleGet(makeReq({ "mcp-session-id": SID }), known as any);
    expect(unknown.statusCode).toBe(known.statusCode);
  });
});

describe("activity tracking", () => {
  it("refreshes lastSeenAt so an active session is not swept", async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "user-1", appId: "key-a", organizationId: "org-1", scope: "mcp",
    });
    sessions.get(SID)!.lastSeenAt = 0;
    await handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), makeRes() as any);
    expect(sessions.get(SID)!.lastSeenAt).toBeGreaterThan(0);
  });
});

// createServer() starts a 10s interval. It used to run before the transport got
// a chance to reject the request, and a rejected request never reaches the
// sessions map — so nothing ever cleared that interval. One leaked server,
// transport and timer per rejected POST, reachable by anyone who can
// authenticate at all.
describe("session creation is reserved for initialize", () => {
  beforeEach(() => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "user-1", appId: "key-a", organizationId: "org-1", scope: "mcp",
    });
  });

  it("does not build a server for a non-initialize POST with no session id", async () => {
    const res = makeRes();
    await handlePost(makeReq({ authorization: "Bearer t" }), res as any);
    expect(createServer).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it("does not build a server for an unauthenticated POST", async () => {
    const res = makeRes();
    await handlePost(makeReq(), res as any);
    expect(createServer).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  // Only asserts that the guard lets an initialize through to createServer.
  // Completing the handshake needs a real node ServerResponse (the transport
  // calls writeHead), so the transport is allowed to fail here.
  it("builds a server for an initialize", async () => {
    const req = {
      headers: { authorization: "Bearer t" },
      body: {
        jsonrpc: "2.0", method: "initialize", id: 1,
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      },
    } as any;
    await handlePost(req, makeRes() as any).catch(() => {});
    expect(createServer).toHaveBeenCalledTimes(1);
  });
});

// The cross-shape case is what issue #29 actually describes: a legacy x-app-id
// request presenting the app id of an OAuth session's subject. ownerKey
// namespaces the two, so they can never collide — but that was only pinned as a
// unit test on ownerKey itself, never through a handler.
describe("cross-shape principals cannot take over a session", () => {
  it("rejects an x-app-id request against an OAuth-owned session", async () => {
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, "x-app-id": "user-1" }), res as any);
    expect(res.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it("rejects a bearer token against a legacy app-owned session", async () => {
    sessions.get(SID)!.owner = "app:key-a";
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "key-a", appId: "key-a", organizationId: "org-1", scope: "mcp",
    });
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any);
    expect(res.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it("does not fall back to x-app-id when a bearer token fails verification", async () => {
    sessions.get(SID)!.owner = "app:key-a";
    vi.mocked(verifyAccessToken).mockRejectedValue(new Error("bad signature"));
    const res = makeRes();
    await handlePost(
      makeReq({ "mcp-session-id": SID, authorization: "Bearer t", "x-app-id": "key-a" }),
      res as any,
    );
    expect(res.statusCode).toBe(401);
    expect(handled).toBe(0);
  });
});

// A typo in one environment variable used to make Number() yield NaN, which
// poisoned both the interval delay and the sweep cutoff: every session was
// deleted on every tick.
describe("resolveIdleMs", () => {
  const original = process.env.MCP_SESSION_IDLE_MS;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_SESSION_IDLE_MS;
    else process.env.MCP_SESSION_IDLE_MS = original;
  });

  it.each(["abc", "", "0", "-1", "NaN"])("falls back to the default for %o", (value) => {
    process.env.MCP_SESSION_IDLE_MS = value;
    expect(resolveIdleMs()).toBe(30 * 60 * 1000);
  });

  it("uses a valid override", () => {
    process.env.MCP_SESSION_IDLE_MS = "60000";
    expect(resolveIdleMs()).toBe(60000);
  });

  it("falls back when unset", () => {
    delete process.env.MCP_SESSION_IDLE_MS;
    expect(resolveIdleMs()).toBe(30 * 60 * 1000);
  });
});
