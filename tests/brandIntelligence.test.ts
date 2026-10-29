import { describe, it, expect, afterEach } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "@/mcp";
import { resolveTool } from "@/tools/registry";
import { ToolNames } from "@/tools/constants";

const guard = globalThis.fetch;
const env = { ...process.env };
afterEach(() => { globalThis.fetch = guard; process.env = { ...env }; });

const CTX = { appId: "APPID", organizationId: "", accessToken: "", isLocal: false };

// Shaped like og-api's response. Sections vary with the request, and custom and
// _meta are conditional, so the output schema has to accept any subset.
const PROFILE = {
  brand: { name: "Example", domain: "example.test", description: "Software.", tagline: null, category: "SaaS" },
  identity: { logos: [], icon: null, colors: [{ hex: "#5E6AD2", role: "primary" }], fonts: [] },
  products: [{ name: "Platform", description: null, url: null }],
  voice: { traits: ["concise"], description: null, formality: 0.6, technicality: 0.7, energy: 0.4, do: [], avoid: [] },
  custom: { enterprise_focus: true },
  _meta: { fields: { "brand.tagline": { basis: "observed", sources: [] } }, sources: {} },
  is_cache: false,
};

interface Seen { url: string; method: string; headers: Record<string, string>; body: any }
let seen: Seen[] = [];

