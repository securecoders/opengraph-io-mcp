import { describe, it, expect } from "vitest";
import { formatAuditStarted, formatDiscoverResult, PLAN_QUOTAS_URL } from "@/utils/format";
import { SERVER_INSTRUCTIONS } from "@/mcp";

// ChatGPT's plugin review rejects any plugin that promotes upgrades or links to a
// checkout or billing page. The quota messages used to say "upgrade your plan" and
// link to the dashboard billing page; they may only state the limit and point at
// the informational pricing page.
const UPSELL = /upgrade|buy|purchase|top.?up|\/billing|checkout/i;

describe("plan limit messages", () => {
  it("discovery over quota states the limit without an upsell", () => {
    const { markdown } = formatDiscoverResult({
      domain: "example.com",
      totalFound: 40,
      urls: [{ url: "https://example.com/", source: "crawl", depth: 0 }],
      remainingQuota: 5,
    } as any);
    expect(markdown).toContain("**5** more pages");
    expect(markdown).toContain(PLAN_QUOTAS_URL);
    expect(markdown).not.toMatch(UPSELL);
  });

  it("a clamped audit states the limit without an upsell", () => {
    const { markdown } = formatAuditStarted(
      { id: "a1", domain: "example.com", status: "pending", pagesRequested: 3, createdAt: "" } as any,
      { field: "pages", requested: 10, applied: 3, remaining: 3 },
    );
    expect(markdown).toContain("**3 pages remain**");
    expect(markdown).toContain(PLAN_QUOTAS_URL);
    expect(markdown).not.toMatch(UPSELL);
  });

  it("the pricing link is informational, not the dashboard", () => {
    expect(PLAN_QUOTAS_URL).toBe("https://www.opengraph.io/pricing");
  });

  it("server instructions never tell the model to upsell", () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(UPSELL);
  });
});
