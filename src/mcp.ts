import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    CallToolRequestSchema,
    CompleteRequestSchema,
    CreateMessageRequest,
    CreateMessageResultSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ListToolsRequestSchema,
    LoggingLevel,
    ReadResourceRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import tools, { ToolNames } from "@/tools";
import GetOgDataTool from "@/tools/get-og-data";
import GetOgScrapeDataTool from "@/tools/get-og-scrape-data";
import GetOgScreenshotTool from "@/tools/get-og-screenshot";
import GetOgQueryTool from "@/tools/get-og-query";
import GetOgExtractTool from "@/tools/get-og-extract";
import GetOgMarkdownTool from "@/tools/get-og-markdown";
// Image generation tools
import GenerateImageTool from "@/tools/generate-image";
import IterateImageTool from "@/tools/iterate-image";
import InspectImageSessionTool from "@/tools/inspect-image-session";
import ExportImageAssetTool from "@/tools/export-image-asset";
// Site Audit tools
import DiscoverSiteUrlsTool from "@/tools/discover-site-urls";
import StartSiteAuditTool from "@/tools/start-site-audit";
import GetSiteAuditStatusTool from "@/tools/get-site-audit-status";
import GetSiteAuditReportTool from "@/tools/get-site-audit-report";
import PreviewPageAuditTool from "@/tools/preview-page-audit";
import GetLinkPreviewTool from "@/tools/get-link-preview";
import { getAuthContext } from "@/utils/sessionIdToAppId";
import { getAssetFile } from "@/utils/og-image-api";

/* Input schemas for tools implemented in this server */

// Example completion values for prompts
const EXAMPLE_COMPLETIONS = {
    diagramType: ["flowchart", "sequence", "architecture", "er-diagram", "state", "other"],
    assetType: ["icons", "social-cards", "diagrams", "illustrations"],
    style: ["outline", "filled", "duotone", "3d"],
    count: ["2", "3", "4", "5", "6", "7", "8", "9", "10"],
};


enum PromptName {
    // Image generation workflows
    CREATE_BRANDED_DIAGRAM = "create-branded-diagram",
    ITERATE_AND_REFINE = "iterate-and-refine",
    CREATE_ASSET_SET = "create-asset-set",
    QUICK_ICON = "quick-icon",
    // Web data workflows
    ANALYZE_WEBPAGE = "analyze-webpage",
    EXTRACT_STRUCTURED_DATA = "extract-structured-data",
    GET_PAGE_CONTENT = "get-page-content",
    // Site Audit workflow
    RUN_SITE_AUDIT = "run-site-audit",
}

