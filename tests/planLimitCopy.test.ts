import { describe, it, expect } from "vitest";
import { formatAuditStarted, formatDiscoverResult, PLAN_QUOTAS_URL } from "@/utils/format";

// ChatGPT's plugin review rejects any plugin that promotes upgrades or links to a
// checkout or billing page, so quota messages state the limit and point at the
// informational pricing page.

describe("plan limit messages", () => {
  it("discovery over quota states the limit and links the plan quotas", () => {
    const { markdown } = formatDiscoverResult({
      domain: "example.com",
      totalFound: 40,
      urls: [{ url: "https://example.com/", source: "crawl", depth: 0 }],
      remainingQuota: 5,
    } as any);
    expect(markdown).toContain("**5** more pages");
    expect(markdown).toContain(PLAN_QUOTAS_URL);
  });

  it("a clamped audit states the limit and links the plan quotas", () => {
    const { markdown } = formatAuditStarted(
      { id: "a1", domain: "example.com", status: "pending", pagesRequested: 3, createdAt: "" } as any,
      { field: "pages", requested: 10, applied: 3, remaining: 3 },
    );
    expect(markdown).toContain("**3 pages remain**");
    expect(markdown).toContain(PLAN_QUOTAS_URL);
  });

  it("the pricing link is informational, not the dashboard", () => {
    expect(PLAN_QUOTAS_URL).toBe("https://www.opengraph.io/pricing");
  });
});
