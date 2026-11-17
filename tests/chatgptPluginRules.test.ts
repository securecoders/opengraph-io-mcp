import { describe, it, expect, afterEach } from "vitest";
import { formatMarkdown, formatOgData } from "@/utils/format";
import { getSiteOgData, pickRequestInfo } from "@/utils/og";
import { toolDefinitions } from "@/tools/registry";
import GetOgMarkdownTool from "@/tools/get-og-markdown";

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
