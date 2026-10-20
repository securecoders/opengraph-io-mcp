import { describe, it, expect, afterEach } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "@/mcp";
import { setAuthContext, deleteAppId } from "@/utils/sessionIdToAppId";
import { ToolNames } from "@/tools/constants";

const SID = "dispatch-session";

// Characterization tests: these pin the dispatch behaviour that exists today so
// the switch-to-registry refactor can be proven not to change it. The credential
// guard is deliberately NOT uniform across tool families — see below.
async function connect(sessionId?: string, local = false) {
  const { server, cleanup } = createServer({ local });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  if (sessionId) (serverT as any).sessionId = sessionId;
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([client.connect(clientT), (server as any).connect(serverT)]);
  return { client, cleanup };
}

async function callFor(name: string, args: Record<string, unknown>, sessionId?: string, local = false) {
  const { client, cleanup } = await connect(sessionId, local);
  try {
    const res: any = await client.callTool({ name, arguments: args });
    return { ok: true as const, res };
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
  } finally {
    await cleanup().catch(() => {});
  }
}

const APP_ID_ERROR = /Could not find App ID for session/;

afterEach(() => { deleteAppId(SID); });

describe("tool listing", () => {
  it("advertises every tool in ToolNames and nothing else", async () => {
    const { client, cleanup } = await connect();
    const { tools } = await client.listTools();
    await cleanup().catch(() => {});

    const advertised = tools.map((t) => t.name).sort();
    const declared = Object.values(ToolNames).sort();
    // Both directions: a tool missing from the registry and a registry entry
    // with no ToolNames constant are equally broken.
    expect(advertised).toEqual(declared);
  });

  it("gives every tool a usable input schema and description", async () => {
    const { client, cleanup } = await connect();
    const { tools } = await client.listTools();
    await cleanup().catch(() => {});

    for (const tool of tools) {
      expect(tool.description, `${tool.name} description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} inputSchema`).toBeTruthy();
      expect(tool.inputSchema.type, `${tool.name} schema type`).toBe("object");
    }
  });
});

describe("credential guard by tool family", () => {
  // The six OG data tools refuse to run without an app id on a real session.
  const DATA_TOOLS: Array<[string, Record<string, unknown>]> = [
    [ToolNames.GET_OG_DATA, { url: "https://example.test" }],
    [ToolNames.GET_OG_SCRAPE_DATA, { url: "https://example.test" }],
    [ToolNames.GET_OG_SCREENSHOT, { url: "https://example.test" }],
    [ToolNames.GET_OG_QUERY, { url: "https://example.test", query: "what" }],
    [ToolNames.GET_OG_EXTRACT, { url: "https://example.test", html_elements: ["h1"] }],
    [ToolNames.GET_OG_MARKDOWN, { url: "https://example.test" }],
  ];

  DATA_TOOLS.forEach(([name, args]) => {
    it(`${name} refuses a session with no app id`, async () => {
      setAuthContext(SID, { appId: "" });
      const out = await callFor(name, args, SID);
      expect(out.ok ? JSON.stringify(out.res) : out.message).toMatch(APP_ID_ERROR);
    });
  });

  // Image tools carry it too: without a session key the image client fell back
  // to the server's own OPENGRAPH_APP_ID, billing the operator for the call.
  const IMAGE_TOOLS: Array<[string, Record<string, unknown>]> = [
    [ToolNames.GENERATE_IMAGE, { prompt: "a cat" }],
    [ToolNames.ITERATE_IMAGE, { sessionId: "11111111-1111-4111-8111-111111111111", assetId: "22222222-2222-4222-8222-222222222222", prompt: "bigger" }],
    [ToolNames.INSPECT_IMAGE_SESSION, { sessionId: "11111111-1111-4111-8111-111111111111" }],
    [ToolNames.EXPORT_IMAGE_ASSET, { sessionId: "11111111-1111-4111-8111-111111111111", assetId: "22222222-2222-4222-8222-222222222222" }],
  ];

  IMAGE_TOOLS.forEach(([name, args]) => {
    it(`${name} refuses a session with no app id`, async () => {
      setAuthContext(SID, { appId: "" });
      const out = await callFor(name, args, SID);
      expect(out.ok ? JSON.stringify(out.res) : out.message).toMatch(APP_ID_ERROR);
    });
  });

  // Site-audit tools deliberately do NOT carry that guard: they report a friendly
  // "reconnect" result from inside execute() instead of throwing.
  const UNGUARDED: Array<[string, Record<string, unknown>]> = [
    [ToolNames.DISCOVER_SITE_URLS, { url: "https://example.test" }],
    [ToolNames.START_SITE_AUDIT, { domain: "example.test" }],
    [ToolNames.GET_SITE_AUDIT_STATUS, { auditId: "a1" }],
    [ToolNames.GET_SITE_AUDIT_REPORT, { auditId: "a1" }],
    [ToolNames.PREVIEW_PAGE_AUDIT, { url: "https://example.test" }],
    [ToolNames.GET_LINK_PREVIEW, { url: "https://example.test" }],
  ];

  UNGUARDED.forEach(([name, args]) => {
    it(`${name} does not raise the app-id error`, async () => {
      setAuthContext(SID, { appId: "" });
      const out = await callFor(name, args, SID);
      expect(out.ok ? JSON.stringify(out.res) : out.message).not.toMatch(APP_ID_ERROR);
    });
  });

  it("site-audit tools ask the user to reconnect when unauthenticated", async () => {
    setAuthContext(SID, { appId: "" });
    const out = await callFor(ToolNames.START_SITE_AUDIT, { domain: "example.test" }, SID);
    expect(out.ok).toBe(true);
    expect(JSON.stringify((out as any).res)).toMatch(/reconnect/i);
  });

  it("allows a data tool through on a local stdio server", async () => {
    // isLocal short-circuits the guard so stdio dev usage keeps working.
    const out = await callFor(ToolNames.GET_OG_DATA, { url: "https://example.test" }, undefined, true);
    expect(out.ok ? JSON.stringify(out.res) : out.message).not.toMatch(APP_ID_ERROR);
  });

  // #43: local used to be inferred from a missing session id, so any HTTP request
  // that lacked one got stdio's privileges. It is now set only by the stdio entrypoint.
  it("does not treat an HTTP server with no session id as local", async () => {
    const out = await callFor(ToolNames.GET_OG_DATA, { url: "https://example.test" });
    expect(out.ok ? JSON.stringify(out.res) : out.message).toMatch(APP_ID_ERROR);
  });
});

describe("tools that take no arguments", () => {
  it("runs when the client omits `arguments` entirely", async () => {
    // `arguments` is optional in the protocol, and z.object({}).parse(undefined)
    // throws — so the one zero-argument tool broke for any conforming client.
    const { client, cleanup } = await connect(SID);
    setAuthContext(SID, { appId: "", accessToken: "" });
    try {
      const res: any = await client.callTool({ name: ToolNames.GET_CONNECTION_CONTEXT });
      // Unauthenticated here, so it reports that — the point is it did not throw
      // a schema error before reaching execute().
      expect(JSON.stringify(res)).toMatch(/reconnect/i);
    } finally {
      await cleanup().catch(() => {});
    }
  });
});

describe("unknown tools", () => {
  it("rejects a name that is not registered", async () => {
    const out = await callFor("notATool", {}, SID);
    expect(out.ok ? JSON.stringify(out.res) : out.message).toMatch(/notATool/);
  });
});
