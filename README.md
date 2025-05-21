# OpenGraph MCP Server (og-mcp)

og‑mcp is a Model‑Context‑Protocol (MCP) server that makes every OpenGraph.io ( https://opengraph.io ) API endpoint available to AI agents (e.g. Anthropic Claude, Cursor, LangGraph) through the standard MCP interface.

Why?  If you already use OpenGraph.io to unfurl links, scrape HTML, extract article text, or capture screenshots, you can now give the same capabilities to your autonomous agents without exposing raw API keys.



## Available Tools

| Tool Name | OpenGraph.io API Endpoint | Description | Documentation |
|-----------|---------------------------|-------------|---------------|
| **Get OG Data** | `/api/1.1/site/<URL>` | Extracts Open Graph data from a URL | [OpenGraph.io Docs](https://www.opengraph.io/documentation#get-open-graph) |
| **Get OG Scrape Data** | `/api/1.1/scrape/<URL>` | Scrapes data from a URL using OpenGraph's scrape endpoint | [OpenGraph.io Docs](https://www.opengraph.io/documentation#scrape-site) |
| **Get OG Screenshot** | `/api/1.1/screenshot/<URL>` | Gets a screenshot of a webpage using OpenGraph's screenshot endpoint | [OpenGraph.io Docs](https://www.opengraph.io/documentation#screenshot-site) |

## How it works

```
┌─────────────┐          MCP (JSON‑RPC)           ┌──────────────┐
│  AI Client  │ ───────────────────────────────▶ │   og‑mcp     │
└─────────────┘                                  │  (this repo) │
        ▲                                        └──────┬───────┘
        │                                               │ REST
        │                                               ▼
        │                                    ┌────────────────────┐
        └─────────────────────────────────── │  api.opengraph.io  │
                                             └────────────────────┘
```

The og-mcp server acts as a bridge between AI clients (like Claude or other LLMs) and the OpenGraph.io API:

1. AI client makes a tool call to one of the available MCP functions
2. og-mcp server receives the request and formats it for the OpenGraph.io API
3. OpenGraph.io processes the request and returns data
4. og-mcp transforms the response into a format suitable for the AI client
5. AI client receives the structured data ready for use

This abstraction prevents exposing API keys directly to the AI while providing full access to OpenGraph.io capabilities.

## Setup and Running

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Build the TypeScript code:
   ```
   npm run build
   ```
4. Start the server:
   ```
   npm start
   ```

The server will run on port 3010 by default (configurable via PORT environment variable).

## Configuration

The server requires an OpenGraph.io App ID to function properly. You can provide this in several ways:

1. Using environment variables: Set `OPENGRAPH_APP_ID` or `APP_ID` in a `.env` file or as an environment variable
2. Using command-line arguments with stdio transport: `--app-id YOUR_APP_ID`
3. When using SSE transport: Include it in the URL as a query parameter (`?app_id=YOUR_APP_ID`)

Example `.env` file:
```
OPENGRAPH_APP_ID=your_app_id_here
# or
APP_ID=your_app_id_here
```

## Transport Options

### Stdio Transport (Recommended)

For command-line usage and npm global installation, the server can be run with stdio transport:

```
npm run start:stdio
```

You can pass the OpenGraph API key directly via command-line argument:

```
npm run start:stdio -- --app-id YOUR_APP_ID
```

When installed globally:

```
opengraph-io-mcp --app-id YOUR_APP_ID
```

This mode allows the server to be invoked directly by other applications that use MCP.

### HTTP/SSE Transport

This method runs a web server that can be accessed over HTTP and uses SSE for streaming:

```
npm start
```

## Global Installation

You can install this package globally via npm:

```
npm install -g opengraph-io-mcp
```

After installation, you can use it from anywhere:
```
opengraph-io-mcp
```

This will start the server with stdio transport, which can be configured in MCP applications.

## Integrating with Cursor/Claude

### Prerequisites

- Have Cursor installed on your machine
- Ensure this MCP server is running locally or deployed to a publicly accessible endpoint

### Integration Steps

#### Running with stdio transport in Cursor (Recommended)

If you've installed the package globally, you can use it in Cursor like this:

```json
{
    "mcpServers": {
        "og-mcp": {
            "command": "opengraph-io-mcp"
        }
    }
}
```

For passing the OpenGraph API key directly in the configuration, you have two options:

As command-line arguments:

```json
{
    "mcpServers": {
        "og-mcp": {
            "command": "opengraph-io-mcp",
            "args": ["--app-id", "YOUR_APP_ID"]
        }
    }
}
```

Or as an environment variable (recommended):

```json
{
    "mcpServers": {
        "og-mcp": {
            "command": "opengraph-io-mcp",
            "env": {
                "APP_ID": "YOUR_APP_ID"
            }
        }
    }
}
```

You can also use npx to run

```json
{
    "mcpServers": {
        "og-mcp": {
            "command": "npx",
            "args": ["opengraph-io-mcp"],
            "env": {
                "APP_ID": "YOUR_APP_ID"
            }
        }
    }
}
```

#### Using HTTP/SSE Transport

Start the MCP server:
```
npm start
```

Add the following to your Cursor mcp.json:
   
```json
{
    "mcpServers": {
        "og-mcp": {
            "url": "http://localhost:3010/sse?app_id={YOUR_APP_ID}"
        }
    }
}
```

### Running on Windsurf

#### Using stdio transport (Recommended)

Add this to your `./codeium/windsurf/model_config.json`:

```json
{
  "mcpServers": {
    "og-mcp": {
      "command": "opengraph-io-mcp",
      "env": {
        "APP_ID": "YOUR_APP_ID"
      }
    }
  }
}
```

Using npx:

```json
{
  "mcpServers": {
    "og-mcp": {
      "command": "npx",
      "args": ["opengraph-io-mcp"],
      "env": {
        "APP_ID": "YOUR_APP_ID"
      }
    }
  }
}
```

#### Using HTTP/SSE Transport

Add this to your `./codeium/windsurf/model_config.json`:

```json
{
  "mcpServers": {
    "og-mcp": {
      "serverUrl": "http://localhost:3010/sse?app_id=YOUR_APP_ID"
    }
  }
}
```

## Troubleshooting

- If tools aren't showing up, check that the server is running and the URL is correctly configured in Cursor
- Check the server logs for any connection or authorization issues
- Verify that Claude has been instructed to use the specific tools by name 