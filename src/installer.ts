#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// Client configuration types
interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

interface McpConfig {
    mcpServers?: Record<string, McpServerConfig>;
    context_servers?: Record<string, McpServerConfig>; // Zed uses this
    servers?: Record<string, McpServerConfig & { type: string }>; // VS Code uses this
    inputs?: Array<{ type: string; id: string; description: string; password?: boolean }>;
}

// Supported clients
type ClientType = "cursor" | "claude-desktop" | "windsurf" | "vscode" | "zed" | "jetbrains";

interface ClientInfo {
    name: string;
    configKey: "mcpServers" | "context_servers" | "servers";
    getConfigPath: () => string | null;
    needsVSCodeFormat?: boolean;
}

// Get home directory
const HOME = os.homedir();

// Client definitions with config paths
const CLIENTS: Record<ClientType, ClientInfo> = {
    cursor: {
        name: "Cursor",
        configKey: "mcpServers",
        getConfigPath: () => {
            const platform = process.platform;
            if (platform === "darwin" || platform === "linux") {
                return path.join(HOME, ".cursor", "mcp.json");
            } else if (platform === "win32") {
                return path.join(process.env.APPDATA || "", "Cursor", "mcp.json");
            }
            return null;
        },
    },
    "claude-desktop": {
        name: "Claude Desktop",
        configKey: "mcpServers",
        getConfigPath: () => {
            const platform = process.platform;
            if (platform === "darwin") {
                return path.join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json");
            } else if (platform === "win32") {
                return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
            } else if (platform === "linux") {
                return path.join(HOME, ".config", "Claude", "claude_desktop_config.json");
            }
            return null;
        },
    },
    windsurf: {
        name: "Windsurf",
        configKey: "mcpServers",
        getConfigPath: () => {
            const platform = process.platform;
            if (platform === "darwin" || platform === "linux") {
                return path.join(HOME, ".codeium", "windsurf", "mcp_config.json");
            } else if (platform === "win32") {
                return path.join(process.env.APPDATA || "", "Codeium", "windsurf", "mcp_config.json");
            }
            return null;
        },
    },
    vscode: {
        name: "VS Code",
        configKey: "servers",
        needsVSCodeFormat: true,
        getConfigPath: () => {
            // VS Code uses project-local config
            return path.join(process.cwd(), ".vscode", "mcp.json");
        },
    },
    zed: {
        name: "Zed",
        configKey: "context_servers",
        getConfigPath: () => {
            const platform = process.platform;
            if (platform === "darwin" || platform === "linux") {
                return path.join(HOME, ".config", "zed", "settings.json");
            }
            // Zed not available on Windows
            return null;
        },
    },
    jetbrains: {
        name: "JetBrains AI Assistant",
        configKey: "mcpServers",
        getConfigPath: () => {
            // JetBrains config location varies by IDE, use a common location
            const platform = process.platform;
            if (platform === "darwin") {
                return path.join(HOME, "Library", "Application Support", "JetBrains", "mcp.json");
            } else if (platform === "win32") {
                return path.join(process.env.APPDATA || "", "JetBrains", "mcp.json");
            } else if (platform === "linux") {
                return path.join(HOME, ".config", "JetBrains", "mcp.json");
            }
            return null;
        },
    },
};

// Parse command line arguments
function parseArgs(): { client?: ClientType; appId?: string; help?: boolean } {
    const args = process.argv.slice(2);
    const result: { client?: ClientType; appId?: string; help?: boolean } = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            result.help = true;
        } else if (arg === "--client" && i + 1 < args.length) {
            result.client = args[++i] as ClientType;
        } else if (arg === "--app-id" && i + 1 < args.length) {
            result.appId = args[++i];
        }
    }

    return result;
}

// Show help
function showHelp(): void {
    console.log(`
OpenGraph MCP Installer

Usage:
  npx opengraph-io-mcp-install [options]

Options:
  --client <name>   Target client (cursor, claude-desktop, windsurf, vscode, zed, jetbrains)
  --app-id <id>     Your OpenGraph.io App ID
  --help, -h        Show this help message

Examples:
  # Interactive mode
  npx opengraph-io-mcp-install

  # Direct mode
  npx opengraph-io-mcp-install --client cursor --app-id YOUR_APP_ID

Supported Clients:
  cursor         ~/.cursor/mcp.json
  claude-desktop ~/Library/Application Support/Claude/claude_desktop_config.json
  windsurf       ~/.codeium/windsurf/mcp_config.json
  vscode         .vscode/mcp.json (project directory)
  zed            ~/.config/zed/settings.json
  jetbrains      JetBrains AI Assistant config
`);
}

