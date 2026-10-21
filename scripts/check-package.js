#!/usr/bin/env node

/**
 * Release gate: fails if the npm tarball or the .mcpb would ship anything they
 * shouldn't, or if their versions disagree. Run after `npm run build`; pass the
 * .mcpb path to check the extension too.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const problems = [];

// Hosting code, local state and build leftovers never belong to users.
const FORBIDDEN = [
    /(^|\/)http\//, /server-http\.js/, /utils\/oauth\.js/, /\.map$/,
    /(^|\/)config\//, /(^|\/)tests?\//, /\.env/, /\.png$/, /Dockerfile/, /\.code-workspace$/,
];

function check(label, files, required) {
    for (const file of required) {
        if (!files.includes(file)) problems.push(`${label}: missing ${file}`);
    }
    for (const file of files) {
        if (file.includes("node_modules/")) continue;
        if (FORBIDDEN.some((re) => re.test(file))) problems.push(`${label}: should not ship ${file}`);
    }
}

const packed = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" })
)[0];
check("npm", packed.files.map((f) => f.path), ["package.json", "README.md", ...Object.values(pkg.bin)]);

const mcpb = process.argv[2];
if (mcpb) {
    const entries = execFileSync("unzip", ["-Z1", mcpb], { encoding: "utf8" }).split("\n").filter(Boolean);
    check("mcpb", entries, ["manifest.json", "server/server-stdio.js", "server/package.json"]);
    const manifest = JSON.parse(execFileSync("unzip", ["-p", mcpb, "manifest.json"], { encoding: "utf8" }));
    if (manifest.version !== pkg.version) problems.push(`mcpb: manifest ${manifest.version}, package ${pkg.version}`);
}

if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
}
console.log(`package check passed (${packed.files.length} files in the npm tarball${mcpb ? ", extension checked" : ""})`);
