#!/usr/bin/env node

/**
 * Builds the Claude Desktop extension (.mcpb): the stdio server, its production
 * dependencies installed from the lockfile, and extension/manifest.json.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const STAGING_DIR = path.join(ROOT_DIR, ".mcpb-staging");
const OUTPUT_FILE = path.join(ROOT_DIR, "opengraph-io-mcp.mcpb");

// The extension runs the stdio server only. The HTTP server, its auth layer and
// the installer are not needed there, and source maps point at unshipped src/.
const EXCLUDE = new Set([
    "server-http.js",
    "http",
    "installer.js",
    path.join("utils", "oauth.js"),
]);

function log(message) {
    console.log(`[build-mcpb] ${message}`);
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
    }
    fs.mkdirSync(dir, { recursive: true });
}

function copyDist(src, dest, rel = "") {
    for (const entry of fs.readdirSync(src)) {
        const entryRel = rel ? path.join(rel, entry) : entry;
        if (EXCLUDE.has(entryRel) || entry.endsWith(".map")) continue;
        const from = path.join(src, entry);
        const to = path.join(dest, entry);
        if (fs.statSync(from).isDirectory()) {
            fs.mkdirSync(to, { recursive: true });
            copyDist(from, to, entryRel);
        } else {
            fs.copyFileSync(from, to);
        }
    }
}

function createZip(sourceDir, outputPath) {
    if (process.platform === "win32") {
        execSync(
            `powershell -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outputPath}' -Force"`,
            { stdio: "inherit" }
        );
    } else {
        execSync(`zip -qr "${outputPath}" .`, { cwd: sourceDir, stdio: "inherit" });
    }
}

function main() {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "extension", "manifest.json"), "utf-8"));
    if (manifest.version !== pkg.version) {
        throw new Error(`extension/manifest.json is ${manifest.version} but package.json is ${pkg.version}`);
    }

    try {
        log(`Building opengraph-io-mcp ${pkg.version}...`);
        execSync("npm run build", { cwd: ROOT_DIR, stdio: "inherit" });

        cleanDir(STAGING_DIR);
        fs.copyFileSync(path.join(ROOT_DIR, "extension", "manifest.json"), path.join(STAGING_DIR, "manifest.json"));

        const serverDir = path.join(STAGING_DIR, "server");
        fs.mkdirSync(serverDir, { recursive: true });
        copyDist(path.join(ROOT_DIR, "dist"), serverDir);

        // npm ci needs package.json and the lockfile exactly as committed, so the
        // bundle installs the same dependency tree the package was tested with.
        fs.copyFileSync(path.join(ROOT_DIR, "package.json"), path.join(serverDir, "package.json"));
        fs.copyFileSync(path.join(ROOT_DIR, "package-lock.json"), path.join(serverDir, "package-lock.json"));
        log("Installing production dependencies from the lockfile...");
        execSync("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", { cwd: serverDir, stdio: "inherit" });

        fs.writeFileSync(
            path.join(serverDir, "package.json"),
            JSON.stringify({ name: pkg.name, version: pkg.version, private: true, main: "server-stdio.js" }, null, 2)
        );
        fs.rmSync(path.join(serverDir, "package-lock.json"));

        if (fs.existsSync(OUTPUT_FILE)) fs.unlinkSync(OUTPUT_FILE);
        createZip(STAGING_DIR, OUTPUT_FILE);
        fs.rmSync(STAGING_DIR, { recursive: true });

        const sizeMB = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2);
        log(`Built ${path.basename(OUTPUT_FILE)} (${sizeMB} MB). Install it from Claude Desktop: Settings > Extensions.`);
    } catch (error) {
        console.error("Build failed:", error);
        if (fs.existsSync(STAGING_DIR)) fs.rmSync(STAGING_DIR, { recursive: true });
        process.exit(1);
    }
}

main();
