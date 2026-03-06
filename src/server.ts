import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createServer, SERVER_CARD } from "./mcp";
import dotenv from "dotenv";
import { setAppId, deleteAppId } from "./utils/sessionIdToAppId";

dotenv.config();

const app = express();

const { server, cleanup } = createServer();

let transport: SSEServerTransport;

// Static server card for registry discovery (Smithery, etc.)
app.get("/.well-known/mcp/server-card.json", (_req, res) => {
  res.json(SERVER_CARD);
});

app.get("/sse", async (_, res) => {
  // console.log("Received connection");

  const appIdFromQuery = _.query['app_id'] as string;

  transport = new SSEServerTransport("/message", res);
  await server.connect(transport);
  setAppId(transport.sessionId, appIdFromQuery);

  server.onclose = async () => {
    // console.log("Server closing or connection lost...");
    await cleanup();
    await server.close();
    deleteAppId(transport.sessionId);
  };
});

app.post("/message", async (req, res) => {
  // console.log("Received message");
  await transport.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  // console.log(`Server is running on port ${PORT}`);
});