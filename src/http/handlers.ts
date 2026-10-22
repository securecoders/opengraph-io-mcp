import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { type Request, type Response } from "express";
import { createServer } from "../mcp.js";
import { setAuthContext, deleteAppId, type AuthContext } from "@/utils/sessionIdToAppId";
import { verifyAccessToken, type OAuthClaims } from "@/utils/oauth";
import { resolveAppKey, AppKeyRejectedError } from "@/utils/appKey";
import { ownerKey } from "@/utils/sessionOwner";
import { MAX_SESSIONS, MAX_SESSIONS_PER_IP, MAX_SESSIONS_PER_OWNER } from "@/utils/limits";
import { keyFingerprint, logEvent, logSampled, principalForLog } from "@/utils/log";

export { keyFingerprint };

/** Enough of a session id to correlate log lines, not enough to use it. */
const shortId = (sid: string): string => sid.slice(0, 8);

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
  /** Client address at creation, for the per-address cap. */
  ip?: string;
  /** When the bound bearer token expires; refreshed by every authenticated POST. */
  credentialExpiresAt?: number;
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

function evict(sid: string, entry: SessionEntry, reason: string): void {
  logEvent("session.closed", { session: shortId(sid), reason });
  sessions.delete(sid);
  deleteAppId(sid);
  // Dropping the map entry alone would leave an open SSE stream, and the
  // transport behind it, outside every cap.
  void entry.transport?.close?.().catch(() => {});
  void entry.cleanup().catch(() => {});
}

// DELETE /mcp now requires a valid credential, so a client whose token expired
// can no longer release its own session — and the entry holds that client's
// access token. Sweep idle sessions rather than letting them accumulate.
export function sweepSessions(now = Date.now()): void {
  const cutoff = now - SESSION_IDLE_MS;
  for (const [sid, entry] of sessions) {
    if (entry.lastSeenAt <= cutoff) {
      evict(sid, entry, "idle");
      continue;
    }
    // An expired token is no use to anyone and must not sit in memory. The
    // session survives; the client's next request binds its refreshed token.
    if (entry.credentialExpiresAt !== undefined && entry.credentialExpiresAt <= now) {
      deleteAppId(sid);
      entry.credentialExpiresAt = undefined;
      logEvent("session.credential_expired", { session: shortId(sid) });
    }
  }
}

const sweep = setInterval(() => sweepSessions(), Math.min(SESSION_IDLE_MS, 5 * 60 * 1000));
sweep.unref();

/** Clients that never DELETE would otherwise be refused; drop their own oldest session instead. */
export function makeRoomForOwner(owner: string): void {
  let count = 0;
  let oldest: [string, SessionEntry] | undefined;
  for (const pair of sessions) {
    if (pair[1].owner !== owner) continue;
    count += 1;
    if (!oldest || pair[1].lastSeenAt < oldest[1].lastSeenAt) oldest = pair;
  }
  if (count >= MAX_SESSIONS_PER_OWNER && oldest) evict(oldest[0], oldest[1], "owner_limit");
}

