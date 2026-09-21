import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveTool, registeredToolNames } from "@/tools/registry";
import { ToolNames } from "@/tools/constants";

// Resolving through the registry — rather than constructing tools directly —
// is what makes this cover credential threading: a swapped or dropped argument
// in a registry entry shows up here as a missing token or org.
const CTX = { appId: "APPID", organizationId: "ORG", accessToken: "TOKEN", isLocal: false };

interface Seen { url: string; method: string; auth?: string; body: any }
let seen: Seen[] = [];

function stubFetch() {
  globalThis.fetch = (async (input: unknown, init: any) => {
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: init?.headers?.Authorization,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return {
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => ({}),
      text: async () => "{}",
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => { seen = []; stubFetch(); });
afterEach(() => { vi.restoreAllMocks(); });

// [tool, args, method, path fragment, needs org in the request]
const WIRING: Array<[ToolNames, Record<string, unknown>, string, string, boolean]> = [
  [ToolNames.LIST_SITE_AUDITS,        {},                                    "GET",    "/site-audit/audits?",                   true],
  [ToolNames.LIST_WEBSITES,           {},                                    "GET",    "/site-audit/websites?",                 true],
  [ToolNames.LIST_WEBSITES,           { websiteId: "w1" },                   "GET",    "/site-audit/websites/w1",               true],
  [ToolNames.GET_MONITORING_SCHEDULE, { websiteId: "w1" },                   "GET",    "/site-audit/websites/w1/schedule",      true],
  [ToolNames.SET_MONITORING_SCHEDULE, { websiteId: "w1", frequency: "WEEKLY" }, "PUT", "/site-audit/websites/w1/schedule",      true],
  [ToolNames.GET_CONNECTION_CONTEXT,  {},                                    "GET",    "/site-audit/context",                   false],
  [ToolNames.LIST_FIX_ITEMS,          { auditId: "a1" },                     "GET",    "/site-audit/audits/a1/fix-items",       false],
  [ToolNames.SAVE_FIX_ITEMS,          { auditId: "a1", pageUrl: "https://x.test/", items: [{ field: "title", proposedValue: "New" }] },
                                                                              "POST",   "/site-audit/audits/a1/fix-items",       false],
  [ToolNames.DELETE_FIX_ITEM,         { auditId: "a1", fixItemId: "f1" },    "DELETE", "/site-audit/audits/a1/fix-items/f1",    false],
  [ToolNames.EXPORT_FIX_ITEMS_CSV,    { auditId: "a1" },                     "GET",    "/site-audit/audits/a1/fix-items/export.csv", false],
  [ToolNames.DELETE_SITE_AUDIT,       { auditId: "a1" },                     "DELETE", "/site-audit/audits/a1",                 false],
  [ToolNames.EMAIL_SITE_AUDIT_REPORT, { auditId: "a1" },                     "POST",   "/site-audit/audits/a1/email",           false],
  [ToolNames.START_SITE_AUDIT,        { domain: "x.test" },                  "POST",   "/site-audit/audits",                    true],
  [ToolNames.DISCOVER_SITE_URLS,      { domain: "https://x.test/" },         "POST",   "/site-audit/discover",                  true],
  [ToolNames.GET_SITE_AUDIT_STATUS,   { auditId: "a1" },                     "GET",    "/site-audit/audits/a1",                 false],
  [ToolNames.GET_SITE_AUDIT_REPORT,   { auditId: "a1" },                     "GET",    "/site-audit/audits/a1/report",          false],
];

describe("site-audit tool wiring", () => {
  WIRING.forEach(([name, args, method, path, needsOrg]) => {
    it(`${name} calls ${method} ${path} with the session's credentials`, async () => {
      const tool = resolveTool(name, CTX);
      await tool.execute(tool.inputSchema.parse(args));

      expect(seen.length, `${name} made no request`).toBeGreaterThan(0);
      const call = seen.find((c) => c.url.includes(path)) ?? seen[0];
      expect(call.url, `${name} wrong path`).toContain(path);
      expect(call.method, `${name} wrong method`).toBe(method);
      // A registry entry that swapped or dropped the token shows up here.
      expect(call.auth, `${name} missing bearer`).toBe("Bearer TOKEN");

      if (needsOrg) {
        const inQuery = new URLSearchParams(call.url.split("?")[1] ?? "").get("organizationId");
        expect(inQuery ?? call.body?.organizationId, `${name} missing org`).toBe("ORG");
      }
    });
  });

  it("getSiteAuditChanges fetches both halves with the same credentials", async () => {
    const tool = resolveTool(ToolNames.GET_SITE_AUDIT_CHANGES, CTX);
    await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));

    expect(seen.map((c) => c.url).some((u) => u.includes("/audits/a1/diff"))).toBe(true);
    expect(seen.map((c) => c.url).some((u) => u.includes("/audits/a1/priorities"))).toBe(true);
    seen.forEach((c) => expect(c.auth).toBe("Bearer TOKEN"));
  });

  it("keeps the token's organization even if one is smuggled through args", async () => {
    // Tenant pinning must not depend on zod stripping the key — the client puts
    // organizationId last so it wins regardless.
    const tool = resolveTool(ToolNames.LIST_SITE_AUDITS, CTX);
    await tool.execute({ ...tool.inputSchema.parse({}), organizationId: "ORG-ATTACKER" } as any);
    expect(new URLSearchParams(seen[0].url.split("?")[1]).get("organizationId")).toBe("ORG");
  });

  it("every registered tool resolves and carries an execute()", () => {
    for (const name of registeredToolNames) {
      const tool = resolveTool(name, CTX);
      expect(tool.name, `${name} resolved to the wrong tool`).toBe(name);
      expect(typeof tool.execute).toBe("function");
    }
  });
});
