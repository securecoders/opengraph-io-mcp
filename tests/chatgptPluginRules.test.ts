import { describe, it, expect, afterEach } from "vitest";
import { upstreamDetail, safeUpstreamMessage } from "@/utils/http";
import { formatMarkdown } from "@/utils/format";
import { getSiteOgData, getSiteMarkdown, pickRequestInfo } from "@/utils/og";
import { getAuditStatus } from "@/utils/site-audit-api";
import { getSession } from "@/utils/og-image-api";
import { toolDefinitions } from "@/tools/registry";
import GetOgMarkdownTool from "@/tools/get-og-markdown";
import { SERVER_INSTRUCTIONS } from "@/mcp";

// Rules from developers.openai.com/plugins/plugin-guidelines (checked 2026-11-10)
// that the server itself has to satisfy, beyond what the plugin package declares.

const UPSELL = /upgrade|buy|purchase|top.?up|checkout|subscribe|more credits/i;

// Every plan or limit message that ends in an upsell, copied from apifur-api
// (controllers/siteAudit, linkPreview, templates, organizations; services/apiKeys,
// toolCharges), og-api (middleware/options.js) and og-image-generator (aiImageGen,
// templates) on 2026-11-10. They exist for the dashboard, where the upgrade prompt
// is wanted; passed through verbatim, ChatGPT review rejects the plugin. If one of
// these services adds new wording, add it here.
const UPSTREAM_PLAN_ERRORS = [
  "You are out of credits. Buy more credits to continue.",
  "You have reached the AI template builder limit for the current period. Please upgrade your plan to continue.",
  "You have reached the limit for this feature in the current period. Please upgrade your plan to continue.",
  "You have reached the limit of images you can generate in a month. Please upgrade your plan to continue.",
  "You have reached the limit of requests you can make in a month. Please upgrade your plan to continue.",
  "You have reached the Link Preview limit for the current period. Please upgrade your plan to continue.",
  "You have reached the maximum number of allowed pending invitations for this organization. Upgrade your plan to add more users.",
  "You have reached the maximum number of allowed users for this organization. Upgrade your plan to add more users.",
  "You have reached the Open Graph Audit limit for the current period. Please upgrade your plan to continue.",
  "You have reached the template render limit for the current period. Please upgrade your plan to continue.",
  "You have reached your AI image generation limit for this period. Please upgrade your plan to continue.",
  "You have reached your image generation limit for this billing period. Please upgrade your plan to continue.",
  "You have used all the credits in your plan for this period. Please upgrade your plan to continue.",
  "Your current plan does not include the AI sanitize feature. Please upgrade your plan to use this feature.",
  "Your current plan does not include the auto render feature. Please upgrade your plan to use this feature.",
  "Your current plan does not include the retry feature. Please upgrade your plan to use this feature.",
  "Your current plan does not include the screenshot feature. Please upgrade your plan to use this feature.",
  "Your current plan does not include this AI feature. Please contact support to upgrade your plan.",
  "Your current plan does not include this proxy feature. Please upgrade your plan to use this feature.",
  "Your plan does not include Link Preview. Upgrade to enable this feature.",
  "Your plan does not include Open Graph Audit. Upgrade to enable this feature.",
];

describe("upstream plan errors", () => {
  it.each(UPSTREAM_PLAN_ERRORS)("keeps the limit and drops the upsell: %s", (message) => {
    const firstSentence = message.slice(0, message.indexOf(". ") + 1);
    expect(upstreamDetail({ error: { message } }, 403)).toBe(firstSentence);
  });

  it.each([
    ["purchase", "Limit reached. Purchase a larger plan."],
    ["top up", "Limit reached. Top up your balance."],
    ["checkout", "Limit reached. Continue to checkout."],
    ["subscribe", "Limit reached. Subscribe to Pro for more."],
    ["add credits", "Limit reached. Add credits to continue."],
  ])("drops a %s sentence", (_word, message) => {
    expect(upstreamDetail({ message }, 402)).toBe("Limit reached.");
  });

  it("leaves a message with no upsell unchanged", () => {
    expect(upstreamDetail({ message: "Rate limit exceeded" }, 429)).toBe("Rate limit exceeded");
  });

  // The first version split on every dot, so a hostname was cut in half and a
  // URL containing "buy" or "checkout" lost the sentence it was in.
  it.each([
    "Failed to fetch https://example.com/buy-now. Upstream 404.",
    "Blocked private address buy.example.com. Use a public URL.",
    "Could not reach https://shop.test/checkout. Try again later.",
  ])("does not mangle URLs or hostnames: %s", (message) => {
    expect(upstreamDetail({ message }, 400)).toBe(message);
  });

  it("drops an upsell sentence that has no closing punctuation", () => {
    expect(upstreamDetail({ message: "Limit reached; please upgrade your plan" }, 403)).toBe("Limit reached;");
  });

  it("falls back to the status when only an upsell was sent", () => {
    expect(safeUpstreamMessage(402, { message: "Please upgrade your plan." })).toBe("Request failed with status 402.");
  });
});

// The filter only helps if every client actually routes errors through it.
describe("upsells never reach a thrown error", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  const BODY = { error: { code: "RATE_LIMITED", message: "You have used all the credits in your plan for this period. Please upgrade your plan to continue." } };

  function stub403() {
    globalThis.fetch = (async () => ({
      ok: false, status: 403, statusText: "Forbidden",
      headers: { get: () => "application/json" },
      json: async () => BODY,
      text: async () => JSON.stringify(BODY),
    })) as unknown as typeof fetch;
  }

  it.each([
    ["OG data", () => getSiteOgData("https://x.test/", "key")],
    ["Markdown", () => getSiteMarkdown("https://x.test/", "key", {})],
    ["Open Graph Audit", () => getAuditStatus("a1", "token")],
    ["image generation", () => getSession("s1", "key")],
  ])("%s", async (_name, call) => {
    stub403();
    const err = await call().then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain("You have used all the credits");
    expect(err!.message).not.toMatch(UPSELL);
  });
});

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

describe("model facing text", () => {
  it("never tells the model to upsell", () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(UPSELL);
    for (const tool of toolDefinitions) {
      expect(`${tool.name}: ${tool.description}`).not.toMatch(UPSELL);
    }
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
  it("keeps only page facts from requestInfo", () => {
    const raw = {
      is_cache: false, responseCode: 200, redirects: 1, host: "https://x.test/",
      responseContentType: "text/html", responseLength: "512",
      organizationId: "org-1", _clientInfo: { planId: "plan-1" }, requests_limit: "100",
      isFreeTier: true, aiRequestCost: 50, api_request_count_proxy: "3", requestCount: 1,
    };
    expect(pickRequestInfo(raw)).toEqual({
      is_cache: false, responseCode: 200, redirects: 1, host: "https://x.test/",
      responseContentType: "text/html", responseLength: "512",
    });
    expect(pickRequestInfo(undefined)).toBeUndefined();
  });
});
