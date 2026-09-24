import { describe, it, expect } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "@/mcp";

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
