import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVER_NAME, SERVER_VERSION } from "@/mcp";
import { localToolDefinitions } from "@/tools/registry";

// package.json has no "type": "module", so under NodeNext a .ts spec is typed as
// CommonJS and import.meta is a compile error. Vitest runs from the repo root.
const readJson = (name: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), name), "utf8"));

const pkg = readJson("package.json");
const serverJson = readJson("server.json");
const manifest = readJson("extension/manifest.json");
const cursorPlugin = readJson(".cursor-plugin/plugin.json");
const cursorMcp = readJson("mcp.json");

// This package publishes to npm and is bundled into a .mcpb extension, so a
// build-only dependency listed under `dependencies` ships to every user twice:
// `npm ci --omit=dev` still installs it for production, and
// scripts/build-mcpb.js copies `dependencies` verbatim into the extension.
describe("runtime dependencies", () => {
  it("does not ship ts-node", () => {
    expect(pkg.dependencies).not.toHaveProperty("ts-node");
    expect(pkg.devDependencies).toHaveProperty("ts-node");
  });
});

// The legacy SSE server had no authentication and shared one transport across
// every client. It was `main` and what `npm start` ran, so anyone following the
// README started it.
describe("entrypoints", () => {
  it("never points at the retired SSE server", () => {
    const targets = [pkg.main, pkg.scripts.start, pkg.scripts.dev, ...Object.values(pkg.bin as Record<string, string>)];
    for (const target of targets) {
      expect(target).not.toMatch(/\bserver\.(js|ts)\b/);
    }
  });

  // Users run the package locally; the HTTP server is only the hosted build.
  it("starts the stdio server", () => {
    expect(pkg.main).toBe("dist/server-stdio.js");
    expect(pkg.scripts.start).toContain("dist/server-stdio.js");
    expect(pkg.bin["opengraph-io-mcp"]).toBe("dist/server-stdio.js");
  });
});

// publish.yml reads the npm version from package.json but hands the registry
// step server.json. A bump that misses one makes the registry publish retry
// five times and fail.
// The extension and the server's self-reported version drifted to 1.1.0 and
// 1.4.0 while the package moved on, so one place is now the source.
describe("version", () => {
  it("matches across package.json and server.json", () => {
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.packages[0].version).toBe(pkg.version);
  });

  it("matches in the extension manifest and the server info", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(SERVER_NAME).toBe(pkg.name);
  });
});

// The manifest and README pointed at a different, private repository.
describe("public links", () => {
  it("point at this repository", () => {
    const repo = "https://github.com/securecoders/opengraph-io-mcp";
    expect(manifest.repository.url).toBe(repo);
    expect(manifest.homepage).toBe(repo);
    expect(readFileSync(resolve(process.cwd(), "README.md"), "utf8")).not.toMatch(/securecoders\/og-mcp\b/);
  });
});

// The old manifest used keys Claude Desktop does not read, so the App ID the
// user entered never reached the server.
describe("extension manifest", () => {
  it("passes the user's App ID to the server", () => {
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.server.mcp_config.env.OPENGRAPH_APP_ID).toBe("${user_config.app_id}");
    expect(manifest.user_config.app_id).toMatchObject({ type: "string", sensitive: true, required: true });
  });

  it("runs the stdio server it ships", () => {
    expect(manifest.server.entry_point).toBe("server/server-stdio.js");
    expect(manifest.server.mcp_config.args).toEqual(["${__dirname}/server/server-stdio.js"]);
  });

  it("advertises exactly the tools a local server offers", () => {
    const advertised = manifest.tools.map((t: { name: string }) => t.name).sort();
    expect(advertised).toEqual(localToolDefinitions.map((t) => t.name).sort());
  });
});

// The Cursor Marketplace reads the plugin straight from this repository.
describe("Cursor plugin", () => {
  it("has a kebab-case name and the package version", () => {
    expect(cursorPlugin.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(cursorPlugin.version).toBe(pkg.version);
  });

  it("connects to the hosted server the registry advertises", () => {
    const servers = Object.values(cursorMcp.mcpServers) as Array<{ url?: string }>;
    expect(servers).toHaveLength(1);
    expect(servers[0].url).toBe(serverJson.remotes[0].url);
  });

  it("ships its logo at a relative path", () => {
    expect(cursorPlugin.logo).toMatch(/^[^/.][^:]*$/);
    expect(() => readFileSync(resolve(process.cwd(), cursorPlugin.logo))).not.toThrow();
  });
});