const SERVER_INSTRUCTIONS = `\
OpenGraph.io MCP Server — fetch, analyze, and extract content from any URL on the web.

DATA TOOLS — choose based on your goal:

getOgData
  Fetch Open Graph metadata and social preview data (title, description, image, favicon) for a URL.
  The response has three sources: openGraph (raw OG tags), htmlInferred (HTML fallbacks), and
  hybridGraph (best-of-all-sources merge). Always use hybridGraph as your primary read.

getOgMarkdown
  Convert a URL's HTML to clean, readable Markdown — strips navigation, ads, and boilerplate.
  IMPORTANT: auto_render does not apply to the markdown pipeline. For JavaScript-heavy SPAs you
  must explicitly pass full_render: true, or you may receive an empty or incomplete result.

getOgScrapeData
  Fetch the raw HTML of a URL. Use for custom parsing, link extraction, or when you need the
  full DOM structure. Returns the full HTML in the structured 'html' field.

getOgExtract
  Pull specific content from a page. Two modes:
  - html_elements (array of tag names, e.g. ['h1','p','a']): returns concatenatedText — all
    matched element text joined into one string. Good for bulk content extraction.
  - selectors (CSS selector map, e.g. {"price": ".price", "title": "h1"}): returns a data object
    keyed by your label names. Good for structured field scraping (price, SKU, title, etc.).
  Both modes return concatenatedText; data is only present when selectors is used.

getOgScreenshot
  Capture a page as an image. Returns screenshotUrl — a hosted URL to the screenshot file,
  not inline image data. Supports full-page capture, custom viewport, dark mode, and
  cookie-banner dismissal.

getOgQuery
  Ask a natural-language question about a page's content and receive an AI-generated answer.
  Use responseStructure to extract typed structured data. Costs 100–200 credits per call —
  use only when the other tools cannot answer the question directly.

FETCH PARAMETERS (available on most data tools):
  auto_render     — default on: detects JS-heavy pages and re-fetches with browser rendering
  full_render     — forces browser rendering on every request; use when auto_render is insufficient
  use_proxy / use_premium / use_superior — proxy tiers for geo-restricted or bot-protected pages
  cache_ok / max_cache_age — control response caching (defaults: true / 5 days)
  retry / max_retries / retry_escalate — automatic retry with proxy escalation on failure

SITE AUDIT TOOLS (require OAuth + Site Audit plan):
  discoverSiteUrls  — Crawl a domain and return every page found, grouped by depth, plus remaining
                       monthly quota and siteContextText for AI enrichment.
  startSiteAudit    — Start the async audit. Pass urls[] for exact control; omit to let the backend
                       crawl. URLs can come from discoverSiteUrls, a codebase route scan, a sitemap,
                       or a manually provided list — discoverSiteUrls is NOT required first.
                       Returns an auditId immediately.
  getSiteAuditStatus — Poll progress (QUEUED → CRAWLING → SCORING → COMPLETE). Call every 5–10s.
  getSiteAuditReport — Retrieve the full report once COMPLETE: overall score 0–100, AI-generated
                       executive summary, top priorities, critical issues with business impact,
                       per-page scores and check breakdowns, OG coverage rates.
  previewPageAudit  — Instant synchronous single-URL audit. Returns score + issues immediately.
                       Does not consume audit page quota.

  getLinkPreview    — Check how a URL will appear when shared on Facebook, Twitter/X, LinkedIn,
                       and Google. Returns platform preview cards (title, description, image per
                       platform), a quality score, and a list of issues to fix.
                       Use when the user asks to "check link preview", "how does X look on social",
                       or "check my og tags". Synchronous. Does not consume audit quota.
                       Requires OAuth.

  IMPORTANT WORKFLOW RULES:
  1. Always ask the user their preferred scope BEFORE calling any tools:
     whole site / core pages / specific section / codebase scan.
  2. For "audit all": call discoverSiteUrls, then pass the complete urls array from the STRUCTURED
     OUTPUT directly to startSiteAudit — do not re-parse URLs from the markdown display.
  3. For "codebase scan": read route files, construct URLs, call startSiteAudit directly.
  4. The quota is monthly (not per-audit). If the audit is clamped, tell the user how many pages
     remain in their monthly quota and link them to the billing page to upgrade.
  Use the "run-site-audit" prompt for step-by-step guidance including the user-selection step.

IMAGE GENERATION TOOLS:
  generateImage, iterateImage, inspectImageSession, exportImageAsset — create and refine diagrams,
  icons, social cards, and illustrations. Use the built-in prompts (analyze-webpage,
  extract-structured-data, get-page-content) and image prompts for guided workflows.
`;

