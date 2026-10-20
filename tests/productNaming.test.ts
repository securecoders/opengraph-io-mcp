import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { SERVER_INSTRUCTIONS } from "@/mcp";
import { toolDefinitions } from "@/tools/registry";

// The audit product is "Site Audit" internally but "Open Graph Audit" to
// customers. Tool names (startSiteAudit, getSiteAuditReport, ...) are identifiers
// saved in agent workflows and stay as they are; what an AI client or user
// reads must use the new name. Case-sensitive, so the ordinary phrase
// "site audit" in descriptions is still allowed.
const OLD_NAME = /Site\s+Audit/;

describe("Open Graph Audit naming", () => {
  it("no tool title or description uses the old product name", () => {
    const offenders = toolDefinitions
      .filter((t) => OLD_NAME.test(`${t.title ?? ""} ${t.annotations?.title ?? ""} ${t.description ?? ""}`))
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  it("server instructions do not use the old product name", () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(OLD_NAME);
  });

  // Result headings and auth errors are built inside the tools and formatters,
  // so scan those sources with comments stripped.
  const ROOT = join(__dirname, "..");
  const toolFiles = readdirSync(join(ROOT, "src/tools"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `src/tools/${d.name}/index.ts`);

  it.each(["src/utils/format.ts", ...toolFiles])(
    "%s has no old product name outside comments",
    (file) => {
      const src = readFileSync(join(ROOT, file), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
      expect(src).not.toMatch(OLD_NAME);
      // Hyphenated prose like "site-audit features"; paths and imports are followed by / or -.
      expect(src).not.toMatch(/site-audit\s/);
    },
  );
});
