#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Parse command-line arguments
const parseArgs = () => {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--app-id' && i + 1 < args.length) {
      options.appId = args[i + 1];
      i++; // Skip the next argument
    }
  }
  
  return options;
};

// Get command-line arguments
const options = parseArgs();

// Set OpenGraph App ID from command-line if provided
if (options.appId) {
  process.env.OPENGRAPH_APP_ID = options.appId;
}

// Create the MCP server
const { server, cleanup } = createServer();

// Main function to run the server
async function run() {
  console.log("Starting og-mcp server with stdio transport...");
  
  // Create and connect the stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Handle server close
  server.onclose = async () => {
    console.log("Server closing...");
    await cleanup();
    await server.close();
  };
}

// Run the server
run().catch(err => {
  console.error("Error running server:", err);
  process.exit(1);
}); 