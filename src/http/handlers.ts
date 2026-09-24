import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { type Request, type Response } from "express";
import { createServer } from "../mcp.js";
import { setAuthContext, deleteAppId, type AuthContext } from "@/utils/sessionIdToAppId";
import { verifyAccessToken } from "@/utils/oauth";
import { ownerKey } from "@/utils/sessionOwner";

const MCP_RESOURCE_URL =
  process.env.MCP_RESOURCE_URL || "https://mcp.opengraph.io/mcp";
const AUTH_SERVER_URL =
  process.env.OAUTH_ISSUER || "https://dashboard-api.opengraph.io";

export function handleProtectedResource(_req: Request, res: Response): void {
  res.json({
    resource:                 MCP_RESOURCE_URL,
    authorization_servers:    [AUTH_SERVER_URL],
    bearer_methods_supported: ["header"],
    scopes_supported:         ["mcp"],
  });
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

export interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  cleanup: () => Promise<void>;
  /** Who opened this session — every later request must resolve to the same owner. */
  owner: string;
  lastSeenAt: number;
}

export const sessions = new Map<string, SessionEntry>();

const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;

// Number("abc") is NaN, and NaN poisons both the interval delay and the cutoff
// comparison below — every session would be swept on every tick.
export function resolveIdleMs(): number {
  const parsed = Number(process.env.MCP_SESSION_IDLE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_IDLE_MS;
}

const SESSION_IDLE_MS = resolveIdleMs();

// DELETE /mcp now requires a valid credential, so a client whose token expired
// can no longer release its own session — and the entry holds that client's
// access token. Sweep idle sessions rather than letting them accumulate.
const sweep = setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [sid, entry] of sessions) {
    if (entry.lastSeenAt > cutoff) continue;
    sessions.delete(sid);
    deleteAppId(sid);
    void entry.cleanup().catch(() => {});
  }
}, Math.min(SESSION_IDLE_MS, 5 * 60 * 1000));
sweep.unref();

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to extract credentials from the request.
 * Returns an AuthContext on success, null if credentials are absent or invalid.
 */
export async function extractAuth(req: Request): Promise<AuthContext | null> {
  const authorization = req.headers["authorization"] as string | undefined;

  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
    const rawToken = authorization.slice(7).trim();
    try {
      const claims = await verifyAccessToken(rawToken);
      return {
        subject:        claims.subject,
        appId:          claims.appId,
        organizationId: claims.organizationId,
        scope:          claims.scope,
        accessToken:    rawToken,
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

export function sendUnauthorized(res: Response): void {
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

/**
 * The transport's own contract for an unrecognised session is 404 with -32001,
 * and that is the status clients treat as "re-initialize". Answering 400 leaves
 * a client whose session was swept unable to recover without a restart.
 */
export function sendSessionNotFound(res: Response): void {
  res.status(404).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Session not found" },
    id: null,
  });
}

// ---------------------------------------------------------------------------
// POST /mcp
// ---------------------------------------------------------------------------

export async function handlePost(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Re-evaluate auth on every request to pick up token refreshes, and before
  // anything reveals whether a session exists. A missing or invalid credential
  // must fail here: serving the request would run tools — including deletes and
  // report email — as whoever opened the session.
  const authCtx = await extractAuth(req);
  if (!authCtx) {
    sendUnauthorized(res);
    return;
  }

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      sendSessionNotFound(res);
      return;
    }
    if (ownerKey(authCtx) !== session.owner) {
      res.status(403).json({ error: "forbidden", error_description: "Session belongs to a different principal." });
      return;
    }
    setAuthContext(sessionId, authCtx);
    session.lastSeenAt = Date.now();
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // Only an initialize may open a session. Without this the transport rejects
  // the request *after* createServer() has already started a 10s interval that
  // nothing reclaims: the entry never reaches `sessions`, so the sweep below
  // never sees it. One leaked server, transport and timer per rejected POST.
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: Server not initialized" },
      id: null,
    });
    return;
  }

  const { server, cleanup } = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport, cleanup, owner: ownerKey(authCtx), lastSeenAt: Date.now() });
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

  // onsessioninitialized is what files the entry for the sweep. If the transport
  // rejected the initialize, it never fired and nothing else will release the
  // interval this server started.
  if (!transport.sessionId) {
    await cleanup().catch(() => {});
  }
}

/**
 * Resolve the session for a GET/DELETE, enforcing the same credential and
 * ownership checks as POST. Writes the error response and returns null on
 * failure, so callers just bail when it yields nothing.
 */
export async function resolveOwnedSession(req: Request, res: Response): Promise<SessionEntry | null> {
  // Credential first: checking existence before auth let anyone with a session
  // id tell a live one from a dead one without presenting anything.
  const ctx = await extractAuth(req);
  if (!ctx) {
    sendUnauthorized(res);
    return null;
  }
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    sendSessionNotFound(res);
    return null;
  }
  if (ownerKey(ctx) !== session.owner) {
    res.status(403).json({ error: "forbidden", error_description: "Session belongs to a different principal." });
    return null;
  }
  session.lastSeenAt = Date.now();
  return session;
}

// ---------------------------------------------------------------------------
// GET /mcp
// ---------------------------------------------------------------------------

export async function handleGet(req: Request, res: Response): Promise<void> {
  const session = await resolveOwnedSession(req, res);
  if (!session) return;
  await session.transport.handleRequest(req, res);
}

// ---------------------------------------------------------------------------
// DELETE /mcp
// ---------------------------------------------------------------------------

export async function handleDelete(req: Request, res: Response): Promise<void> {
  const session = await resolveOwnedSession(req, res);
  if (!session) return;
  await session.transport.handleRequest(req, res);
}

