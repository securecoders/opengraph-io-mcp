import { describe, it, expect, afterEach } from "vitest";
import { resolveTool } from "@/tools/registry";
import { ToolNames } from "@/tools/constants";

// og-api picks the model from modelSize and only knows nano and mini. Earlier
// releases sent small/large, which it silently ran as nano.

const guard = globalThis.fetch;
afterEach(() => { globalThis.fetch = guard; });

const CTX = { appId: "APPID", organizationId: "", accessToken: "", isLocal: false };

interface Seen { url: string; body: any }
let seen: Seen[] = [];

function stub(body: unknown) {
  seen = [];
  globalThis.fetch = (async (input: unknown, init: any) => {
    seen.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

async function run(name: string, args: Record<string, unknown>) {
  const tool = resolveTool(name, CTX);
  return (await tool.execute(tool.inputSchema.parse(args))) as any;
}

describe("getOgQuery modelSize", () => {
  it("accepts nano and mini and rejects the old small/large names", () => {
    const schema = resolveTool(ToolNames.GET_OG_QUERY, CTX).inputSchema;
    const base = { url: "https://example.test/", query: "What do they sell?" };
    expect(schema.safeParse({ ...base, modelSize: "nano" }).success).toBe(true);
    expect(schema.safeParse({ ...base, modelSize: "mini" }).success).toBe(true);
    expect(schema.safeParse({ ...base, modelSize: "large" }).success).toBe(false);
  });

  it("sends modelSize to og-api as given", async () => {
    stub({ question: "What do they sell?", result: "Rockets." });
    await run(ToolNames.GET_OG_QUERY, { url: "https://example.test/", query: "What do they sell?", modelSize: "mini" });

    const query = new URLSearchParams(seen[0].url.split("?")[1]);
    expect(query.get("modelSize")).toBe("mini");
    expect(seen[0].body).toEqual({ query: "What do they sell?" });
  });
});

describe("getOgExtract selectors", () => {
  // og-api accepts the plain-string form as shorthand for { selector }; before
  // that fix every value here came back null.
  it("forwards string selectors unchanged in the POST body", async () => {
    stub({ url: "https://example.test/", concatenatedText: "", data: { heading: "Acme" } });
    await run(ToolNames.GET_OG_EXTRACT, { url: "https://example.test/", selectors: { heading: "h1", price: ".price" } });

    expect(seen[0].body.selectors).toEqual({ heading: "h1", price: ".price" });
    expect(seen[0].url).not.toMatch(/selectors=/);
  });
});

describe("getOgScreenshot capture_delay", () => {
  // og-api reads capture_delay; the MCP used to rename it to captureDelay, so the
  // delay was silently ignored.
  it("sends capture_delay under the name og-api reads", async () => {
    stub({ url: "https://example.test/", screenshotUrl: "https://img.test/a.jpg" });
    await run(ToolNames.GET_OG_SCREENSHOT, { url: "https://example.test/", capture_delay: 1500 });

    const query = new URLSearchParams(seen[0].url.split("?")[1]);
    expect(query.get("capture_delay")).toBe("1500");
    expect(query.get("captureDelay")).toBeNull();
  });
});
