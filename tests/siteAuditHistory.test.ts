import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ListSiteAuditsTool from "@/tools/list-site-audits";
import GetSiteAuditChangesTool from "@/tools/get-site-audit-changes";

let calls: string[] = [];

/** Routes each request to a body keyed by a substring of its path. */
function stubFetch(routes: Record<string, { body?: any; ok?: boolean; status?: number }>) {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { body: {}, ok: true };
    const ok = route.ok !== false;
    return {
      ok, status: route.status ?? (ok ? 200 : 500), statusText: ok ? "OK" : "Error",
      headers: { get: () => "application/json" },
      json: async () => route.body ?? {},
      text: async () => JSON.stringify(route.body ?? {}),
    };
  }) as unknown as typeof fetch;
}

const AUDITS = {
  audits: [
    { id: "a1", domain: "x.test", status: "COMPLETE", score: 82, totalIssues: 7, pagesRequested: 10, createdAt: "2026-09-01T00:00:00Z", completedAt: "2026-09-01T00:05:00Z" },
    { id: "a2", domain: "y.test", status: "FAILED", pagesRequested: 5, createdAt: "2026-08-20T00:00:00Z" },
  ],
  total: 12, limit: 2, offset: 0,
};

const DIFF = {
  auditId: "a1", baselineAuditId: "a0", scoreDelta: -4,
  new: [{ pageKey: "/pricing", issueCode: "MISSING_OG_IMAGE", severity: "critical" }],
  regressed: [{ pageKey: "/", issueCode: "TITLE_TOO_LONG", severity: "warning" }],
  fixed: [], existing: [], unchanged: [], pageGone: [], deprecated: [],
  pagesAdded: ["/new"], pagesRemoved: [],
};

const PRIORITIES = {
  groups: {
    fix_first: [{ pageKey: "/", issueCode: "MISSING_OG_IMAGE", severity: "critical", patternCount: 1 }],
    fix_as_pattern: [{ pageKey: "/a", issueCode: "NO_DESCRIPTION", severity: "warning", patternCount: 4 }],
    review_next: [], low_priority: [],
  },
  counts: { fix_first: 1, fix_as_pattern: 1, review_next: 0, low_priority: 0 },
};

beforeEach(() => { calls = []; });
afterEach(() => { vi.restoreAllMocks(); });

const paramsOf = (url: string) => new URLSearchParams(url.split("?")[1] ?? "");

describe("listSiteAudits", () => {
  it("always scopes to the organization from the token", async () => {
    // The gateway answers 400 MISSING_ORG_ID without it, and the org must come
    // from the token rather than from anything the agent supplies.
    stubFetch({ "/audits": { body: AUDITS } });
    const tool = new ListSiteAuditsTool("tok", "org-1");
    await tool.execute(tool.inputSchema.parse({}));
    expect(paramsOf(calls[0]).get("organizationId")).toBe("org-1");
  });

  it("does not accept an organizationId from the caller", () => {
    const tool = new ListSiteAuditsTool("tok", "org-1");
    const parsed: any = tool.inputSchema.parse({ organizationId: "org-2" } as any);
    expect(parsed.organizationId).toBeUndefined();
    expect(Object.keys((tool.toToolType().inputSchema as any).properties ?? {}))
      .not.toContain("organizationId");
  });

  it("comma-joins a status filter and omits unset filters", async () => {
    stubFetch({ "/audits": { body: AUDITS } });
    const tool = new ListSiteAuditsTool("tok", "org-1");
    await tool.execute(tool.inputSchema.parse({ status: ["COMPLETE", "FAILED"], limit: 2 }));
    const p = paramsOf(calls[0]);
    expect(p.get("status")).toBe("COMPLETE,FAILED");
    expect(p.get("limit")).toBe("2");
    expect(p.has("q")).toBe(false);
    expect(p.has("websiteId")).toBe(false);
  });

  it("renders the audits and reports the page window", async () => {
    stubFetch({ "/audits": { body: AUDITS } });
    const tool = new ListSiteAuditsTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({}));
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("a1");
    expect(text).toContain("x.test");
    expect(text).toContain("1–2 of 12");
    expect(() => tool.outputSchema.parse(res.structuredContent)).not.toThrow();
  });

  it("says nothing matched rather than showing an empty table", async () => {
    stubFetch({ "/audits": { body: { audits: [], total: 0 } } });
    const tool = new ListSiteAuditsTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ q: "nope" }));
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toMatch(/No audits matched/);
    expect(text).toContain("q: nope");
  });

  it("asks the user to reconnect when unauthenticated", async () => {
    const tool = new ListSiteAuditsTool("", "");
    const res: any = await tool.execute(tool.inputSchema.parse({}));
    expect(JSON.stringify(res)).toMatch(/reconnect/i);
    expect(calls).toHaveLength(0);
  });

  it("asks the user to reconnect when the token carries no organization", async () => {
    const tool = new ListSiteAuditsTool("tok", "");
    const res: any = await tool.execute(tool.inputSchema.parse({}));
    expect(JSON.stringify(res)).toMatch(/reconnect/i);
    expect(calls).toHaveLength(0);
  });
});