export function countSessionsFromIp(ip: string): number {
  let count = 0;
  for (const entry of sessions.values()) if (entry.ip === ip) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

// x-app-id is an unverified claim of identity, so hosted leaves it off; stdio
// never reaches this code and self-host opts in. Read per request: the
// entrypoint loads .env after this module is imported.
export function legacyAppIdAllowed(): boolean {
  return process.env.MCP_ALLOW_LEGACY_APP_ID === "true";
}

/** API keys are UUIDs (older ones hex); anything else is refused before it reaches a URL. */
const LEGACY_APP_ID_FORMAT = /^[A-Za-z0-9_-]{16,128}$/;

const DEPRECATION_LINK = '<https://github.com/securecoders/opengraph-io-mcp#authentication>; rel="deprecation"';

/** Only the x-app-id path yields a context with no subject. */
function isLegacy(ctx: AuthContext): boolean {
  return !ctx.subject;
}

// RFC 9745. Clients that surface deprecations can warn the user; the log is how
// we see who still depends on the header before turning it off.
function markDeprecated(res: Response): void {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", DEPRECATION_LINK);
}

// Why extractAuth returned null, for the log line written by whoever rejects.
const authFailures = new WeakMap<object, string>();

function logRejected(req: Request): void {
  logSampled(req.ip ?? "unknown", "auth.rejected", { reason: authFailures.get(req) ?? "missing", method: req.method, ip: req.ip });
}

function logForbidden(req: Request, sid: string, ctx: AuthContext): void {
  logEvent("session.forbidden", { session: shortId(sid), principal: principalForLog(ctx), ip: req.ip });
}

/**
 * Attempt to extract credentials from the request.
 * Returns an AuthContext on success, null if credentials are absent or invalid.
 */
export async function extractAuth(req: Request): Promise<AuthContext | null> {
  const authorization = req.headers["authorization"] as string | undefined;

  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
    const rawToken = authorization.slice(7).trim();
    let claims: OAuthClaims;
    try {
      claims = await verifyAccessToken(rawToken);
    } catch (err: unknown) {
      // jose's error codes (ERR_JWT_EXPIRED and so on) name the failure without the token.
      const code = (err as { code?: unknown })?.code;
      authFailures.set(req, typeof code === "string" ? code : String((err as Error)?.message ?? err).slice(0, 80));
      return null;
    }

    // Only a refusal of this token is a 401. An outage or misconfiguration
    // throws through to a 503, so clients are not sent back through OAuth.
    let appId: string;
    try {
      appId = await resolveAppKey(rawToken, claims.apiKeyId, claims.organizationId);
    } catch (err: unknown) {
      if (!(err instanceof AppKeyRejectedError)) throw err;
      authFailures.set(req, "app_key_rejected");
      return null;
    }

    return {
      subject:        claims.subject,
      appId,
      organizationId: claims.organizationId,
      scope:          claims.scope,
      accessToken:    rawToken,
      expiresAt:      claims.expiresAt,
    };
  }

  const legacyAppId = req.headers["x-app-id"] as string | undefined;
  if (legacyAppId) {
    if (!legacyAppIdAllowed()) {
      authFailures.set(req, "legacy_disabled");
      return null;
    }
    if (!LEGACY_APP_ID_FORMAT.test(legacyAppId)) {
      authFailures.set(req, "legacy_malformed");
      return null;
    }
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
    error_description: legacyAppIdAllowed()
      ? "Provide an OAuth 2.1 bearer token or a legacy x-app-id header."
      : "Provide an OAuth 2.1 bearer token.",
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
    logRejected(req);
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
      logForbidden(req, sessionId, authCtx);
      res.status(403).json({ error: "forbidden", error_description: "Session belongs to a different principal." });
      return;
    }
    if (isLegacy(authCtx)) markDeprecated(res);
    setAuthContext(sessionId, authCtx);
    session.credentialExpiresAt = authCtx.expiresAt;
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

  const owner = ownerKey(authCtx);
  if (sessions.size >= MAX_SESSIONS) {
    logEvent("session.refused", { reason: "capacity", ip: req.ip });
    res.setHeader("Retry-After", "60");
    res.status(503).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Server is at capacity. Retry shortly." },
      id: null,
    });
    return;
  }
  const ip = req.ip;
  if (ip && countSessionsFromIp(ip) >= MAX_SESSIONS_PER_IP) {
    logEvent("session.refused", { reason: "ip_limit", ip });
    res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Too many open sessions from this address. Close some and retry." },
      id: null,
    });
    return;
  }
  makeRoomForOwner(owner);
  if (isLegacy(authCtx)) {
    markDeprecated(res);
    logEvent("auth.legacy_app_id", { key: keyFingerprint(authCtx.appId), ip });
  }

  const { server, cleanup } = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, {
        transport, cleanup, owner, ip,
        credentialExpiresAt: authCtx.expiresAt,
        lastSeenAt: Date.now(),
      });
      // Bind the resolved auth context to the real session ID
      setAuthContext(sid, authCtx);
      logEvent("session.opened", { session: shortId(sid), principal: principalForLog(authCtx), ip });
    },
    onsessionclosed: async (sid) => {
      logEvent("session.closed", { session: shortId(sid), reason: "client" });
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
    logRejected(req);
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
    logForbidden(req, sessionId!, ctx);
    res.status(403).json({ error: "forbidden", error_description: "Session belongs to a different principal." });
    return null;
  }
  if (isLegacy(ctx)) markDeprecated(res);
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

