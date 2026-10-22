import { describe, it, expect, afterEach } from "vitest";
import {
  MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
  UpstreamTimeoutError,
  fetchWithTimeout,
  readBytes,
  safeUpstreamMessage,
} from "@/utils/http";
import { extractHtmlElements, getScreenshotUrl, getSiteMarkdown, getSiteOgData, scrapeSite } from "@/utils/og";
import { deleteFixItem, getAuditStatus, getSchedule } from "@/utils/site-audit-api";
import { createSession, getSession } from "@/utils/og-image-api";
import GetSiteAuditStatusTool from "@/tools/get-site-audit-status";

// The bounds on every call this server makes to an
// OpenGraph service.

const guard = globalThis.fetch;
afterEach(() => { globalThis.fetch = guard; });

interface Seen { url: string; init: any }
let seen: Seen[] = [];

function stubFetch(route: { ok?: boolean; status?: number; body?: unknown; raw?: string; contentType?: string } = {}) {
  seen = [];
  globalThis.fetch = (async (input: unknown, init: any) => {
    seen.push({ url: String(input), init });
    const ok = route.ok !== false;
    const status = route.status ?? (ok ? 200 : 500);
    const raw = route.raw ?? JSON.stringify(route.body ?? {});
    return {
      ok, status, statusText: ok ? "OK" : "Error",
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? route.contentType ?? "application/json" : null) },
      text: async () => raw,
      json: async () => JSON.parse(raw),
    };
  }) as unknown as typeof fetch;
}

