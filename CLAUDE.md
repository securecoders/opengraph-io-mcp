# opengraph-io-mcp

MCP server that exposes the OpenGraph.io API (OG metadata, scrape, screenshot, query, extract, Markdown,
image generation, Open Graph Audit, link preview) to AI clients such as Claude and Cursor. Users run it
locally over stdio with their App ID, or connect to the hosted server with OAuth.

## Stack

- TypeScript, `@modelcontextprotocol/sdk`, Node ESM (`NodeNext`). **Node 24** (`.nvmrc`, `engines.node`).

## Build and test

- `npm run build` (`tsc`, then `tsc-alias`). `prebuild` clears `dist/`.
- `npm start` or `npm run start:stdio` runs the stdio server (`dist/server-stdio.js`); `npm run dev` runs
  it from source.
- `npm run build:mcpb` builds the Claude Desktop extension from `extension/manifest.json`.
- `npm test` (Vitest) and `npm run typecheck`. Specs live in `tests/`, never under `src/`: `rootDir` is
  `./src` and the package ships `dist/`, so a spec under `src/` would ship to users.
- Tests never touch the network: `tests/setup.ts` replaces `fetch` with a guard that throws.

## Tools

- Every tool is registered once in `src/tools/registry.ts`. `ListTools` and `CallTool` read the same
  table, so the advertised list cannot drift from what dispatch accepts.
- `requiresAppId` marks tools that refuse to run without the caller's App ID over HTTP. `requiresOAuth`
  marks tools that need an OAuth session (Open Graph Audit, link preview); a local stdio server does not
  list them. `tests/toolDispatch.test.ts` pins both.
- "Local" is the explicit `createServer({ local: true })`, set only by `src/server-stdio.ts`.
- `SERVER_INSTRUCTIONS` in `src/mcp.ts` is hand written; `tests/serverInstructions.test.ts` keeps it in
  step with the registry.
- Tools that return text from other sites wrap it with `toUntrustedResult` (`src/utils/format.ts`).

## Versions

`package.json`, `server.json`, `extension/manifest.json` and `SERVER_VERSION` in `src/mcp.ts` carry the
same version; `tests/packaging.test.ts` fails if they differ.
