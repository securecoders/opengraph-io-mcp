import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { successEnvelope, catchToEnvelope } from "@/tools/envelope";

/*
 * Static, agent-friendly catalog of what this MCP server can do.
 *
 * Designed so a planning agent can introspect once and pick the right tool
 * for its task without scraping docs. Keep entries terse but with enough
 * shape (category, credit cost, chain hints) for routing decisions.
 */

type ToolCategory = "web" | "image" | "composite" | "meta";

interface ToolCapability {
    name: string;
    category: ToolCategory;
    summary: string;
    credit_cost: number | string;
    chain_hints?: string[];
    proxy_aware?: boolean;
}

const CATALOG: ToolCapability[] = [
    {
        name: ToolNames.RESEARCH_URL,
        category: "composite",
        summary: "One-shot URL research: og metadata + body extract + optional screenshot in a single envelope.",
        credit_cost: "2 (+20 if include_screenshot; cached screenshots: +1)",
        chain_hints: [
            "Use this instead of orchestrating getOgData + getOgExtract + getOgScreenshot yourself.",
            "If body.text is empty, retry with full_render: true.",
        ],
        proxy_aware: true,
    },
    {
        name: ToolNames.GET_OG_DATA,
        category: "web",
        summary: "Fetch OpenGraph / Twitter Card / inferred metadata for a URL.",
        credit_cost: 1,
        chain_hints: [
            "Cheapest call for link previews \u2014 prefer this over scraping when you only need title/description/image.",
            "If hybridGraph is empty, retry with full_render: true for SPAs.",
        ],
        proxy_aware: true,
    },
    {
        name: ToolNames.GET_OG_SCRAPE_DATA,
        category: "web",
        summary: "Return raw HTML of a page (with optional JS rendering).",
        credit_cost: 1,
        chain_hints: [
            "Use when you need the full raw HTML \u2014 otherwise prefer getOgExtract for targeted selectors.",
        ],
        proxy_aware: true,
    },
    {
        name: ToolNames.GET_OG_EXTRACT,
        category: "web",
        summary: "Extract content matching a list of CSS selectors / HTML elements.",
        credit_cost: 1,
        chain_hints: [
            "Cheaper than getOgScrapeData if you only need specific elements.",
            "Common selector sets: ['h1','h2','h3','p'] for article body, ['article','main'] for main content.",
        ],
        proxy_aware: true,
    },
    {
        name: ToolNames.GET_OG_SCREENSHOT,
        category: "web",
        summary: "Capture a screenshot of a URL (viewport or full page, multiple formats and dimensions).",
        credit_cost: "20 (cached: 1)",
        chain_hints: [
            "Set full_page: true for long pages; otherwise the viewport is captured.",
            "Use dimensions: 'xs' for mobile-shaped screenshots.",
            "Cache hits cost just 1 credit \u2014 leave cache_ok at its default unless you need fresh.",
        ],
        proxy_aware: true,
    },
    {
        name: ToolNames.GET_OG_QUERY,
        category: "web",
        summary: "Ask a natural-language question about a URL and get a structured answer.",
        credit_cost: "1+ (varies with modelSize)",
        chain_hints: [
            "Pass responseStructure to constrain the answer to a JSON shape.",
            "Use modelSize: 'standard' for harder questions; 'nano' is default and cheapest.",
        ],
        proxy_aware: true,
    },
    {
        name: ToolNames.GENERATE_IMAGE,
        category: "image",
        summary: "Generate a branded image (illustration, diagram, OG card, icon, QR code).",
        credit_cost: "varies (model + outputStyle)",
        chain_hints: [
            "For diagrams, pass diagramCode + diagramFormat to bypass AI styling and get deterministic output.",
            "After generation, use inspectImageSession to find the assetId for iterateImage.",
        ],
    },
    {
        name: ToolNames.ITERATE_IMAGE,
        category: "image",
        summary: "Refine or modify a previously generated image by session/asset id.",
        credit_cost: "varies",
        chain_hints: [
            "Include the original diagram source in your prompt to preserve structure when iterating.",
        ],
    },
    {
        name: ToolNames.INSPECT_IMAGE_SESSION,
        category: "image",
        summary: "List all assets for a session with prompts, toolchains, and parent-child lineage.",
        credit_cost: 0,
        chain_hints: [
            "Call this between generateImage and iterateImage to find asset ids.",
        ],
    },
    {
        name: ToolNames.EXPORT_IMAGE_ASSET,
        category: "image",
        summary: "Export a generated image asset inline (base64) and optionally to disk (stdio transport only).",
        credit_cost: 0,
        chain_hints: [
            "destinationPath only works when the server runs in local stdio mode.",
        ],
    },
    {
        name: ToolNames.LIST_CAPABILITIES,
        category: "meta",
        summary: "Return this catalog. Call once at the start of a session to plan tool routing.",
        credit_cost: 0,
    },
];

class ListCapabilitiesTool extends BaseTool {
    constructor() {
        super();
    }

    name = ToolNames.LIST_CAPABILITIES;
    annotations = {
        title: "List MCP Capabilities",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    };
    description = `Return a structured catalog of every tool this MCP server exposes \u2014 names, categories, credit costs, and chain hints \u2014 so a planning agent can route tasks without scraping docs.

WHEN TO USE:
- Once at the start of a session to enumerate what's available.
- When deciding between similar tools (e.g. ${ToolNames.GET_OG_DATA} vs ${ToolNames.RESEARCH_URL}).
- When teaching a downstream model what this server can do.

OUTPUT: { categories: string[], tools: ToolCapability[], doc_links: {...} }. Free (0 credits). Idempotent.`;

    inputSchema = z.object({}).describe("No input required.");

    outputSchema = z.object({
        categories: z.array(z.string()),
        tools: z.array(z.object({
            name: z.string(),
            category: z.string(),
            summary: z.string(),
            credit_cost: z.union([z.number(), z.string()]),
            chain_hints: z.array(z.string()).optional(),
            proxy_aware: z.boolean().optional(),
        })),
        doc_links: z.object({
            quickstart: z.string(),
            tool_catalog: z.string(),
            discovery: z.string(),
        }),
    });

    async execute(_args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const categories = Array.from(new Set(CATALOG.map((t) => t.category)));
            const data = {
                categories,
                tools: CATALOG,
                doc_links: {
                    quickstart: "https://www.opengraph.io/docs/mcp",
                    tool_catalog: "https://www.opengraph.io/docs/agents/tool-catalog",
                    discovery: "https://www.opengraph.io/.well-known/mcp.json",
                },
            };
            return successEnvelope(data, { tool: this.name });
        } catch (err) {
            return catchToEnvelope(err, { tool: this.name });
        }
    }
}

export default ListCapabilitiesTool;
