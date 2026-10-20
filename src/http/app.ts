import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  hostHeaderValidation,
  localhostHostValidation,
} from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import {
  handleProtectedResource,
  handlePost,
  handleGet,
  handleDelete,
} from "@/http/handlers";
import {
  SESSION_CREATE_LIMIT,
  SESSION_CREATE_WINDOW_MS,
  resolveTrustProxy,
} from "@/utils/limits";
import { logEvent, logSampled } from "@/utils/log";

// No origin is allowed cross-origin unless named in MCP_ALLOWED_ORIGINS. MCP
// clients are not browsers and never send Origin, so they are unaffected; a
// browser page on any site used to be reflected with credentials and could read
// the session id.
//
// Read per request rather than at module load: the entrypoint calls
// dotenv.config() after this module is imported, so a module-level const would
// never see a .env value.
function allowedOrigins(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS || "")
    .split(",").map((o) => o.trim()).filter(Boolean);
}

function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers["origin"] as string | undefined;
  res.setHeader("Vary", "Origin");
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id, WWW-Authenticate");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, MCP-Session-Id, Accept",
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Responses are JSON and SSE consumed by MCP clients, never rendered as a
  // document, so the browser-facing headers (CSP, frame options) buy nothing
  // here. nosniff still matters: it stops a client treating a JSON body as
  // something executable. HSTS belongs on the ingress.
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

// Express identifies an error handler by arity, so all four parameters must stay
// even though next is never called.
function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = typeof (err as { status?: unknown })?.status === "number"
    ? (err as { status: number }).status
    : 500;
  const clientError = status >= 400 && status < 500;

  // Never the error object itself: an upstream error can carry request config,
  // headers and a URL with the caller's app_id.
  if (!clientError) {
    const e = err as { name?: unknown; code?: unknown; message?: unknown };
    logEvent("server.error", {
      status,
      name: typeof e?.name === "string" ? e.name : undefined,
      code: typeof e?.code === "string" ? e.code : undefined,
      message: typeof e?.message === "string" ? e.message.slice(0, 200) : undefined,
    });
  }

  if (res.headersSent) return;

  // A body-parser SyntaxError used to reach the client as an HTML stack trace
  // naming node_modules paths. Callers get the status and nothing else.
  res.status(status).json({
    error: clientError ? "bad_request" : "internal_error",
    error_description: clientError
      ? "The request could not be parsed."
      : "The server encountered an unexpected condition.",
  });
}

// Calls inside a session have their own budget (createServer); only opening one is limited here.
function sessionCreateLimiter() {
  return rateLimit({
    windowMs: SESSION_CREATE_WINDOW_MS,
    limit: SESSION_CREATE_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => Boolean(req.headers["mcp-session-id"]) || !isInitializeRequest(req.body),
    handler: (req, res) => {
      logSampled(req.ip ?? "unknown", "session.rate_limited", { ip: req.ip });
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Too many new sessions from this address. Retry later." },
        id: null,
      });
    },
  });
}

const LOOPBACK = ["127.0.0.1", "localhost", "::1"];

/** Loopback unless told otherwise; the container image sets MCP_HOST=0.0.0.0. */
export function resolveBindHost(): string {
  return process.env.MCP_HOST || "127.0.0.1";
}

// A DNS rebinding page reaches a loopback server through a hostname it controls,
// so the Host header is the tell. A public deployment names its own hosts.
function hostValidation(): ((req: Request, res: Response, next: NextFunction) => void) | null {
  const named = (process.env.MCP_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);
  if (named.length > 0) return hostHeaderValidation(named);
  if (LOOPBACK.includes(resolveBindHost())) return localhostHostValidation();
  return null;
}

/**
 * Build the MCP express app without binding a port, so the HTTP layer is
 * reachable from tests. The entrypoint owns listen().
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", resolveTrustProxy());
  app.use(securityHeaders);
  app.use(express.json());
  app.use(cors);

  // Request handling lives in @/http/handlers so it can be tested without binding
  // a port. RFC 9728 protected-resource metadata is part of that module.
  app.get("/.well-known/oauth-protected-resource", handleProtectedResource);
  const checkHost = hostValidation();
  if (checkHost) app.use("/mcp", checkHost);
  app.post("/mcp", sessionCreateLimiter(), handlePost);
  app.get("/mcp", handleGet);
  app.delete("/mcp", handleDelete);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(errorHandler);

  return app;
}