function stub(status = 200, body: unknown = PROFILE) {
  seen = [];
  globalThis.fetch = (async (input: unknown, init: any) => {
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function run(args: Record<string, unknown>) {
  const tool = resolveTool(ToolNames.GET_BRAND_INTELLIGENCE, CTX);
  return (await tool.execute(tool.inputSchema.parse(args))) as any;
}

function parse(args: Record<string, unknown>) {
  return resolveTool(ToolNames.GET_BRAND_INTELLIGENCE, CTX).inputSchema.safeParse(args);
}

describe("getBrandIntelligence request", () => {
  it("POSTs to the 1.1 brand route with the session's app id", async () => {
    stub();
    await run({ url: "https://example.test/" });

    expect(seen).toHaveLength(1);
    const [path, query] = seen[0].url.split("?");
    // 3.0 does not exist for brand; og-api only registers it under 1.1.
    expect(path).toBe(`https://unmocked.invalid/api/1.1/brand/${encodeURIComponent("https://example.test/")}`);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers.Referrer).toBe("mcp");
    expect(new URLSearchParams(query).get("app_id")).toBe("APPID");
  });

  it("sends sections, questions and include_meta in the body, cache_ok in the query", async () => {
    stub();
    const questions = [{ key: "enterprise_focus", question: "Enterprise?", type: "boolean" }];
    await run({ url: "https://example.test/", sections: { links: false }, questions, include_meta: true, cache_ok: false });

    // og-api reads these three from the body; buildQueryParams would comma-join
    // the array and stringify the objects into something it cannot parse.
    expect(seen[0].body).toEqual({ sections: { links: false }, questions, include_meta: true });
    const query = new URLSearchParams(seen[0].url.split("?")[1]);
    expect(query.get("cache_ok")).toBe("false");
    expect(query.get("sections")).toBeNull();
  });

  it("never sends format, so the response is always the JSON profile", async () => {
    stub();
    await run({ url: "https://example.test/", format: "markdown" } as any);
    expect(seen[0].body.format).toBeUndefined();
    expect(seen[0].url).not.toMatch(/format=/);
  });

  it("does not publish format in its input schema", () => {
    const schema: any = resolveTool(ToolNames.GET_BRAND_INTELLIGENCE, CTX).toToolType().inputSchema;
    expect(Object.keys(schema.properties)).not.toContain("format");
  });
});

// Each of these is a 400 from og-api; rejecting it here costs no round trip.
describe("getBrandIntelligence input validation", () => {
  const q = (key: string, extra: Record<string, unknown> = {}) => ({ key, question: "Why?", ...extra });

  it("accepts three questions and rejects a fourth", () => {
    expect(parse({ url: "https://x.test/", questions: [q("a"), q("b"), q("c")] }).success).toBe(true);
    expect(parse({ url: "https://x.test/", questions: [q("a"), q("b"), q("c"), q("d")] }).success).toBe(false);
  });

  it.each([["has-dash"], ["a".repeat(65)], [""], ["__proto__"], ["constructor"], ["prototype"]])(
    "rejects the question key %j", (key) => {
      expect(parse({ url: "https://x.test/", questions: [q(key)] }).success).toBe(false);
    },
  );

  it("rejects duplicate question keys", () => {
    expect(parse({ url: "https://x.test/", questions: [q("a"), q("a")] }).success).toBe(false);
  });

  it("rejects a question over 500 characters and an unknown type", () => {
    expect(parse({ url: "https://x.test/", questions: [{ key: "a", question: "x".repeat(501) }] }).success).toBe(false);
    expect(parse({ url: "https://x.test/", questions: [q("a", { type: "date" })] }).success).toBe(false);
  });

  it("rejects an unknown section name rather than silently ignoring it", () => {
    expect(parse({ url: "https://x.test/", sections: { voice: false } }).success).toBe(true);
    expect(parse({ url: "https://x.test/", sections: { tone: false } }).success).toBe(false);
  });

  it("rejects a non-http url", () => {
    expect(parse({ url: "file:///etc/passwd" }).success).toBe(false);
  });
});

describe("getBrandIntelligence result", () => {
  it("returns the whole profile as structured content, marked untrusted", async () => {
    stub();
    const res = await run({ url: "https://example.test/" });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.profile).toEqual(PROFILE);
    expect(res.structuredContent.provenance).toEqual({ untrusted: true, source: "example.test" });
    expect(res.content[0].text).toMatch(/<untrusted-content-[0-9a-f]{16}>/);
    expect(res.content[0].text).toContain('"enterprise_focus": true');
  });

  // og-api returns inline SVG logos up to 64KB; that much markup in every
  // result crowds the agent's context.
  it("keeps a typical inline SVG logo and summarizes an oversized one", async () => {
    const small = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"></path></svg>';
    stub(200, { ...PROFILE, identity: { ...PROFILE.identity, logo_svg: { svg: small, type: "logo", theme: null } } });
    const kept = await run({ url: "https://example.test/" });
    expect(kept.structuredContent.profile.identity.logo_svg.svg).toBe(small);

    const huge = '<svg xmlns="http://www.w3.org/2000/svg"><path d="' + "M0 0".repeat(10000) + '"></path></svg>';
    stub(200, { ...PROFILE, identity: { ...PROFILE.identity, logo_svg: { svg: huge, type: "logo", theme: "dark" } } });
    const res = await run({ url: "https://example.test/" });
    const logo = res.structuredContent.profile.identity.logo_svg;
    expect(logo.svg).toMatch(/inline SVG logo omitted: \d+ bytes/);
    expect(logo.theme).toBe("dark");
    expect(res.content[0].text).not.toContain("M0 0M0 0");
  });

  it("passes the SDK's output schema check end to end", async () => {
    // The client validates structuredContent against the published outputSchema,
    // so a schema that pins the profile's sections would reject real responses.
    stub();
    process.env.OPENGRAPH_APP_ID = "local-key";
    const { server, cleanup } = createServer({ local: true });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([client.connect(clientT), (server as any).connect(serverT)]);
    try {
      await client.listTools();
      const res: any = await client.callTool({
        name: ToolNames.GET_BRAND_INTELLIGENCE,
        arguments: { url: "https://example.test/" },
      });
      expect(res.isError).toBeFalsy();
      expect(res.structuredContent.profile.brand.name).toBe("Example");
    } finally {
      await cleanup().catch(() => {});
    }
  });

  // og-api answers validation failures with { error: "..." } and pipeline
  // failures with { error: { code, message } }; both must reach the agent.
  it.each([
    [400, { error: "A maximum of 3 custom questions may be supplied per request." }, /maximum of 3/],
    [400, { error: { code: -4101, message: "Could not fetch the requested site." } }, /Could not fetch/],
    [504, { error: { code: -4100, message: "Brand analysis did not complete within the time limit for this site." } }, /time limit/],
  ])("reports a %i with its message", async (status, body, message) => {
    stub(status, body);
    const res = await run({ url: "https://example.test/" });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    expect(res.content[0].text).toMatch(message);
  });
});