export const createServer = () => {
    const mcpServer = new McpServer(
        {
            name: "og-mcp-server",
            version: "1.4.0",
            homepage: "https://opengraph.io",
            websiteUrl: "https://opengraph.io",
        } as any,
        {
            instructions: SERVER_INSTRUCTIONS,
            capabilities: {
                prompts: {},
                resources: { subscribe: true },
                tools: {},
                logging: {},
                completions: {},
            },
        }
    );
    const server = mcpServer.server;

    let subscriptions: Set<string> = new Set();
    let subsUpdateInterval: NodeJS.Timeout | undefined;
    let logLevel: LoggingLevel = "debug";

    // Set up update interval for subscribed resources
    subsUpdateInterval = setInterval(() => {
        for (const uri of subscriptions) {
            server.notification({
                method: "notifications/resources/updated",
                params: { uri },
            });
        }
    }, 10000);

    // Helper method to request sampling from client
    const requestSampling = async (
        context: string,
        uri: string,
        maxTokens: number = 100
    ) => {
        const request: CreateMessageRequest = {
            method: "sampling/createMessage",
            params: {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Resource ${uri} context: ${context}`,
                        },
                    },
                ],
                systemPrompt: "You are a helpful test server.",
                maxTokens,
                temperature: 0.7,
                includeContext: "thisServer",
            },
        };

        return await server.request(request, CreateMessageResultSchema);
    };

    // Resources are dynamically fetched from the og-image-agent API
    // No static resources - assets are accessed via the asset:// URI template

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        // Resources are accessed via URI templates, not listed statically
        // Generated assets can be accessed via asset://{sessionId}/{assetId}
        return {
            resources: [],
        };
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
        return {
            resourceTemplates: [
                {
                    uriTemplate: "asset://{sessionId}/{assetId}",
                    name: "Generated Image Asset",
                    description: "Access generated image assets by session and asset ID. Use inspectImageSession to find asset IDs.",
                },
            ],
        };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri;

        // Handle asset:// URIs
        if (uri.startsWith("asset://")) {
            const parts = uri.replace("asset://", "").split("/");
            if (parts.length !== 2) {
                throw new Error(`Invalid asset URI format. Expected: asset://{sessionId}/{assetId}`);
            }
            const [sessionId, assetId] = parts;
            
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(sessionId) || !uuidRegex.test(assetId)) {
                throw new Error("Invalid session ID or asset ID format - must be valid UUIDs");
            }

            try {
                const { data, contentType } = await getAssetFile(assetId);
                return {
                    contents: [
                        {
                            uri,
                            mimeType: contentType,
                            blob: data.toString("base64"),
                        },
                    ],
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to fetch asset: ${message}`);
            }
        }

        throw new Error(`Unknown resource URI scheme: ${uri}`);
    });

    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
        const { uri } = request.params;
        subscriptions.add(uri);

        // Request sampling from client when someone subscribes
        await requestSampling("A new subscription was started", uri);
        return {};
    });

    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
        subscriptions.delete(request.params.uri);
        return {};
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return {
            prompts: [
                {
                    name: PromptName.CREATE_BRANDED_DIAGRAM,
                    description: "Guided workflow for creating professional diagrams that match your brand identity",
                    arguments: [
                        {
                            name: "diagramType",
                            description: "Type of diagram: flowchart, sequence, architecture, er-diagram, state, or other",
                            required: true,
                        },
                        {
                            name: "description",
                            description: "Brief description of what the diagram should show",
                            required: true,
                        },
                    ],
                },
                {
                    name: PromptName.ITERATE_AND_REFINE,
                    description: "Best practices for iterating on generated images to achieve the perfect result",
                    arguments: [
                        {
                            name: "sessionId",
                            description: "The session UUID containing the image",
                            required: true,
                        },
                        {
                            name: "assetId",
                            description: "The asset UUID to iterate on",
                            required: true,
                        },
                        {
                            name: "issue",
                            description: "What issue are you trying to fix?",
                            required: false,
                        },
                    ],
                },
                {
                    name: PromptName.CREATE_ASSET_SET,
                    description: "Create a set of visually consistent images (icons, social cards, diagrams, illustrations)",
                    arguments: [
                        {
                            name: "assetType",
                            description: "Type of assets: icons, social-cards, diagrams, or illustrations",
                            required: true,
                        },
                        {
                            name: "count",
                            description: "How many assets in the set (2-10)",
                            required: true,
                        },
                    ],
                },
                {
                    name: PromptName.QUICK_ICON,
                    description: "Quickly generate a simple icon with sensible defaults",
                    arguments: [
                        {
                            name: "iconDescription",
                            description: "What the icon should represent (e.g., 'settings gear', 'user profile')",
                            required: true,
                        },
                        {
                            name: "style",
                            description: "Icon style: outline, filled, duotone, or 3d (defaults to filled)",
                            required: false,
                        },
                    ],
                },
                // ── Web data workflows ────────────────────────────────────────────────
                {
                    name: PromptName.ANALYZE_WEBPAGE,
                    description: "Fetch a page's metadata and readable content in parallel, then summarize or answer a specific question about it",
                    arguments: [
                        {
                            name: "url",
                            description: "The URL to analyze",
                            required: true,
                        },
                        {
                            name: "focus",
                            description: "What to focus on: seo, content, links, social-preview, or a specific question about the page",
                            required: false,
                        },
                    ],
                },
                {
                    name: PromptName.EXTRACT_STRUCTURED_DATA,
                    description: "Extract named fields from a page using CSS selectors — ideal for ecommerce products, job listings, news articles, and other structured pages",
                    arguments: [
                        {
                            name: "url",
                            description: "The URL to extract data from",
                            required: true,
                        },
                        {
                            name: "fields",
                            description: "Comma-separated list of field names to extract (e.g. 'title, price, description, sku, availability')",
                            required: false,
                        },
                    ],
                },
                {
                    name: PromptName.GET_PAGE_CONTENT,
                    description: "Convert a URL to clean readable text or Markdown — strips boilerplate and returns the main content, ready to read or pass to another model",
                    arguments: [
                        {
                            name: "url",
                            description: "The URL to fetch content from",
                            required: true,
                        },
                        {
                            name: "is_spa",
                            description: "Set to 'true' if the page is a JavaScript-heavy single-page application (forces full browser rendering)",
                            required: false,
                        },
                    ],
                },
                {
                    name: PromptName.RUN_SITE_AUDIT,
                    description: "Audit pages of a domain for Open Graph, social metadata, and SEO quality. Discovers URLs first so the user can choose which pages to include, then runs an async audit and returns a rich AI-generated report.",
                    arguments: [
                        {
                            name: "domain",
                            description: "The domain to audit (e.g. https://example.com)",
                            required: true,
                        },
                    ],
                },
            ],
        };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        if (name === PromptName.CREATE_BRANDED_DIAGRAM) {
            const diagramType = args?.diagramType || "flowchart";
            const description = args?.description || "a diagram";
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `I need to create a ${diagramType} diagram: ${description}

Please help me create this diagram by following these steps:

## Step 1: Gather Brand Context
Before generating, I need to provide:
- **Brand colors**: What are my primary and secondary brand colors? (hex codes like #0033A0)
- **Style preferences**: Modern, minimalist, corporate, playful, technical?
- **Project context**: What is this diagram for? (documentation, presentation, website)

## Step 2: Define the Diagram Structure
Help me outline the diagram structure:
- What are the main components/nodes?
- What are the relationships/flows between them?
- Should we use Mermaid or D2 syntax?

## Step 3: Choose Output Style
- **draft**: Quick preview (fastest, minimal styling)
- **standard**: AI-enhanced with brand colors (recommended for most cases)
- **premium**: Full AI polish - stunning professional artwork (best for hero images, may need iteration)

## Step 4: Generate
Once we have the context, generate the diagram using the \`generateImage\` tool with:
- kind: "diagram"
- brandColors: [my colors]
- stylePreferences: [my style]
- projectContext: [my context]
- outputStyle: [chosen style]

## Tips for Best Results
- For complex diagrams, start with 'standard' output style
- If the result has clipping or duplicates, regenerate with explicit instructions
- Use the iterateImage tool for refinements rather than regenerating from scratch`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.ITERATE_AND_REFINE) {
            const sessionId = args?.sessionId || "[sessionId]";
            const assetId = args?.assetId || "[assetId]";
            const issueContext = args?.issue 
                ? `\n\n**Current issue to address**: ${args.issue}`
                : "";

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `I want to iterate on asset ${assetId} in session ${sessionId}.${issueContext}

## First: Inspect the Asset
Use \`inspectImageSession(sessionId=${sessionId})\` to review:
- What toolchain was used (mermaid, d2, openai, gemini)?
- What was the original prompt?
- What metadata is stored (diagram source, colors used)?

## Common Issues and Solutions

### Clipped Edges / Elements Cut Off
- Include padding instructions: "ensure 20px padding on all edges"
- For diagrams: regenerate with explicit Mermaid/D2 source
- Try 'standard' output style instead of 'premium'

### Duplicate Elements
- This happens with 'premium' GPT-Image polish
- Explicitly state: "no duplicate boxes or labels"
- Consider using 'standard' for accuracy

### Wrong Colors / Style
- Use \`iterateImage\` with specific color instructions: "change primary color to #0033A0"
- Reference the original brandColors if they were provided

### Text Readability Issues
- Request "high contrast text"
- Specify "minimum 14px font size"
- Try 'gemini-pro' model for better text rendering

### Layout Problems
- For diagrams: provide the exact Mermaid/D2 source to preserve structure
- Add direction hints: "left to right flow", "top to bottom hierarchy"

## Using the Iterate Tool
\`\`\`
iterateImage({
  sessionId: "${sessionId}",
  assetId: "${assetId}",
  prompt: "Specific changes you want..."
})
\`\`\`

## When to Regenerate Instead
- If the fundamental structure is wrong
- If you need a completely different style
- If iteration attempts aren't converging

Start by inspecting the asset, then tell me what you'd like to change.`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.CREATE_ASSET_SET) {
            const assetType = args?.assetType || "icons";
            const count = parseInt(args?.count as string, 10) || 3;
            const kindMap: Record<string, string> = {
                "icons": "icon",
                "social-cards": "social-card",
                "diagrams": "diagram",
                "illustrations": "illustration",
            };
            const kind = kindMap[assetType] || "illustration";

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `I need to create a set of ${count} consistent ${assetType}.

## Creating Visually Consistent Assets

### Step 1: Establish the Style Guide
Before creating any assets, define:
- **Color palette**: Primary, secondary, accent colors (hex codes)
- **Style**: Modern, flat, 3D, hand-drawn, technical, etc.
- **Background**: Transparent, solid color, gradient?
- **Dimensions**: Same size for all? Specific aspect ratios?

### Step 2: Create the First Asset
Generate the first asset with full context:
\`\`\`
generateImage({
  prompt: "[first asset description]",
  kind: "${kind}",
  brandColors: ["#primary", "#secondary"],
  stylePreferences: "[your style]",
  projectContext: "Part of a ${count}-asset set for [purpose]",
  outputStyle: "standard"
})
\`\`\`

### Step 3: Use First Asset as Reference
Once you're happy with the first asset, use its ID as a reference for consistency:
\`\`\`
generateImage({
  prompt: "[second asset description]",
  kind: "${kind}",
  referenceAssetId: "[first asset ID]",
  brandColors: ["#primary", "#secondary"],
  stylePreferences: "[same style]",
  outputStyle: "standard"
})
\`\`\`

### Step 4: Iterate for Consistency
If an asset doesn't match the set:
- Use \`iterateImage\` to adjust colors/style
- Reference the prompt: "match the style of asset [ID]"
- Keep the same brandColors and stylePreferences

### Tips for ${assetType}
${assetType === 'icons' ? `
- Use \`transparent: true\` for all icons
- Keep complexity consistent (same level of detail)
- Use the same line weights and corner radius
- Consider a consistent canvas size (e.g., 512x512)` : ''}
${assetType === 'social-cards' ? `
- Maintain consistent text placement zones
- Use the same typography style
- Keep brand logo in the same position
- Standard sizes: 1200x630 (OG), 1200x675 (Twitter)` : ''}
${assetType === 'diagrams' ? `
- Use the same diagram syntax (all Mermaid or all D2)
- Consistent node shapes and colors
- Same arrow styles and line weights
- Matching background treatment` : ''}
${assetType === 'illustrations' ? `
- Same art style throughout
- Consistent character proportions (if applicable)
- Matching color saturation and contrast
- Similar level of detail and complexity` : ''}

What ${assetType} do you need to create? Let's start with defining your style guide.`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.QUICK_ICON) {
            const iconDescription = args?.iconDescription || "an icon";
            const style = (args?.style as string) || "filled";
            const styleGuide: Record<string, string> = {
                outline: "line-art style with consistent 2px stroke weight, no fills",
                filled: "solid filled shapes, clean and simple",
                duotone: "two-tone design with primary color and lighter accent",
                "3d": "subtle 3D effect with soft shadows and gradients",
            };
            const styleDesc = styleGuide[style] || styleGuide.filled;

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Generate a ${style} icon: ${iconDescription}

Use these settings for best results:
\`\`\`
generateImage({
  prompt: "${iconDescription} icon, ${styleDesc}, centered on canvas, professional quality",
  kind: "icon",
  transparent: true,
  quality: "high",
  stylePreferences: "${style} icon style, clean vector aesthetic, suitable for UI",
  outputStyle: "standard"
})
\`\`\`

This will create a transparent PNG icon ready for use in your application.`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.ANALYZE_WEBPAGE) {
            const url    = args?.url    || "[url]";
            const focus  = args?.focus;
            const focusLine = focus
                ? `\nFocus: ${focus}`
                : "\nFocus: provide a general summary covering metadata, content, and notable links.";

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Analyze this page: ${url}${focusLine}

## Step 1 — Fetch metadata and content in parallel

Call both tools simultaneously:

\`\`\`
getOgData({ url: "${url}" })
getOgMarkdown({ url: "${url}" })
\`\`\`

- From getOgData, read **hybridGraph** — it is the best-of-all-sources merge of the page's title, description, image, type, and favicon.
- From getOgMarkdown, read **markdown** — the full page content stripped of navigation and boilerplate.

If either call returns empty content and the page is a JavaScript-heavy SPA, retry with \`full_render: true\`.

## Step 2 — Synthesize

Combine both results and address the stated focus. If the focus is "seo", evaluate the title, description, Open Graph image, and og:type. If the focus is "content", summarize the main prose. If the focus is "links", look for anchor tags in the markdown. If a specific question was asked, answer it directly using the fetched content.`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.EXTRACT_STRUCTURED_DATA) {
            const url    = args?.url    || "[url]";
            const fields = args?.fields || "title, description, price, availability";
            const fieldList = fields.split(",").map((f: string) => f.trim()).filter(Boolean);

            const selectorMap = fieldList
                .map((f: string) => {
                    const suggestions: Record<string, string> = {
                        title:        "h1, article h1, .product-title, .listing-title",
                        price:        ".price, [data-price], .product-price, .amount",
                        description:  ".description, #description, article p, .summary",
                        availability: ".availability, .stock-status, [data-availability]",
                        sku:          ".sku, [data-sku], #product-sku",
                        author:       ".author, [rel=author], .byline",
                        date:         "time, .date, [datetime], .published",
                        image:        "article img, .product-image img, .hero img",
                    };
                    const suggestion = suggestions[f.toLowerCase()];
                    return suggestion
                        ? `  "${f}": "${suggestion}"  // adjust selector if needed`
                        : `  "${f}": "[CSS selector for ${f}]"`;
                })
                .join(",\n");

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Extract structured data from: ${url}
Fields to extract: ${fields}

## Step 1 — Inspect the page (optional but recommended for unfamiliar sites)

Call \`getOgScrapeData({ url: "${url}" })\` to review the raw HTML and identify the real CSS selectors for each field. Look at the first 3 000 characters in the text response to find class names and IDs.

## Step 2 — Build the selectors map

Based on the HTML inspection (or the suggestions below), construct a selectors map:

\`\`\`
getOgExtract({
  url: "${url}",
  selectors: {
${selectorMap}
  }
})
\`\`\`

The response will contain a **data** object keyed by your field names (e.g. \`data.title\`, \`data.price\`), plus a **concatenatedText** string with all matched text joined together.

## Step 3 — Validate and adjust

If a field is empty or incorrect, refine its selector and call getOgExtract again. For JS-rendered pages where fields are missing, add \`full_render: true\` to force full browser execution before extraction.`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.GET_PAGE_CONTENT) {
            const url    = args?.url    || "[url]";
            const isSpa  = args?.is_spa === "true";

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Get the readable content of: ${url}

Call getOgMarkdown with the following parameters:

\`\`\`
getOgMarkdown({
  url: "${url}",${isSpa ? "\n  full_render: true,  // required for this JS-heavy SPA" : ""}
  only_main_content: true   // strips navigation, ads, and boilerplate (default)
})
\`\`\`

The response contains:
- **markdown**: the full page content as clean Markdown (headings, paragraphs, links, images)
- **length**: character count of the full content

${isSpa ? "" : "If the result is empty or incomplete, the page may be a JavaScript SPA that requires browser rendering. Retry with `full_render: true`.\n\n"}The Markdown text block in the tool response is capped at 6 000 characters for readability; the complete content is always available in the structured \`markdown\` field.

Once you have the content, you can:
- Summarize it
- Answer questions about it
- Pass it to another model or tool
- Extract specific sections using \`getOgExtract\` with CSS selectors`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.RUN_SITE_AUDIT) {
            const domain = args?.domain || "[domain]";

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Run a site audit for: ${domain}

Follow these steps exactly.

---

## Step 0 — Ask scope BEFORE calling any tools

Ask the user this question first and wait for their response:

> "Before I start the audit, how would you like to approach this?
>
> - **Whole site** — I'll discover every page and audit them all
> - **Core pages only** — homepage, about, pricing, docs, and key marketing pages
> - **Specific section** — e.g. 'all blog posts', 'just the reports', 'product pages'
> - **Scan codebase** — I'll find your routes directly from the code (fastest, no crawl needed)
>
> Which would you prefer?"

Do not call any tools until the user answers.

---

## Branch A — Whole site

If the user wants the whole site audited:

1. Call discoverSiteUrls to get the full page list and quota info:
\`\`\`
discoverSiteUrls({ domain: "${domain}" })
\`\`\`

2. Take the complete \`urls\` array directly from the **structured output** (not from the markdown text).
   Do NOT attempt to re-read or re-parse individual URLs from the markdown display.

3. Call startSiteAudit immediately — pass ALL urls and the totalFound count:
\`\`\`
startSiteAudit({
  domain: "${domain}",
  urls: [ /* every entry from discoverSiteUrls structured output urls array */ ],
  pagesRequested: /* totalFound from structured output */,
  siteContextText: /* siteContextText from structured output */
})
\`\`\`

4. Proceed to Step 3 (poll).

---

## Branch B — Specific pages or section

If the user wants specific pages or a section:

1. Call discoverSiteUrls to get the full page list:
\`\`\`
discoverSiteUrls({ domain: "${domain}" })
\`\`\`

2. Present the URL list clearly, grouped by section, and ask the user to confirm their selection:
> "I found [N] pages. Here they are:
> [list pages grouped by depth/section]
>
> Which of these would you like included?"

Wait for the user's response.

3. Map their selection to the actual URLs, then call startSiteAudit:
\`\`\`
startSiteAudit({
  domain: "${domain}",
  urls: [ /* the URLs the user selected */ ],
  pagesRequested: /* number of selected URLs */,
  siteContextText: /* siteContextText from structured output */
})
\`\`\`

4. Proceed to Step 3 (poll).

---

## Branch C — Codebase scan

If the user wants you to scan their codebase for routes (they have the project open):

1. Use your file-reading tools to find route definitions. Common locations:
   - Next.js App Router: \`app/\` directory — each \`page.tsx\` is a route
   - Next.js Pages Router: \`pages/\` directory
   - React Router: route config files (e.g. \`src/routes.tsx\`, \`src/App.tsx\`)
   - Express / other: route registration files

2. Construct the full URL list by prepending the domain to each path found.

3. Call startSiteAudit directly — no discoverSiteUrls needed:
\`\`\`
startSiteAudit({
  domain: "${domain}",
  urls: [ /* full URLs constructed from codebase routes */ ],
  pagesRequested: /* total count */
})
\`\`\`

4. Proceed to Step 3 (poll).

---

## Step 3 — Poll status every 5–10 seconds

\`\`\`
getSiteAuditStatus({ auditId: "<auditId>" })
\`\`\`

While polling, keep the user informed:
- QUEUED → "Starting up…"
- CRAWLING → "Crawling pages… ([pagesAudited]/[pagesRequested] done)"
- SCORING → "Scoring pages and generating AI analysis…"
- COMPLETE → proceed to Step 4
- FAILED → report the errorMessage and stop

---

## Step 4 — Retrieve and present the report

\`\`\`
getSiteAuditReport({ auditId: "<auditId>" })
\`\`\`

The tool returns a formatted Markdown report. Present the full output to the user.
The report includes:
- Overall score and grade
- AI-generated executive summary
- What's working well
- Top priorities (numbered, actionable)
- Critical issues with business impact and fix guidance
- Pages needing attention (worst scores first, with top issue per page)
- Open Graph coverage rates across all checks

After presenting, ask: **"Would you like me to fix any of these issues in the codebase?"**`,
                        },
                    },
                ],
            };
        }

        throw new Error(`Unknown prompt: ${name}`);
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        let { name, arguments: args } = request.params;

        // Resolve credentials from the per-session AuthContext (set by server-http.ts).
        // When running over stdio (local dev), sessionId is absent and tools fall back
        // to OPENGRAPH_APP_ID from the environment via getAppId() in og.ts.
        const sessionId = (server.transport && 'sessionId' in server.transport)
            ? (server.transport as any).sessionId as string
            : undefined;
        const authCtx = sessionId ? getAuthContext(sessionId) : undefined;
        // appId — forwarded to every OpenGraph API call for billing
        const appId = authCtx?.appId;
        // organizationId + accessToken — required for Site Audit calls
        const organizationId = authCtx?.organizationId ?? "";
        const accessToken    = authCtx?.accessToken ?? "";
        const isLocal = !sessionId;
        
        let validatedArgs: any;

        switch (name) {
            case ToolNames.GET_OG_DATA:
                if (!isLocal && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_data_tool = new GetOgDataTool(appId);
                validatedArgs = og_data_tool.inputSchema.parse(args);
                return og_data_tool.execute(validatedArgs);

            case ToolNames.GET_OG_SCRAPE_DATA:
                if (!isLocal && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_scrape_data_tool = new GetOgScrapeDataTool(appId);
                validatedArgs = og_scrape_data_tool.inputSchema.parse(args);
                return og_scrape_data_tool.execute(validatedArgs);

            case ToolNames.GET_OG_SCREENSHOT:
                if (!isLocal && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_screenshot_tool = new GetOgScreenshotTool(appId);
                validatedArgs = og_screenshot_tool.inputSchema.parse(args);
                return og_screenshot_tool.execute(validatedArgs);

            case ToolNames.GET_OG_QUERY:
                if (!isLocal && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_query_tool = new GetOgQueryTool(appId);
                validatedArgs = og_query_tool.inputSchema.parse(args);
                return og_query_tool.execute(validatedArgs);

            case ToolNames.GET_OG_EXTRACT:
                if (!isLocal && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_extract_tool = new GetOgExtractTool(appId);
                validatedArgs = og_extract_tool.inputSchema.parse(args);
                return og_extract_tool.execute(validatedArgs);

            case ToolNames.GET_OG_MARKDOWN:
                if (!isLocal && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_markdown_tool = new GetOgMarkdownTool(appId);
                validatedArgs = og_markdown_tool.inputSchema.parse(args);
                return og_markdown_tool.execute(validatedArgs);

            // Image generation tools (use OG_BASE_URL, no appId required in switch)
            case ToolNames.GENERATE_IMAGE:
                const generate_image_tool = new GenerateImageTool(appId);
                validatedArgs = generate_image_tool.inputSchema.parse(args);
                return generate_image_tool.execute(validatedArgs);

            case ToolNames.ITERATE_IMAGE:
                const iterate_image_tool = new IterateImageTool(appId);
                validatedArgs = iterate_image_tool.inputSchema.parse(args);
                return iterate_image_tool.execute(validatedArgs);

            case ToolNames.INSPECT_IMAGE_SESSION:
                const inspect_session_tool = new InspectImageSessionTool(appId);
                validatedArgs = inspect_session_tool.inputSchema.parse(args);
                return inspect_session_tool.execute(validatedArgs);

            case ToolNames.EXPORT_IMAGE_ASSET:
                const export_asset_tool = new ExportImageAssetTool(appId, isLocal);
                validatedArgs = export_asset_tool.inputSchema.parse(args);
                return export_asset_tool.execute(validatedArgs);

            // Site Audit tools — require OAuth Bearer token + Site Audit plan
            case ToolNames.DISCOVER_SITE_URLS:
                const discover_tool = new DiscoverSiteUrlsTool(accessToken, organizationId);
                validatedArgs = discover_tool.inputSchema.parse(args);
                return discover_tool.execute(validatedArgs);

            case ToolNames.START_SITE_AUDIT:
                const start_audit_tool = new StartSiteAuditTool(accessToken, organizationId);
                validatedArgs = start_audit_tool.inputSchema.parse(args);
                return start_audit_tool.execute(validatedArgs);

            case ToolNames.GET_SITE_AUDIT_STATUS:
                const audit_status_tool = new GetSiteAuditStatusTool(accessToken);
                validatedArgs = audit_status_tool.inputSchema.parse(args);
                return audit_status_tool.execute(validatedArgs);

            case ToolNames.GET_SITE_AUDIT_REPORT:
                const audit_report_tool = new GetSiteAuditReportTool(accessToken);
                validatedArgs = audit_report_tool.inputSchema.parse(args);
                return audit_report_tool.execute(validatedArgs);

            case ToolNames.PREVIEW_PAGE_AUDIT:
                const preview_audit_tool = new PreviewPageAuditTool(accessToken, organizationId);
                validatedArgs = preview_audit_tool.inputSchema.parse(args);
                return preview_audit_tool.execute(validatedArgs);

            case ToolNames.GET_LINK_PREVIEW:
                const link_preview_tool = new GetLinkPreviewTool(accessToken, organizationId);
                validatedArgs = link_preview_tool.inputSchema.parse(args);
                return link_preview_tool.execute(validatedArgs);

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    });

    server.setRequestHandler(CompleteRequestSchema, async (request) => {
        const { ref, argument } = request.params;

        if (ref.type === "ref/resource") {
            // Asset resources use UUIDs, no autocomplete suggestions
            return { completion: { values: [] } };
        }

        if (ref.type === "ref/prompt") {
            // Handle completion for prompt arguments
            const completions =
                EXAMPLE_COMPLETIONS[argument.name as keyof typeof EXAMPLE_COMPLETIONS];
            if (!completions) return { completion: { values: [] } };

            const values = completions.filter((value) =>
                value.toLowerCase().startsWith(argument.value.toLowerCase())
            );
            return { completion: { values, hasMore: false, total: values.length } };
        }

        throw new Error(`Unknown reference type`);
    });

    server.setRequestHandler(SetLevelRequestSchema, async (request) => {
        const { level } = request.params;
        logLevel = level;

        // Demonstrate different log levels
        await server.notification({
            method: "notifications/message",
            params: {
                level: "debug",
                logger: "test-server",
                data: `Logging level set to: ${logLevel}`,
            },
        });

        return {};
    });

    const cleanup = async () => {
        if (subsUpdateInterval) clearInterval(subsUpdateInterval);
    };

    return { server, cleanup };
};