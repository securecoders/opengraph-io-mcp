import express from "express";
import dotenv from "dotenv";
import {
  handleProtectedResource,
  handlePost,
  handleGet,
  handleDelete,
} from "@/http/handlers";

dotenv.config();

const app = express();

app.use(express.json());

// Origin is reflected by default. Safe because auth is an Authorization header,
// never a cookie, so a cross-origin page cannot forge another user's credential.
// Set MCP_ALLOWED_ORIGINS to restrict to named origins.
const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS || "")
  .split(",").map((o) => o.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = (req.headers["origin"] as string | undefined) ?? "*";
  if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
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
});

// Request handling lives in @/http/handlers so it can be tested without binding
// a port. RFC 9728 protected-resource metadata is part of that module.
app.get("/.well-known/oauth-protected-resource", handleProtectedResource);
app.post("/mcp", handlePost);
app.get("/mcp", handleGet);
app.delete("/mcp", handleDelete);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`MCP server (Streamable HTTP) listening on port ${PORT}`);
});