describe("getSiteAuditChanges", () => {
  it("fetches the change report and priorities together", async () => {
    stubFetch({ "/diff": { body: DIFF }, "/priorities": { body: PRIORITIES } });
    const tool = new GetSiteAuditChangesTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));

    expect(calls.some((u) => u.includes("/diff"))).toBe(true);
    expect(calls.some((u) => u.includes("/priorities"))).toBe(true);
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("score -4");
    expect(text).toContain("TITLE_TOO_LONG");
    expect(text).toContain("Fix as a pattern");
    expect(text).toMatch(/on 4 pages/);
    expect(() => tool.outputSchema.parse(res.structuredContent)).not.toThrow();
  });

  it("passes an explicit baseline through", async () => {
    stubFetch({ "/diff": { body: DIFF }, "/priorities": { body: PRIORITIES } });
    const tool = new GetSiteAuditChangesTool("tok");
    await tool.execute(tool.inputSchema.parse({ auditId: "a1", baseline: "a0" }));
    const diffCall = calls.find((u) => u.includes("/diff"))!;
    expect(paramsOf(diffCall).get("baseline")).toBe("a0");
  });

  it("still returns the change report when prioritization fails", async () => {
    // Two independent reads — losing both to one failure would be worse than
    // returning half the answer with the gap named.
    stubFetch({ "/diff": { body: DIFF }, "/priorities": { ok: false, status: 500 } });
    const tool = new GetSiteAuditChangesTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    const text = res.content.map((c: any) => c.text).join("\n");

    expect(text).toContain("TITLE_TOO_LONG");
    expect(text).toMatch(/Prioritization unavailable/);
    expect(res.structuredContent.priorities).toBeNull();
  });

  it("still returns priorities when the change report fails", async () => {
    stubFetch({ "/diff": { ok: false, status: 500 }, "/priorities": { body: PRIORITIES } });
    const tool = new GetSiteAuditChangesTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    const text = res.content.map((c: any) => c.text).join("\n");

    expect(text).toMatch(/Change report unavailable/);
    expect(text).toContain("Fix first");
    expect(res.structuredContent.diff).toBeNull();
  });

  it("reports an error when both halves fail", async () => {
    stubFetch({ "/diff": { ok: false, status: 500 }, "/priorities": { ok: false, status: 500 } });
    const tool = new GetSiteAuditChangesTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/Fix first/);
  });

  it("asks the user to reconnect when unauthenticated", async () => {
    const tool = new GetSiteAuditChangesTool("");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    expect(JSON.stringify(res)).toMatch(/reconnect/i);
    expect(calls).toHaveLength(0);
  });
});
