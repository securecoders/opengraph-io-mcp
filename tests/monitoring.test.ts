import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ListWebsitesTool from "@/tools/list-websites";
import GetMonitoringScheduleTool from "@/tools/get-monitoring-schedule";
import SetMonitoringScheduleTool from "@/tools/set-monitoring-schedule";
import GetConnectionContextTool from "@/tools/get-connection-context";

interface Call { url: string; method: string; body: any }
let calls: Call[] = [];

function stubFetch(routes: Record<string, { body?: any; ok?: boolean; status?: number }> = {}) {
  globalThis.fetch = (async (input: unknown, init: any) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { body: {}, ok: true };
    const ok = route.ok !== false;
    const status = route.status ?? (ok ? 200 : 500);
    // Mirror a real Response: json() on an empty body throws, which is exactly
    // what a 204 would do to an unguarded parse.
    const raw = status === 204 ? "" : JSON.stringify(route.body ?? {});
    return {
      ok, status, statusText: ok ? "OK" : "Error",
      headers: { get: () => "application/json" },
      json: async () => JSON.parse(raw),
      text: async () => raw,
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => { calls = []; });
afterEach(() => { vi.restoreAllMocks(); });

const paramsOf = (url: string) => new URLSearchParams(url.split("?")[1] ?? "");

const WEBSITES = {
  websites: [
    { id: "w1", displayDomain: "x.test", status: "NEEDS_ATTENTION", currentScore: 71, previousScore: 79,
      criticalIssueCount: 3, regressionCount: 2, nextScheduledAt: "2026-09-20T09:00:00Z" },
  ],
  total: 1,
};

describe("listWebsites", () => {
  it("scopes to the organization from the token", async () => {
    stubFetch({ "/websites": { body: WEBSITES } });
    const tool = new ListWebsitesTool("tok", "org-1");
    await tool.execute(tool.inputSchema.parse({}));
    expect(paramsOf(calls[0].url).get("organizationId")).toBe("org-1");
  });

  it("shows the score trend against the previous audit", async () => {
    stubFetch({ "/websites": { body: WEBSITES } });
    const tool = new ListWebsitesTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({}));
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("71 (-8)");
    expect(text).toContain("Needs attention");
    expect(() => tool.outputSchema.parse(res.structuredContent)).not.toThrow();
  });

  it("fetches one website when websiteId is given, not the list", async () => {
    stubFetch({ "/websites/w1": { body: { website: { id: "w1", displayDomain: "x.test", currentScore: 90 } } } });
    const tool = new ListWebsitesTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ websiteId: "w1" }));

    expect(calls[0].url).toContain("/websites/w1");
    // websiteId must not also leak through as a list filter.
    expect(paramsOf(calls[0].url).has("websiteId")).toBe(false);
    expect(res.structuredContent.website.id).toBe("w1");
  });

  it("tells the user how to get started when there are none", async () => {
    stubFetch({ "/websites": { body: { websites: [], total: 0 } } });
    const tool = new ListWebsitesTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({}));
    expect(res.content.map((c: any) => c.text).join("\n")).toMatch(/startSiteAudit/);
  });
});

describe("getMonitoringSchedule", () => {
  it("reads the schedule with the org as a query parameter", async () => {
    stubFetch({ "/schedule": { body: { schedule: { frequency: "WEEKLY", dayOfWeek: 1, runHour: 9, timezone: "America/New_York" } } } });
    const tool = new GetMonitoringScheduleTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ websiteId: "w1" }));

    expect(calls[0].method).toBe("GET");
    expect(paramsOf(calls[0].url).get("organizationId")).toBe("org-1");
    expect(res.content.map((c: any) => c.text).join("\n")).toContain("America/New_York");
  });

  it("says the site is not monitored rather than showing a blank schedule", async () => {
    stubFetch({ "/schedule": { body: {} } });
    const tool = new GetMonitoringScheduleTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ websiteId: "w1" }));
    expect(res.content.map((c: any) => c.text).join("\n")).toMatch(/Not monitored/);
    expect(res.structuredContent.schedule).toBeNull();
  });
});

