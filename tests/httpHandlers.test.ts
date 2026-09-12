import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/oauth", () => ({
  verifyAccessToken: vi.fn(),
}));

import { verifyAccessToken } from "@/utils/oauth";
import { handlePost, handleGet, handleDelete, sessions } from "@/http/handlers";

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

describe("GET and DELETE without a session", () => {
  it.each([["handleGet", handleGet], ["handleDelete", handleDelete]])(
    "%s returns 400 for an unknown session id", async (_n, handler) => {
      const res = makeRes();
      await handler(makeReq({ "mcp-session-id": "nope" }), res as any);
      expect(res.statusCode).toBe(400);
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
