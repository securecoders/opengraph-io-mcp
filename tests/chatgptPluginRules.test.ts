import { describe, it, expect, afterEach } from "vitest";
import { formatMarkdown, formatOgData } from "@/utils/format";
import { getSiteOgData, pickRequestInfo } from "@/utils/og";
import { toolDefinitions } from "@/tools/registry";
import GetOgMarkdownTool from "@/tools/get-og-markdown";
import PreviewPageAuditTool from "@/tools/preview-page-audit";
import GetSiteAuditReportTool from "@/tools/get-site-audit-report";
import Ajv from "ajv";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "@/mcp";
import { setAuthContext, deleteAppId } from "@/utils/sessionIdToAppId";
import { ToolNames } from "@/tools/constants";

// Rules from developers.openai.com/plugins/plugin-guidelines (checked 2026-11-10)
// that the server itself has to satisfy, beyond what the plugin package declares.

// openWorldHint is false for tools bounded to the caller's own account, even
// though the data is hosted remotely; true only where the target is an arbitrary
// site. A mismatch is flagged in review.
describe("openWorldHint", () => {
  const OPEN_WORLD = new Set([
    "getOgData", "getOgScrapeData", "getOgScreenshot", "getOgQuery", "getOgExtract",
    "getOgMarkdown", "getBrandIntelligence", "discoverSiteUrls",
    "startSiteAudit", "previewPageAudit", "getLinkPreview",
  ]);

  it.each(toolDefinitions.map((t) => [t.name, t]))("%s is labelled for its reach", (name, tool) => {
    const a = (tool as any).annotations;
    expect(typeof a.readOnlyHint).toBe("boolean");
    expect(typeof a.destructiveHint).toBe("boolean");
    expect(a.openWorldHint).toBe(OPEN_WORLD.has(name as string));
  });
});

describe("response minimization", () => {
  it("does not return the upstream request id", () => {
    const { structured } = formatMarkdown("https://x.test/", { markdown: "# Hi", request_id: "req-1" } as any);
    expect(structured).not.toHaveProperty("request_id");
    expect((new GetOgMarkdownTool() as any).outputSchema.shape).not.toHaveProperty("request_id");
  });

  // og-api merges its whole options object into requestInfo, so the raw block
  // carries the caller's organization, plan, limits and usage counters.
  const RAW_REQUEST_INFO = {
    responseCode: 200, redirects: 1, host: "https://x.test/",
    responseContentType: "text/html", responseLength: "512",
    organizationId: "org-1", _clientInfo: { planId: "plan-1" }, requests_limit: "100",
  };
  const PAGE_FACTS = {
    responseCode: 200, redirects: 1, host: "https://x.test/",
    responseContentType: "text/html", responseLength: "512",
  };

  it("keeps only page facts from requestInfo", () => {
    expect(pickRequestInfo(RAW_REQUEST_INFO)).toEqual(PAGE_FACTS);
    expect(pickRequestInfo(RAW_REQUEST_INFO, true)).toEqual({ ...PAGE_FACTS, is_cache: true });
    expect(pickRequestInfo(undefined)).toBeUndefined();
  });

  describe("getSiteOgData", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });

    function stubSite(body: unknown) {
      globalThis.fetch = (async () => ({
        ok: true, status: 200, statusText: "OK",
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify(body),
      })) as unknown as typeof fetch;
    }

    it("returns page facts and the top level cache flag, never the account block", async () => {
      stubSite({ hybridGraph: { title: "Hi" }, openGraph: {}, htmlInferred: {}, is_cache: true, requestInfo: RAW_REQUEST_INFO });
      const data = await getSiteOgData("https://x.test/", "key");
      expect(data.requestInfo).toEqual({ ...PAGE_FACTS, is_cache: true });
      const { markdown, structured } = formatOgData("https://x.test/", data);
      expect(markdown).toContain("cached");
      expect(JSON.stringify(structured)).not.toMatch(/org-1|plan-1|requests_limit/);
    });

    it("labels a fresh fetch", async () => {
      stubSite({ hybridGraph: {}, openGraph: {}, htmlInferred: {}, is_cache: false, requestInfo: RAW_REQUEST_INFO });
      const { markdown } = formatOgData("https://x.test/", await getSiteOgData("https://x.test/", "key"));
      expect(markdown).toContain("fresh");
    });
  });
});

