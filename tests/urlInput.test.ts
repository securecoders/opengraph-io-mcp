import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { httpUrl, isUnderDomain, siteDomain, MAX_AUDIT_PAGES } from "@/utils/urlInput";
import StartSiteAuditTool from "@/tools/start-site-audit";
import GetOgDataTool from "@/tools/get-og-data";
import DiscoverSiteUrlsTool from "@/tools/discover-site-urls";

// Scheme, page bound and URLs under the audited domain.
// apifur-api enforces all three for audits; checking here first refuses a
// non-http URL on every tool and names off-domain URLs instead of a bare 400.

const guard = globalThis.fetch;
let bodies: any[] = [];

beforeEach(() => {
  bodies = [];
  globalThis.fetch = (async (_input: unknown, init: any) => {
    bodies.push(init?.body ? JSON.parse(init.body) : undefined);
    return {
      ok: true, status: 202, statusText: "Accepted",
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify({ audit: { id: "a1", domain: "example.test", status: "QUEUED", pagesRequested: 1, createdAt: "" } }),
    };
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = guard; });

describe("httpUrl", () => {
  it.each(["javascript:alert(1)", "file:///etc/passwd", "ftp://x.test/", "data:text/html,hi"])(
    "refuses %s",
    (value) => { expect(httpUrl().safeParse(value).success).toBe(false); },
  );

  it.each(["https://x.test/", "http://x.test/a?b=1"])("accepts %s", (value) => {
    expect(httpUrl().safeParse(value).success).toBe(true);
  });

  it("refuses a non-http URL on a data tool", () => {
    expect(() => new GetOgDataTool().inputSchema.parse({ url: "file:///etc/passwd" })).toThrow();
  });
});

describe("siteDomain", () => {
  it.each(["example.test", "https://example.test", "www.example.test/path", "localhost:3000"])(
    "accepts %s",
    (value) => { expect(siteDomain().safeParse(value).success).toBe(true); },
  );

  it.each(["javascript:alert(1)", "file:///etc", "", "ftp://example.test"])("refuses %s", (value) => {
    expect(siteDomain().safeParse(value).success).toBe(false);
  });

  it("is applied to discoverSiteUrls", () => {
    expect(() => new DiscoverSiteUrlsTool().inputSchema.parse({ domain: "file:///etc" })).toThrow();
  });
});

describe("isUnderDomain", () => {
  it.each([
    ["https://example.test/a", "example.test"],
    ["https://www.example.test/a", "https://example.test"],
    ["http://example.test/", "www.example.test"],
  ])("%s is on %s", (url, domain) => { expect(isUnderDomain(url, domain)).toBe(true); });

  it.each([
    ["https://other.test/", "example.test"],
    ["https://example.test.evil.test/", "example.test"],
    ["https://blog.example.test/", "example.test"],
  ])("%s is not on %s", (url, domain) => { expect(isUnderDomain(url, domain)).toBe(false); });
});

describe("startSiteAudit", () => {
  const tool = () => new StartSiteAuditTool("tok", "org-1");

  it("still takes a bare domain", async () => {
    const t = tool();
    const res: any = await t.execute(t.inputSchema.parse({ domain: "example.test" }));
    expect(res.isError).toBeFalsy();
    expect(bodies[0].domain).toBe("example.test");
  });

  it("refuses off-domain URLs before calling the gateway, and names them", async () => {
    const t = tool();
    const res: any = await t.execute(t.inputSchema.parse({
      domain: "example.test",
      urls: ["https://example.test/a", "https://other.test/b"],
    }));
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).toContain("https://other.test/b");
    expect(bodies).toHaveLength(0);
  });

  it("refuses a non-http URL in the list", () => {
    expect(() => tool().inputSchema.parse({ domain: "example.test", urls: ["file:///etc/passwd"] })).toThrow();
  });

  it("never derives a page count above the audit ceiling", async () => {
    const urls = Array.from({ length: MAX_AUDIT_PAGES + 100 }, (_, i) => `https://example.test/p${i}`);
    const t = tool();
    await t.execute(t.inputSchema.parse({ domain: "example.test", urls }));
    expect(bodies[0].pagesRequested).toBe(MAX_AUDIT_PAGES);
    expect(bodies[0].urls).toHaveLength(MAX_AUDIT_PAGES + 100);
  });
});