// Create readline interface for interactive input
function createReadline(): readline.Interface {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

// Prompt user for input
async function prompt(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

// Select client interactively
async function selectClient(rl: readline.Interface): Promise<ClientType | null> {
    console.log("\nSelect your MCP client:\n");
    const clientKeys = Object.keys(CLIENTS) as ClientType[];
    
    clientKeys.forEach((key, index) => {
        const client = CLIENTS[key];
        const configPath = client.getConfigPath();
        const pathInfo = configPath ? ` (${configPath})` : " (not available on this OS)";
        console.log(`  ${index + 1}. ${client.name}${pathInfo}`);
    });

    const answer = await prompt(rl, "\nEnter number (1-6): ");
    const index = parseInt(answer, 10) - 1;

    if (index >= 0 && index < clientKeys.length) {
        return clientKeys[index];
    }

    return null;
}

// Create backup of existing config
function createBackup(configPath: string): string | null {
    if (!fs.existsSync(configPath)) {
        return null;
    }

    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
    return backupPath;
}

// Ensure directory exists
function ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Read existing config or return empty object
function readConfig(configPath: string): McpConfig {
    if (!fs.existsSync(configPath)) {
        return {};
    }

    try {
        const content = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(content);
    } catch {
        console.error(`Warning: Could not parse existing config at ${configPath}`);
        return {};
    }
}

// Generate the OpenGraph MCP server configuration
function generateServerConfig(appId: string): McpServerConfig {
    return {
        command: "npx",
        args: ["-y", "opengraph-io-mcp"],
        env: {
            OPENGRAPH_APP_ID: appId,
        },
    };
}

// Generate VS Code format config with input prompt
function generateVSCodeConfig(_appId: string): McpConfig {
    return {
        inputs: [
            {
                type: "promptString",
                id: "opengraph-app-id",
                description: "OpenGraph App ID",
                password: true,
            },
        ],
        servers: {
            opengraph: {
                type: "stdio",
                command: "npx",
                args: ["-y", "opengraph-io-mcp"],
                env: {
                    OPENGRAPH_APP_ID: "${input:opengraph-app-id}",
                },
            },
        },
    };
}

// Merge config with existing
function mergeConfig(existing: McpConfig, client: ClientInfo, appId: string): McpConfig {
    const serverConfig = generateServerConfig(appId);

    if (client.needsVSCodeFormat) {
        // VS Code has a different format
        const vsCodeConfig = generateVSCodeConfig(appId);
        return {
            ...existing,
            inputs: [
                ...(existing.inputs || []).filter((i) => i.id !== "opengraph-app-id"),
                ...(vsCodeConfig.inputs || []),
            ],
            servers: {
                ...existing.servers,
                opengraph: vsCodeConfig.servers!.opengraph,
            },
        };
    }

    // Standard format (mcpServers or context_servers)
    const key = client.configKey;
    return {
        ...existing,
        [key]: {
            ...(existing[key] || {}),
            opengraph: serverConfig,
        },
    };
}

// Write config to file
function writeConfig(configPath: string, config: McpConfig): void {
    ensureDir(configPath);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Main installation function
async function install(clientType: ClientType, appId: string): Promise<boolean> {
    const client = CLIENTS[clientType];
    const configPath = client.getConfigPath();

    if (!configPath) {
        console.error(`Error: ${client.name} is not available on this operating system.`);
        return false;
    }

    console.log(`\nInstalling OpenGraph MCP for ${client.name}...`);
    console.log(`Config path: ${configPath}`);

    // Create backup if file exists
    const backupPath = createBackup(configPath);
    if (backupPath) {
        console.log(`Backup created: ${backupPath}`);
    }

    // Read existing config
    const existingConfig = readConfig(configPath);

    // Merge with new config
    const newConfig = mergeConfig(existingConfig, client, appId);

    // Write config
    try {
        writeConfig(configPath, newConfig);
        console.log(`\n✓ Successfully installed OpenGraph MCP for ${client.name}!`);
        console.log(`\nNext steps:`);
        console.log(`  1. Restart ${client.name} to load the new configuration`);
        console.log(`  2. The OpenGraph tools should now be available`);
        return true;
    } catch (error) {
        console.error(`Error writing config: ${error}`);
        if (backupPath) {
            console.log(`You can restore from backup: ${backupPath}`);
        }
        return false;
    }
}

// Main entry point
async function main(): Promise<void> {
    const args = parseArgs();

    if (args.help) {
        showHelp();
        process.exit(0);
    }

    let clientType = args.client;
    let appId = args.appId;

    // Interactive mode if missing arguments
    if (!clientType || !appId) {
        const rl = createReadline();

        try {
            if (!clientType) {
                const selected = await selectClient(rl);
                if (!selected) {
                    console.error("Invalid selection. Exiting.");
                    process.exit(1);
                }
                clientType = selected;
            }

            if (!appId) {
                console.log("");
                appId = await prompt(rl, "Enter your OpenGraph.io App ID: ");
                if (!appId) {
                    console.error("App ID is required. Exiting.");
                    process.exit(1);
                }
            }
        } finally {
            rl.close();
        }
    }

    // Validate client
    if (!CLIENTS[clientType]) {
        console.error(`Unknown client: ${clientType}`);
        console.error(`Valid clients: ${Object.keys(CLIENTS).join(", ")}`);
        process.exit(1);
    }

    // Run installation
    const success = await install(clientType, appId);
    process.exit(success ? 0 : 1);
}

main().catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
});
