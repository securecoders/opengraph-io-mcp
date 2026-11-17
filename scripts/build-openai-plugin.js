#!/usr/bin/env node

/**
 * Builds the ZIP uploaded to OpenAI's plugin portal (platform.openai.com/plugins):
 * openai-plugin/plugin.json and mcp.json at the root, plus the shared logo.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT_DIR, "openai-plugin");
const STAGING_DIR = path.join(ROOT_DIR, ".openai-plugin-staging");
const OUTPUT_FILE = path.join(ROOT_DIR, "opengraph-io-openai-plugin.zip");

function log(message) {
    console.log(`[build-openai-plugin] ${message}`);
}

fs.rmSync(STAGING_DIR, { recursive: true, force: true });
fs.rmSync(OUTPUT_FILE, { force: true });
fs.mkdirSync(path.join(STAGING_DIR, "assets"), { recursive: true });

fs.copyFileSync(path.join(SOURCE_DIR, "plugin.json"), path.join(STAGING_DIR, "plugin.json"));
fs.copyFileSync(path.join(SOURCE_DIR, "mcp.json"), path.join(STAGING_DIR, "mcp.json"));
fs.copyFileSync(path.join(ROOT_DIR, "assets", "logo.svg"), path.join(STAGING_DIR, "assets", "logo.svg"));

const plugin = JSON.parse(fs.readFileSync(path.join(STAGING_DIR, "plugin.json"), "utf8"));
if (!plugin.extensions["com.openai"].review.demo_recording_url) {
    log("WARNING: review.demo_recording_url is not set. MCP review requires it before you submit.");
}

execFileSync("zip", ["-qrX", OUTPUT_FILE, "."], { cwd: STAGING_DIR, stdio: "inherit" });
fs.rmSync(STAGING_DIR, { recursive: true, force: true });
log(`Wrote ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
