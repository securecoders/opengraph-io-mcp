import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "./mcp";
import dotenv from "dotenv";
import { setAppId, deleteAppId } from "./utils/sessionIdToAppId";

dotenv.config();

const app = express();
app.use(express.json());

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  cleanup: () => Promise<void>;
}

const sessions = new Map<string, SessionEntry>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  const { server, cleanup } = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport, cleanup });
      const appId = req.headers["x-app-id"] as string;
      if (appId) setAppId(sid, appId);
    },
    onsessionclosed: async (sid) => {
      sessions.delete(sid);
      deleteAppId(sid);
      await cleanup();
    },
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`MCP server (Streamable HTTP) listening on port ${PORT}`);
});
