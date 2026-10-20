import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "@/mcp";
import { deleteAppId, setAuthContext } from "@/utils/sessionIdToAppId";

// resources/subscribe used to fire a server-initiated sampling/createMessage at
// the client, carrying a leftover "You are a helpful test server." prompt and
// includeContext: "thisServer". A server asking the client's model to run a
// prompt on every subscribe is an agency the product never intended.
describe("resources/subscribe", () => {
  async function connect() {
    const { server, cleanup } = createServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: { sampling: {} } });

    let sampled = 0;
    client.setRequestHandler(CreateMessageRequestSchema, async () => {
      sampled += 1;
      return { model: "test", role: "assistant", content: { type: "text", text: "" } };
    });

    await Promise.all([client.connect(clientT), (server as any).connect(serverT)]);
    return { client, cleanup, sampled: () => sampled };
  }

  it("never asks the client to run a sampling request", async () => {
    const { client, cleanup, sampled } = await connect();
    try {
      await client.subscribeResource({ uri: "asset://11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222" });
      expect(sampled()).toBe(0);
    } finally {
      await cleanup().catch(() => {});
    }
  });

  // Subscribing still has to work — the fix removed the sampling call, not the
  // subscription itself.
  it("still accepts and acknowledges a subscription", async () => {
    const { client, cleanup } = await connect();
    try {
      await expect(
        client.subscribeResource({ uri: "asset://11111111-1111-1111-1111-111111111111/33333333-3333-3333-3333-333333333333" }),
      ).resolves.toBeDefined();
    } finally {
      await cleanup().catch(() => {});
    }
  });

  it("unsubscribes without error", async () => {
    const { client, cleanup } = await connect();
    const uri = "asset://11111111-1111-1111-1111-111111111111/44444444-4444-4444-4444-444444444444";
    try {
      await client.subscribeResource({ uri });
      await expect(client.unsubscribeResource({ uri })).resolves.toBeDefined();
    } finally {
      await cleanup().catch(() => {});
    }
  });
});

// #19: an asset read used to call the image agent with no app id at all, so
// over HTTP it always ran as the server's own OPENGRAPH_APP_ID.
describe("resources/read on an HTTP session", () => {
  const ASSET_URI = "asset://11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
  const guard = globalThis.fetch;
  let urls: string[] = [];

  beforeEach(() => {
    urls = [];
    process.env.OPENGRAPH_APP_ID = "operator-key";
    globalThis.fetch = (async (input: unknown) => {
      urls.push(String(input));
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = guard;
    delete process.env.OPENGRAPH_APP_ID;
    deleteAppId("res-session");
  });

  async function connectHttp() {
    const { server, cleanup } = createServer();
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    (serverT as any).sessionId = "res-session";
    const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([client.connect(clientT), (server as any).connect(serverT)]);
    return { client, cleanup };
  }

  it("refuses without a session key instead of using the server's", async () => {
    const { client, cleanup } = await connectHttp();
    try {
      await expect(client.readResource({ uri: ASSET_URI })).rejects.toThrow(/App ID/);
      expect(urls).toHaveLength(0);
    } finally {
      await cleanup().catch(() => {});
    }
  });

  it("reads with the session's own key", async () => {
    setAuthContext("res-session", { appId: "33333333-3333-4333-8333-333333333333" });
    const { client, cleanup } = await connectHttp();
    try {
      await client.readResource({ uri: ASSET_URI });
      expect(new URL(urls[0]).searchParams.get("app_id")).toBe("33333333-3333-4333-8333-333333333333");
    } finally {
      await cleanup().catch(() => {});
    }
  });
});
