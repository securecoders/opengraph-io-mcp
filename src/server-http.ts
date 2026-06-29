import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { createServer } from "./mcp.js";
import dotenv from "dotenv";
import { setAuthContext, deleteAppId, type AuthContext } from "@/utils/sessionIdToAppId";
import { verifyAccessToken } from "@/utils/oauth";

dotenv.config();

const app = express();

app.use(express.json());

// CORS: reflect the request origin back so Chromium-based clients (Cursor,
// Claude Desktop, etc.) can read responses even when using credentials mode.
// The real security gate is the Bearer token check, not CORS.
app.use((req, res, next) => {
  const origin = (req.headers["origin"] as string | undefined) ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, MCP-Session-Id, Accept",
  );
  res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id, WWW-Authenticate");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// OAuth 2.1 protected-resource metadata (RFC 9728)
// ---------------------------------------------------------------------------

const MCP_RESOURCE_URL =
  process.env.MCP_RESOURCE_URL || "https://mcp.opengraph.io/mcp";
const AUTH_SERVER_URL =
  process.env.OAUTH_ISSUER || "https://dashboard-api.opengraph.io";

app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource:                 MCP_RESOURCE_URL,
    authorization_servers:    [AUTH_SERVER_URL],
    bearer_methods_supported: ["header"],
    scopes_supported:         ["mcp"],
  });
});

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  cleanup: () => Promise<void>;
}

const sessions = new Map<string, SessionEntry>();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to extract credentials from the request.
 * Returns an AuthContext on success, null if credentials are absent or invalid.
 */
async function extractAuth(req: Request): Promise<AuthContext | null> {
  const authorization = req.headers["authorization"] as string | undefined;

  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
    const jwt = authorization.slice(7).trim();
    try {
      const claims = await verifyAccessToken(jwt);
      return {
        appId:          claims.appId,
        organizationId: claims.organizationId,
        scope:          claims.scope,
      };
    } catch {
      return null;
    }
  }

  // Legacy fallback: x-app-id header
  const legacyAppId = req.headers["x-app-id"] as string | undefined;
  if (legacyAppId) {
    return { appId: legacyAppId };
  }

  return null;
}

function sendUnauthorized(res: Response): void {
  const metaBase = MCP_RESOURCE_URL.replace(/\/mcp$/, "");
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metaBase}/.well-known/oauth-protected-resource"`,
  );
  res.status(401).json({
    error: "unauthorized",
    error_description:
      "Provide an OAuth 2.1 bearer token or a legacy x-app-id header.",
  });
}

// ---------------------------------------------------------------------------
// POST /mcp
// ---------------------------------------------------------------------------

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Re-evaluate auth on every request to pick up token refreshes
    const ctx = await extractAuth(req);
    if (ctx) setAuthContext(sessionId, ctx);
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — resolve auth first; reject before creating server/transport
  const authCtx = await extractAuth(req);
  if (!authCtx) {
    sendUnauthorized(res);
    return;
  }

  const { server, cleanup } = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport, cleanup });
      // Bind the resolved auth context to the real session ID
      setAuthContext(sid, authCtx);
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

// ---------------------------------------------------------------------------
// GET /mcp
// ---------------------------------------------------------------------------

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

// ---------------------------------------------------------------------------
// DELETE /mcp
// ---------------------------------------------------------------------------

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }
  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`MCP server (Streamable HTTP) listening on port ${PORT}`);
});
