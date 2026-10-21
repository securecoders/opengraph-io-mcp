import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/oauth", () => ({
  verifyAccessToken: vi.fn(),
}));

vi.mock("@/utils/appKey", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/appKey")>()),
  resolveAppKey: vi.fn(async (_token: string, apiKeyId: string) => `key-for-${apiKeyId}`),
}));

// handlePost's new-session branch is the only caller. Mocking it is what lets
// the leak test below assert the server is never built for a request the
// transport would reject anyway.
vi.mock("../src/mcp.js", () => ({
  createServer: vi.fn(() => ({ server: { connect: async () => {} }, cleanup: async () => {} })),
}));

import { verifyAccessToken } from "@/utils/oauth";
import { resolveAppKey, AppKeyRejectedError } from "@/utils/appKey";
import { createServer } from "../src/mcp.js";
import { handlePost, handleGet, handleDelete, sessions, resolveIdleMs, sweepSessions, keyFingerprint } from "@/http/handlers";
import { getAuthContext, setAuthContext } from "@/utils/sessionIdToAppId";
import { logSampled } from "@/utils/log";

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
      subject: "user-2", apiKeyId: "key-b", organizationId: "org-1", scope: "mcp",
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
      subject: "user-1", apiKeyId: "key-a", organizationId: "org-1", scope: "mcp",
    });
    const res = makeRes();
    await handler(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any);

    expect(res.statusCode).toBe(null);
    expect(handled).toBe(1);
  });
});

const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

function allowLegacy() {
  const prior = process.env.MCP_ALLOW_LEGACY_APP_ID;
  beforeEach(() => { process.env.MCP_ALLOW_LEGACY_APP_ID = "true"; });
  afterEach(() => {
    if (prior === undefined) delete process.env.MCP_ALLOW_LEGACY_APP_ID;
    else process.env.MCP_ALLOW_LEGACY_APP_ID = prior;
  });
}

describe("legacy x-app-id sessions", () => {
  allowLegacy();

  it("binds to the app id and rejects a different one", async () => {
    sessions.set(SID, {
      transport: { handleRequest: async () => { handled += 1; } } as any,
      cleanup: async () => {}, owner: `app:${KEY_A}`, lastSeenAt: Date.now(),
    });
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, "x-app-id": KEY_B }), res as any);

    expect(res.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it("marks every legacy response deprecated", async () => {
    sessions.set(SID, {
      transport: { handleRequest: async () => { handled += 1; } } as any,
      cleanup: async () => {}, owner: `app:${KEY_A}`, lastSeenAt: Date.now(),
    });
    const post = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, "x-app-id": KEY_A }), post as any);
    const get = makeRes();
    await handleGet(makeReq({ "mcp-session-id": SID, "x-app-id": KEY_A }), get as any);

    for (const res of [post, get]) {
      expect(res.headers["Deprecation"]).toBe("true");
      expect(res.headers["Link"]).toMatch(/rel="deprecation"/);
    }
  });

  it("logs a new legacy session by fingerprint, never by key", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = {
      headers: { "x-app-id": KEY_A },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    } as any;
    await handlePost(req, makeRes() as any).catch(() => {});

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("auth.legacy_app_id");
    expect(logged).toContain(keyFingerprint(KEY_A));
    expect(logged).not.toContain(KEY_A);
    warn.mockRestore();
  });

  it("serves a matching app id", async () => {
    sessions.set(SID, {
      transport: { handleRequest: async () => { handled += 1; } } as any,
      cleanup: async () => {}, owner: `app:${KEY_A}`, lastSeenAt: Date.now(),
    });
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, "x-app-id": KEY_A }), res as any);

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
        subject: "user-1", apiKeyId: "key-a", organizationId: "org-1", scope: "mcp",
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
      subject: "user-1", apiKeyId: "key-a", organizationId: "org-1", scope: "mcp",
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
      subject: "user-1", apiKeyId: "key-a", organizationId: "org-1", scope: "mcp",
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
  allowLegacy();

  it("rejects an x-app-id request against an OAuth-owned session", async () => {
    sessions.get(SID)!.owner = `sub:${KEY_A}`;
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, "x-app-id": KEY_A }), res as any);
    expect(res.statusCode).toBe(403);
    expect(handled).toBe(0);
  });

  it("rejects a bearer token against a legacy app-owned session", async () => {
    sessions.get(SID)!.owner = "app:key-a";
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "key-a", apiKeyId: "key-a", organizationId: "org-1", scope: "mcp",
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

// #34: the stored context held the opener's raw bearer token for as long as the
// session lived. It is now dropped once the token expires; the session itself
// survives, so a client that refreshes carries on without re-initializing.
describe("credential expiry", () => {
  it("drops an expired token from memory but keeps the session", () => {
    const now = Date.now();
    sessions.get(SID)!.credentialExpiresAt = now - 1;
    setAuthContext(SID, { subject: "user-1", appId: "k", accessToken: "raw.jwt" });

    sweepSessions(now);

    expect(getAuthContext(SID)).toBeUndefined();
    expect(sessions.has(SID)).toBe(true);
  });

  it("leaves a live token alone", () => {
    const now = Date.now();
    sessions.get(SID)!.credentialExpiresAt = now + 60_000;
    setAuthContext(SID, { subject: "user-1", appId: "k", accessToken: "raw.jwt" });

    sweepSessions(now);

    expect(getAuthContext(SID)?.accessToken).toBe("raw.jwt");
  });

  it("takes the new expiry from each authenticated request", async () => {
    const exp = Date.now() + 3_600_000;
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "user-1", apiKeyId: "k", organizationId: "org-1", scope: "mcp", expiresAt: exp,
    });
    await handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), makeRes() as any);

    expect(sessions.get(SID)!.credentialExpiresAt).toBe(exp);
    expect(getAuthContext(SID)?.accessToken).toBe("t");
  });

  it("still evicts an idle session outright", () => {
    sessions.get(SID)!.lastSeenAt = 0;
    sweepSessions(Date.now());
    expect(sessions.has(SID)).toBe(false);
  });
});

