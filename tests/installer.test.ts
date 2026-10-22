import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
// Importing used to run the installer (and process.exit) as a side effect.
import { createBackup, install, readConfig, writeConfig } from "@/installer";

// The installer wrote the user's App ID into client configs and backups
// with default permissions, and replaced an unparsable config with an empty one.

const KEY = "11111111-1111-4111-8111-111111111111";
const mode = (p: string) => fs.statSync(p).mode & 0o777;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-install-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("config files", () => {
  it("are written readable by the user only", () => {
    const p = path.join(dir, "mcp.json");
    writeConfig(p, { mcpServers: {} });
    expect(mode(p)).toBe(0o600);
  });

  it("tightens an existing config that was readable by others", () => {
    const p = path.join(dir, "mcp.json");
    fs.writeFileSync(p, "{}", { mode: 0o644 });
    writeConfig(p, { mcpServers: {} });
    expect(mode(p)).toBe(0o600);
  });

  it("back up to a file readable by the user only", () => {
    const p = path.join(dir, "mcp.json");
    fs.writeFileSync(p, JSON.stringify({ mcpServers: { old: { command: "x", env: { KEY } } } }), { mode: 0o644 });
    const backup = createBackup(p)!;
    expect(mode(backup)).toBe(0o600);
  });
});

describe("install", () => {
  it("leaves a config it cannot parse untouched, and writes no backup", async () => {
    const p = path.join(dir, "settings.json");
    const original = '{\n  // a comment Zed allows\n  "theme": "One Dark"\n}\n';
    fs.writeFileSync(p, original);

    expect(await install("zed" as any, KEY, p)).toBe(false);
    expect(fs.readFileSync(p, "utf8")).toBe(original);
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
    expect(readConfig(p)).toBeNull();
  });

  it("adds the server alongside existing ones", async () => {
    const p = path.join(dir, "mcp.json");
    fs.writeFileSync(p, JSON.stringify({ mcpServers: { other: { command: "y" } } }));

    expect(await install("cursor" as any, KEY, p)).toBe(true);
    const written = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(Object.keys(written.mcpServers).sort()).toEqual(["opengraph", "other"]);
    expect(mode(p)).toBe(0o600);
  });

  it("never writes the key for VS Code, which prompts for it", async () => {
    const p = path.join(dir, ".vscode", "mcp.json");
    expect(await install("vscode" as any, KEY, p)).toBe(true);
    const text = fs.readFileSync(p, "utf8");
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).inputs[0]).toMatchObject({ type: "promptString", password: true });
  });
});