// Every published output schema says additionalProperties: false, and ChatGPT
// rejects a result that breaks it with INVALID_ARGUMENT. previewPageAudit and
// getSiteAuditReport passed the upstream reply through whole, so the extra
// fields og-site-audit sends (rationale, raw graphs, its own og-api requestInfo)
// failed every call in ChatGPT.
describe("results match the schema each tool publishes", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  function stubJson(body: unknown) {
    globalThis.fetch = (async () => ({
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => "application/json" },
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch;
  }

  function validate(tool: any, structured: unknown) {
    const ajv = new Ajv({ strict: false });
    const check = ajv.compile(tool.toToolType().outputSchema);
    return check(structured) ? null : check.errors;
  }

  // og-site-audit/server/controllers/preview.ts
  const PREVIEW_REPLY = {
    url: "https://x.test/", score: 72, scoreLabel: "Good",
    rationale: { summary: "why" },
    checks: { og_title: { status: "pass", points: 10 } },
    issues: [{ severity: "high", code: "og_image_missing", message: "No og:image" }],
    previews: { facebook: { title: "X" } },
    hybridGraph: { title: "X" }, openGraph: { title: "X" }, htmlInferred: {},
    requestInfo: { organizationId: "internal-org", requests_limit: "100" },
  };

  // og-site-audit/server/services/reportBuilder.ts
  const REPORT_REPLY = {
    report: {
      auditId: "a1", domain: "x.test", score: 80, status: "COMPLETE",
      pagesAudited: 1, pagesFetched: 1, createdAt: "2026-11-19T00:00:00Z", completedAt: null,
      tierSnapshot: { maxPages: 50 }, aiSiteOverview: null,
      summary: { totalIssues: 1, criticalIssues: 0, warningIssues: 1, passedChecks: 9 },
      pages: [{
        id: "p1", url: "https://x.test/", normalizedUrl: "x.test/", pageTitle: "X", score: 80,
        crawlOrder: 0, screenshotUrl: null, issues: [], previews: {}, aiAnalysis: null,
        fetchedAt: "2026-11-19T00:00:00Z",
      }],
    },
  };

  it.each([
    ["previewPageAudit", () => new PreviewPageAuditTool("tok", "org-1"), { url: "https://x.test/" }, PREVIEW_REPLY],
    ["getSiteAuditReport", () => new GetSiteAuditReportTool("tok"), { auditId: "a1" }, REPORT_REPLY],
  ])("%s", async (_name, make, args, reply) => {
    stubJson(reply);
    const tool: any = make();
    const raw = await tool.execute(tool.inputSchema.parse(args));
    expect(raw.isError).toBeFalsy();
    expect(validate(tool, raw.structuredContent)).not.toBeNull();

    const sent = tool.conformOutput(raw);
    expect(validate(tool, sent.structuredContent)).toBeNull();
    expect(JSON.stringify(sent.structuredContent)).not.toMatch(/internal-org|requests_limit/);
    expect(sent.content).toEqual(raw.content);
  });

  it("is applied to every call the server dispatches", async () => {
    stubJson(PREVIEW_REPLY);
    const SID = "conform-session";
    setAuthContext(SID, { appId: "", accessToken: "tok", organizationId: "org-1" });
    const { server, cleanup } = createServer({ local: false });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    (serverT as any).sessionId = SID;
    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([client.connect(clientT), (server as any).connect(serverT)]);
    try {
      await client.listTools();
      const res: any = await client.callTool({ name: ToolNames.PREVIEW_PAGE_AUDIT, arguments: { url: "https://x.test/" } });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent.score).toBe(72);
      expect(res.structuredContent).not.toHaveProperty("rationale");
      expect(res.structuredContent).not.toHaveProperty("requestInfo");
    } finally {
      await cleanup().catch(() => {});
      deleteAppId(SID);
    }
  });

  it("leaves an error result alone", () => {
    const tool: any = new PreviewPageAuditTool("tok", "org-1");
    const err = { content: [{ type: "text", text: "failed" }], isError: true };
    expect(tool.conformOutput(err)).toBe(err);
  });
});
