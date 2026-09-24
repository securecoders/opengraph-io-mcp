import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// package.json has no "type": "module", so under NodeNext a .ts spec is typed as
// CommonJS and import.meta is a compile error. Vitest runs from the repo root.
const readJson = (name: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), name), "utf8"));

const pkg = readJson("package.json");
const serverJson = readJson("server.json");

// This package publishes to npm and is bundled into a .mcpb extension, so a
// build-only dependency listed under `dependencies` ships to every user twice:
// `npm ci --omit=dev` still installs it in the Docker image, and
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

  it("starts the streamable HTTP server", () => {
    expect(pkg.main).toBe("dist/server-http.js");
    expect(pkg.scripts.start).toContain("dist/server-http.js");
  });
});

// publish.yml reads the npm version from package.json but hands the registry
// step server.json. A bump that misses one makes the registry publish retry
// five times and fail.
describe("version", () => {
  it("matches across package.json and server.json", () => {
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.packages[0].version).toBe(pkg.version);
  });
});
