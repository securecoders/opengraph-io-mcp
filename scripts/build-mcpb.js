#!/usr/bin/env node

/**
 * Build script for creating a Claude Desktop Extension (.mcpb) package
 * 
 * This script:
 * 1. Builds the TypeScript code
 * 2. Copies necessary files to a staging directory
 * 3. Installs production dependencies
 * 4. Creates a ZIP archive with .mcpb extension
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createWriteStream } = require("fs");

// We'll use the built-in zlib and a simple archive approach
// For production, consider using 'archiver' package

const ROOT_DIR = path.resolve(__dirname, "..");
const STAGING_DIR = path.join(ROOT_DIR, ".mcpb-staging");
const OUTPUT_FILE = path.join(ROOT_DIR, "opengraph-mcp.mcpb");

// Files to include in the extension
const FILES_TO_COPY = [
    "extension/manifest.json",
    "dist/server-stdio.js",
    "dist/server-stdio.js.map",
    "dist/mcp.js",
    "dist/mcp.js.map",
    "dist/tools",
    "dist/utils",
    "dist/config",
];

function log(message) {
    console.log(`[build-mcpb] ${message}`);
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true });
    }
    fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        const entries = fs.readdirSync(src);
        for (const entry of entries) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

async function createZip(sourceDir, outputPath) {
    // Use native zip command if available (macOS/Linux)
    // For cross-platform, we could use archiver package
    const platform = process.platform;
    
    if (platform === "win32") {
        // Windows: Use PowerShell's Compress-Archive
        log("Creating ZIP using PowerShell...");
        execSync(
            `powershell -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outputPath}' -Force"`,
            { stdio: "inherit" }
        );
    } else {
        // macOS/Linux: Use zip command
        log("Creating ZIP using native zip...");
        const originalDir = process.cwd();
        process.chdir(sourceDir);
        execSync(`zip -r "${outputPath}" .`, { stdio: "inherit" });
        process.chdir(originalDir);
    }
}

async function main() {
    try {
        log("Starting Claude Desktop Extension build...");
        
        // Step 1: Build TypeScript
        log("Building TypeScript...");
        execSync("npm run build", { cwd: ROOT_DIR, stdio: "inherit" });
        
        // Step 2: Clean and create staging directory
        log("Preparing staging directory...");
        cleanDir(STAGING_DIR);
        
        // Step 3: Copy manifest.json to root of staging
        const manifestSrc = path.join(ROOT_DIR, "extension", "manifest.json");
        const manifestDest = path.join(STAGING_DIR, "manifest.json");
        fs.copyFileSync(manifestSrc, manifestDest);
        log("Copied manifest.json");
        
        // Step 4: Copy server files to server/ directory
        const serverDir = path.join(STAGING_DIR, "server");
        fs.mkdirSync(serverDir, { recursive: true });
        
        // Copy dist files
        const distSrc = path.join(ROOT_DIR, "dist");
        const distDest = path.join(serverDir);
        
        // Copy all dist contents
        const distFiles = fs.readdirSync(distSrc);
        for (const file of distFiles) {
            const srcPath = path.join(distSrc, file);
            const destPath = path.join(distDest, file);
            copyRecursive(srcPath, destPath);
        }
        log("Copied server files");
        
        // Step 5: Create package.json for the extension (minimal)
        const extensionPackageJson = {
            name: "opengraph-mcp-extension",
            version: "1.0.6",
            main: "server-stdio.js",
            dependencies: {}
        };
        
        // Read original package.json to get dependencies
        const originalPkg = JSON.parse(
            fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8")
        );
        extensionPackageJson.dependencies = originalPkg.dependencies;
        
        fs.writeFileSync(
            path.join(serverDir, "package.json"),
            JSON.stringify(extensionPackageJson, null, 2)
        );
        log("Created extension package.json");
        
        // Step 6: Install production dependencies in staging
        log("Installing production dependencies...");
        execSync("npm install --production --ignore-scripts", {
            cwd: serverDir,
            stdio: "inherit",
        });
        
        // Step 7: Remove output file if exists
        if (fs.existsSync(OUTPUT_FILE)) {
            fs.unlinkSync(OUTPUT_FILE);
        }
        
        // Step 8: Create ZIP archive
        log("Creating .mcpb archive...");
        await createZip(STAGING_DIR, OUTPUT_FILE);
        
        // Step 9: Clean up staging directory
        log("Cleaning up...");
        fs.rmSync(STAGING_DIR, { recursive: true });
        
        // Done!
        const stats = fs.statSync(OUTPUT_FILE);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        
        log("");
        log("========================================");
        log("  Build complete!");
        log(`  Output: ${OUTPUT_FILE}`);
        log(`  Size: ${sizeMB} MB`);
        log("========================================");
        log("");
        log("To install in Claude Desktop:");
        log("  1. Open Claude Desktop");
        log("  2. Go to Settings > Extensions");
        log("  3. Click 'Advanced settings' > 'Install Extension...'");
        log("  4. Select the .mcpb file");
        log("");
        
    } catch (error) {
        console.error("Build failed:", error);
        
        // Clean up on failure
        if (fs.existsSync(STAGING_DIR)) {
            fs.rmSync(STAGING_DIR, { recursive: true });
        }
        
        process.exit(1);
    }
}

main();