describe("timeouts", () => {
  it("abandons a request that outlives its timeout", async () => {
    globalThis.fetch = ((_: unknown, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    })) as unknown as typeof fetch;

    await expect(fetchWithTimeout("The test API", "https://x.test/", {}, 20))
      .rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("names the service and the limit, not the abort internals", async () => {
    globalThis.fetch = ((_: unknown, init: any) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    })) as unknown as typeof fetch;

    await expect(fetchWithTimeout("The test API", "https://x.test/", {}, 20))
      .rejects.toThrow(/^The test API did not respond within/);
  });

  it.each([
    ["the OpenGraph API", () => scrapeSite("https://x.test/", "key")],
    ["the Open Graph Audit API", () => getAuditStatus("a1", "tok")],
    ["image agent", () => createSession("s", "key")],
  ])("%s calls carry an abort signal", async (_name, call) => {
    stubFetch({ body: { sessionId: "s", audit: {} } });
    await call().catch(() => {});
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("response size cap", () => {
  it("refuses a response whose declared length is over the cap, without reading it", async () => {
    let read = false;
    const res = new Response(new ReadableStream({ pull() { read = true; } }), {
      headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
    });
    await expect(readBytes("The test API", res)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(read).toBe(false);
  });

  it("stops reading a streamed body once it passes the cap", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const res = new Response(new ReadableStream({
      pull(controller) { sent += 1; controller.enqueue(chunk); },
    }));
    await expect(readBytes("The test API", res)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(sent).toBeLessThanOrEqual(MAX_RESPONSE_BYTES / chunk.byteLength + 2);
  });

  it("returns a body under the cap intact", async () => {
    const res = new Response("hello");
    expect((await readBytes("The test API", res)).toString()).toBe("hello");
  });
});

describe("failed API responses are errors, not results", () => {
  it.each([
    ["scrapeSite", () => scrapeSite("https://x.test/", "key")],
    ["getScreenshotUrl", () => getScreenshotUrl("https://x.test/", "key")],
    ["getSiteOgData", () => getSiteOgData("https://x.test/", "key")],
  ])("%s rejects a 403 with the reason", async (_name, call) => {
    stubFetch({ ok: false, status: 403, body: { error: { message: "Insufficient credits" } } });
    await expect(call()).rejects.toThrow(/403.*Insufficient credits/);
  });
});

describe("upstream error text", () => {
  it("relays a structured refusal", () => {
    expect(safeUpstreamMessage(403, { error: { message: "User is not a member of this organization" } }))
      .toBe("User is not a member of this organization");
  });

  it.each([
    ["a stack trace", "TypeError: x is undefined\n    at handler (/app/server/controllers/a.js:10:5)"],
    ["a socket error", "connect ECONNREFUSED"],
    ["an internal address", "upstream 10.0.3.4 refused the connection"],
    ["a filesystem path", "cannot open /srv/data/cache.db"],
  ])("drops %s", (_label, message) => {
    expect(safeUpstreamMessage(500, { message })).toBe("Request failed with status 500.");
  });

  it.each([
    ["a one-line stack frame", "boom (/app/server/a.js:1:2)"],
    ["a missing-file error", "ENOENT: no such file, open '/tmp/x'"],
    ["a database error", "SequelizeConnectionError: password authentication failed"],
  ])("drops %s at any status", (_label, message) => {
    expect(safeUpstreamMessage(400, { message })).toBe("Request failed with status 400.");
  });

  it.each([
    ["an internal hostname", "db.svc.cluster.local refused"],
    ["an IPv6 address", "connect to fd00::1:5432 failed"],
  ])("drops %s from a 5xx", (_label, message) => {
    expect(safeUpstreamMessage(502, { message })).toBe("Request failed with status 502.");
  });

  it("keeps an address in a 4xx refusal, where it names what the caller asked for", () => {
    expect(safeUpstreamMessage(400, { message: "Refusing to fetch private address 10.0.0.1" }))
      .toBe("Refusing to fetch private address 10.0.0.1");
  });

  it("keeps a refusal that mentions a time", () => {
    expect(safeUpstreamMessage(429, { message: "Rate limited. Try again at 12:30:45." }))
      .toBe("Rate limited. Try again at 12:30:45.");
  });

  it("caps a long message", () => {
    const out = safeUpstreamMessage(400, { message: "x".repeat(1000) });
    expect(out.length).toBeLessThanOrEqual(301);
  });

  it("never echoes a raw body from the API", async () => {
    stubFetch({ ok: false, status: 502, raw: "<html><body>nginx upstream 10.1.2.3</body></html>", contentType: "text/html" });
    const err = await extractHtmlElements("https://x.test/", ["h1"], "key").catch((e) => e);
    expect(err.message).toMatch(/502/);
    expect(err.message).not.toMatch(/nginx|10\.1\.2\.3|<html/);
  });

  it("never echoes a raw non-JSON markdown error body", async () => {
    stubFetch({ ok: false, status: 500, raw: "Error: boom\n    at x (/app/a.js:1:1)", contentType: "text/plain" });
    const err = await getSiteMarkdown("https://x.test/", "key").catch((e) => e);
    expect(err.message).not.toMatch(/boom|\/app\//);
  });

  it("keeps internal detail from an audit 500 out of the tool result", async () => {
    stubFetch({ ok: false, status: 500, body: { error: { message: "connect ECONNREFUSED 10.0.0.5:5432" } } });
    const tool = new GetSiteAuditStatusTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });

  it("keeps a raw image-agent error page out of the thrown message", async () => {
    stubFetch({ ok: false, status: 502, raw: "<html>Bad gateway at 172.16.0.9</html>", contentType: "text/html" });
    const err = await createSession("s", "key").catch((e) => e);
    expect(err.message).not.toMatch(/<html|172\.16/);
  });
});

describe("IDs are encoded into request paths", () => {
  it("cannot re-route an audit request with a crafted fix item id", async () => {
    stubFetch({ status: 204, raw: "" });
    await deleteFixItem("a1", "../../websites/w1/schedule", "tok");
    expect(seen[0].url).toContain("/audits/a1/fix-items/..%2F..%2Fwebsites%2Fw1%2Fschedule");
  });

  // ".." survives encodeURIComponent and the URL parser resolves it, so
  // fix-items/.. would address DELETE /audits/:id — the whole audit.
  it.each(["..", ".", ""])("refuses %j as an id rather than resolving it", async (id) => {
    stubFetch({ status: 204, raw: "" });
    await expect(deleteFixItem("a1", id, "tok")).rejects.toThrow(/Invalid ID/);
    await expect(getAuditStatus(id, "tok")).rejects.toThrow(/Invalid ID/);
    await expect(getSession(id, "key")).rejects.toThrow(/Invalid ID/);
    expect(seen).toHaveLength(0);
  });

  it("encodes the audit id", async () => {
    stubFetch({ body: { audit: {} } });
    await getAuditStatus("a1/report?x=1", "tok");
    expect(seen[0].url).toContain("/audits/a1%2Freport%3Fx%3D1");
  });

  it("encodes the website id", async () => {
    stubFetch({ body: {} });
    await getSchedule("w1/../../context", "org", "tok");
    expect(seen[0].url).toContain("/websites/w1%2F..%2F..%2Fcontext/schedule");
  });

  it("encodes image session ids", async () => {
    stubFetch({ body: { sessionId: "s", assets: [] } });
    await getSession("s/../../assets", "key");
    expect(seen[0].url).toContain("/sessions/s%2F..%2F..%2Fassets");
  });
});