describe("setMonitoringSchedule", () => {
  it("sends organizationId in the body, where the gateway reads it", async () => {
    // Sibling reads take it as a query parameter; this route does not.
    stubFetch({ "/schedule": { body: { schedule: { frequency: "WEEKLY" } } } });
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    await tool.execute(tool.inputSchema.parse({ websiteId: "w1", frequency: "WEEKLY" }));

    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body.organizationId).toBe("org-1");
    expect(calls[0].body.frequency).toBe("WEEKLY");
  });

  it("disabling issues a DELETE, not a PUT carrying enabled:false", async () => {
    stubFetch({ "/schedule": { status: 204 } });
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ websiteId: "w1", enabled: false }));

    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].body).toBeUndefined();
    expect(paramsOf(calls[0].url).get("organizationId")).toBe("org-1");
    // A 204 has no body — parsing it as JSON would throw.
    expect(res.structuredContent.enabled).toBe(false);
    expect(res.structuredContent.schedule).toBeNull();
  });

  it("refuses to both delete and configure in one call", async () => {
    // enabled:false deletes; any other field would be silently dropped — and
    // `paused` in particular means the caller wanted the config kept.
    stubFetch();
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({
      websiteId: "w1", enabled: false, paused: true,
    }));
    expect(JSON.stringify(res)).toMatch(/would be discarded/);
    expect(JSON.stringify(res)).toMatch(/paused: true/);
    expect(calls).toHaveLength(0);
  });

  it("warns that disabling destroys the configuration", async () => {
    stubFetch({ "/schedule": { status: 204 } });
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ websiteId: "w1", enabled: false }));
    expect(res.content.map((c: any) => c.text).join("\n")).toMatch(/Re-enabling means setting/i);
  });

  it("never forwards alert recipients", () => {
    // Recurring alerts mail real people; the gateway rejects the field on a
    // bearer connection, so the tool must not offer it either.
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    const props = Object.keys((tool.toToolType().inputSchema as any).properties ?? {});
    expect(props).not.toContain("recipients");
    expect(props).not.toContain("organizationId");
  });

  it("is annotated destructive so clients prompt before running it", () => {
    const tool = new SetMonitoringScheduleTool();
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(tool.annotations.readOnlyHint).toBe(false);
  });

  it("refuses to enable without a frequency, before calling the gateway", async () => {
    stubFetch();
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ websiteId: "w1" }));
    expect(JSON.stringify(res)).toMatch(/frequency is required/i);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a plan-entitlement refusal verbatim", async () => {
    stubFetch({ "/schedule": { ok: false, status: 403,
      body: { error: { code: "FEATURE_NOT_ALLOWED", message: "Your plan does not include scheduled Site Audit monitoring." } } } });
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    const res: any = await tool.execute(tool.inputSchema.parse({ websiteId: "w1", frequency: "WEEKLY" }));
    expect(JSON.stringify(res)).toContain("does not include scheduled Site Audit monitoring");
  });

  it("passes anchored timing through", async () => {
    stubFetch({ "/schedule": { body: { schedule: {} } } });
    const tool = new SetMonitoringScheduleTool("tok", "org-1");
    await tool.execute(tool.inputSchema.parse({
      websiteId: "w1", frequency: "WEEKLY", dayOfWeek: 1, runHour: 9, runMinute: 30,
      timezone: "Europe/London", paused: true,
    }));
    expect(calls[0].body).toMatchObject({
      frequency: "WEEKLY", dayOfWeek: 1, runHour: 9, runMinute: 30,
      timezone: "Europe/London", paused: true,
    });
    expect(calls[0].body.enabled).toBeUndefined();
  });
});

describe("getConnectionContext", () => {
  it("names the organization and splits available from unavailable features", async () => {
    stubFetch({ "/context": { body: {
      organizationId: "org-1", organizationName: "Org One",
      entitlements: { siteAudit: true, siteAuditScheduling: false, siteAuditPdfExport: true, linkPreview: false },
    } } });
    const tool = new GetConnectionContextTool("tok");
    const res: any = await tool.execute();
    const text = res.content.map((c: any) => c.text).join("\n");

    expect(text).toContain("Org One");
    expect(text).toMatch(/Available: siteAudit, siteAuditPdfExport/);
    expect(text).toMatch(/Not on this plan: siteAuditScheduling, linkPreview/);
    // The one-org-per-connection constraint has to be stated, or an agent
    // reads an empty list as "no data" rather than "wrong org".
    expect(text).toMatch(/reconnect/i);
    expect(() => tool.outputSchema.parse(res.structuredContent)).not.toThrow();
  });

  it("takes no arguments", () => {
    const tool = new GetConnectionContextTool("tok");
    expect(Object.keys((tool.toToolType().inputSchema as any).properties ?? {})).toHaveLength(0);
  });
});
