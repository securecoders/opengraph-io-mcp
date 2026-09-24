import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  handleProtectedResource,
  handlePost,
  handleGet,
  handleDelete,
} from "@/http/handlers";

// Origin is reflected by default. Safe because auth is an Authorization header,
// never a cookie, so a cross-origin page cannot forge another user's credential.
// Set MCP_ALLOWED_ORIGINS to restrict to named origins.
//
// Read per request rather than at module load: the entrypoint calls
// dotenv.config() after this module is imported, so a module-level const would
// never see a .env value.
function allowedOrigins(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS || "")
    .split(",").map((o) => o.trim()).filter(Boolean);
}

function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = (req.headers["origin"] as string | undefined) ?? "*";
  const allowed = allowedOrigins();
  if (allowed.length === 0 || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
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

  if (!clientError) {
    console.error("[mcp] unhandled error", err);
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

/**
 * Build the MCP express app without binding a port, so the HTTP layer is
 * reachable from tests. The entrypoint owns listen().
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(express.json());
  app.use(cors);

  // Request handling lives in @/http/handlers so it can be tested without binding
  // a port. RFC 9728 protected-resource metadata is part of that module.
  app.get("/.well-known/oauth-protected-resource", handleProtectedResource);
  app.post("/mcp", handlePost);
  app.get("/mcp", handleGet);
  app.delete("/mcp", handleDelete);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(errorHandler);

  return app;
}