describe("bearer sessions", () => {
  it("are not marked deprecated", async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "user-1", apiKeyId: "k", organizationId: "org-1", scope: "mcp",
    });
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any);
    expect(res.headers["Deprecation"]).toBeUndefined();
  });
});

// og_app_id is the key's id; og-api only takes the key itself as app_id.
describe("bearer app key", () => {
  beforeEach(() => {
    vi.mocked(verifyAccessToken).mockResolvedValue({
      subject: "user-1", apiKeyId: "key-id", organizationId: "org-1", scope: "mcp",
    });
  });

  it("binds the resolved key to the session, not the token's key id", async () => {
    await handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), makeRes() as any);

    expect(resolveAppKey).toHaveBeenLastCalledWith("t", "key-id", "org-1");
    expect(getAuthContext(SID)?.appId).toBe("key-for-key-id");
    expect(handled).toBe(1);
  });

  it("answers 401 when the account API refuses the key", async () => {
    vi.mocked(resolveAppKey).mockRejectedValueOnce(new AppKeyRejectedError(404));
    const res = makeRes();
    await handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any);

    expect(res.statusCode).toBe(401);
    expect(handled).toBe(0);
  });

  it("lets an outage through as an error rather than a 401", async () => {
    vi.mocked(resolveAppKey).mockRejectedValueOnce(Object.assign(new Error("down"), { status: 503 }));
    const res = makeRes();

    await expect(handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), res as any))
      .rejects.toMatchObject({ status: 503 });
    expect(res.statusCode).toBe(null);
    expect(handled).toBe(0);
  });
});

// #44: nothing recorded who was refused, who opened or lost a session, or which
// tools ran. Each event is one JSON line on stderr, with no key or token in it.
describe("security events", () => {
  function events(spy: any): any[] {
    return spy.mock.calls.map((c: any[]) => { try { return JSON.parse(c[0]); } catch { return null; } }).filter(Boolean);
  }

  it("records why a request was refused, without the token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(verifyAccessToken).mockRejectedValue(Object.assign(new Error("exp claim timestamp check failed"), { code: "ERR_JWT_EXPIRED" }));
    await handlePost({ ...makeReq({ "mcp-session-id": SID, authorization: "Bearer secret.jwt.value" }), ip: "198.51.100.10" }, makeRes() as any);

    const e = events(spy).find((x) => x.event === "auth.rejected");
    expect(e).toMatchObject({ reason: "ERR_JWT_EXPIRED" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret.jwt.value");
    spy.mockRestore();
  });

  it("records a missing credential", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleGet({ ...makeReq({ "mcp-session-id": SID }), ip: "198.51.100.11" }, makeRes() as any);
    expect(events(spy).find((x) => x.event === "auth.rejected")?.reason).toBe("missing");
    spy.mockRestore();
  });

  it("records an attempt on someone else's session", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(verifyAccessToken).mockResolvedValue({ subject: "intruder", apiKeyId: "k", organizationId: "o", scope: "mcp" });
    await handlePost(makeReq({ "mcp-session-id": SID, authorization: "Bearer t" }), makeRes() as any);
    expect(events(spy).find((x) => x.event === "session.forbidden")).toMatchObject({ principal: "sub:intruder", session: SID.slice(0, 8) });
    spy.mockRestore();
  });

  it("records an idle eviction", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    sessions.get(SID)!.lastSeenAt = 0;
    sweepSessions(Date.now());
    expect(events(spy).find((x) => x.event === "session.closed")).toMatchObject({ reason: "idle" });
    spy.mockRestore();
  });
});

describe("unauthenticated events are sampled", () => {
  it("logs the first few per address per minute, then carries the dropped count", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 50; i++) logSampled("203.0.113.50", "test.flood", {}, 1_000);
    expect(spy).toHaveBeenCalledTimes(5);
    logSampled("203.0.113.50", "test.flood", {}, 62_000);
    expect(JSON.parse(spy.mock.calls[5][0])).toMatchObject({ event: "test.flood", suppressed: 45 });
    logSampled("203.0.113.51", "test.flood", {}, 62_000);
    expect(spy).toHaveBeenCalledTimes(7);
    spy.mockRestore();
  });
});
