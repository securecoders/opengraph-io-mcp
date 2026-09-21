# opengraph-io-mcp

MCP (Model Context Protocol) server exposing OpenGraph.io capabilities (OG metadata, scrape, screenshot, query, extract, markdown, AI image generation, site audit, link preview) to AI clients such as Claude and Cursor.

This file supplements the parent workspace [`CLAUDE.md`](../CLAUDE.md). Read that first for cross-repo rules, git safety, and the reuse/testing/planning workflow — it is not repeated here.

## Stack

- TypeScript, Express `^5.1.0`, `@modelcontextprotocol/sdk ^1.25.3`, Node ESM (`NodeNext`). No `engines` pin.

## Run / Build / Test

- Build: `npm run build` (`tsc`, then `postbuild`: `tsc-alias`).
- Start (HTTP/SSE, default port 3010): `npm start` (`node dist/server.js`) or `npm run start:http` (`node dist/server-http.js`).
- Start (stdio): `npm run start:stdio` (`node dist/server-stdio.js`).
- Dev: `npm run dev` (`ts-node-dev -r tsconfig-paths/register src/server.ts`), or `npm run dev:stdio`.
- Build an `.mcpb` bundle: `npm run build:mcpb`.
- Tests: **Vitest** — `npm test` (`vitest run`), `npm run test:watch`. Config is `vitest.config.mts`; specs live in the root `tests/` directory, never under `src/` (tsconfig `rootDir` is `./src` and `files: ["dist"]`, so specs there would ship in `dist/` and the `.mcpb` bundle). Coverage is still thin — `ownerKey` only as of slice 1.

## Data Ownership

- None — in-memory MCP session map only (`src/server-http.ts`).

## Auth

- OAuth 2.1 JWT (RS256 via `jose`, JWKS fetched from `apifur-api`) for site-audit/link-preview tools — `src/utils/oauth.ts`, `src/server-http.ts`. Env: `OAUTH_JWKS_URL`, `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `MCP_RESOURCE_URL`.
- Legacy `x-app-id` header or `OPENGRAPH_APP_ID`/`APP_ID` env for data tools (`src/utils/og.ts`).
- Site audit / link preview tools additionally require OAuth bearer + org ID (`src/utils/sessionIdToAppId.ts`).

## Integrations

- **Email:** None.
- **Analytics:** None.
- **Scheduled jobs:** None — ephemeral in-process MCP sessions only.

## Cross-Service Notes

- Calls `og-api` directly for data tools — `GET /api/3.0/site/{url}`, `/scrape/{url}`, `/screenshot/{url}`, `POST /query/{url}`, `POST /extract`, `GET /markdown/{url}` (`src/utils/og.ts`, `OG_BASE_URL`, default `https://opengraph.io`).
- Calls the image agent (`src/utils/og-image-api.ts`, `OG_IMAGE_AGENT_URL`).
- Calls `apifur-api` for site audit / link preview (`src/utils/site-audit-api.ts`, `SITE_AUDIT_API_URL`, default `https://dashboard-api.opengraph.io`): `POST /api/v1/site-audit/discover`, `POST /api/v1/site-audit/audits`, `GET /api/v1/site-audit/audits/{id}`, `GET /api/v1/site-audit/audits/{id}/report`, `POST /api/v1/link-preview`.
- No shared packages observed with sibling repos.
- Unlikely to be involved in an email-marketing feature unless it's explicitly asked to expose an MCP tool for it — treat that as out of scope unless the user says otherwise.
