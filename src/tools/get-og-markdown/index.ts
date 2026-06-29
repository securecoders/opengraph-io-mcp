import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getSiteMarkdown } from "@/utils/og";
import { formatMarkdown, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgMarkdownTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_MARKDOWN;
    description =
        "Convert any URL's HTML into clean Markdown via the OpenGraph.io API (v3 markdown endpoint). " +
        "Strips navigation, ads, and boilerplate by default — the result is main-content prose, " +
        "headings, links, and images ready to read or feed into another model. " +
        "Use `include_tags` / `exclude_tags` to target or remove specific page sections. " +
        "\n\n" +
        "IMPORTANT — JavaScript-heavy pages: the v3 smart defaults (auto_render) do NOT apply to " +
        "the markdown pipeline. If the target URL is an SPA or requires JS execution, you must " +
        "explicitly set full_render: true to get rendered HTML before conversion. Without it, you " +
        "will receive the raw server-side HTML (which may be mostly empty for JS apps). " +
        "\n\n" +
        "The Markdown text block is capped at 6 000 characters; the full content is always " +
        "available in the structured `markdown` field.\n\n" +
        "Pick the right tool:\n" +
        "  getOgData        → Open Graph tags, social preview metadata (title, description, image, favicon)\n" +
        "  getOgMarkdown    → Clean readable text / article prose — ideal for feeding into an LLM\n" +
        "  getOgScrapeData  → Raw HTML — use when you need to do your own parsing or link extraction\n" +
        "  getOgExtract     → Targeted elements by tag (html_elements) or named CSS selectors (selectors)\n" +
        "  getOgScreenshot  → Visual capture of a page as an image\n" +
        "  getOgQuery       → Natural-language question answered from page content (100–200 credits/request)";

    annotations = {
        title: "Get Page as Markdown",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to convert to Markdown."),
        // Markdown-specific options
        include_tags: z.array(z.string()).optional().describe(
            "CSS selectors — keep only elements matching these selectors. " +
            "Example: ['article', 'main', '.content'] to target the main content area only.",
        ),
        exclude_tags: z.array(z.string()).optional().describe(
            "CSS selectors to remove before conversion. " +
            "Supports wildcard/regex patterns. Example: ['nav', 'footer', '.sidebar', '.ad*'].",
        ),
        only_main_content: z.boolean().optional().describe(
            "Heuristically strip navigation, header, footer, and ads, keeping only main prose content. " +
            "Defaults to true server-side. Set to false to convert the full page.",
        ),
        // Rendering
        full_render: z.boolean().optional().describe(
            "Fully render the page with JavaScript before conversion. " +
            "REQUIRED for SPAs and JS-heavy sites — v3 auto_render does NOT apply to the markdown pipeline.",
        ),
        wait_for_selector: z.string().optional().describe(
            "CSS selector to wait for before converting. Forces full_render.",
        ),
        scroll_to_bottom: z.boolean().optional().describe(
            "Scroll to the bottom of the page before conversion. Forces full_render.",
        ),
        load_more_selector: z.string().optional().describe(
            "CSS selector for a 'load more' button to click before conversion.",
        ),
        load_more_clicks: z.number().int().min(1).max(10).optional().describe(
            "Number of times to click the load_more_selector (1–10). Defaults to 3.",
        ),
        load_more_wait: z.number().int().min(0).max(5000).optional().describe(
            "Milliseconds to wait after each load_more click (0–5000). Defaults to 1500.",
        ),
        // Cache
        cache_ok: z.boolean().optional().describe(
            "Use cached results. Set to false to bypass cache. Defaults to true.",
        ),
        max_cache_age: z.number().int().optional().describe(
            "Maximum cache age in milliseconds. Defaults to 432000000 (5 days).",
        ),
        // Language
        accept_lang: z.string().optional().describe(
            "Accept-Language header for the outbound request. Defaults to 'auto'.",
        ),
        // Proxy / retry
        use_proxy: z.boolean().optional().describe(
            "Route the request through a standard proxy.",
        ),
        use_premium: z.boolean().optional().describe(
            "Route the request through a premium proxy.",
        ),
        use_superior: z.boolean().optional().describe(
            "Route the request through a superior-tier proxy.",
        ),
        proxy_country: z.string().optional().describe(
            "Two-letter ISO country code for geo-targeted proxy exit node.",
        ),
        auto_proxy: z.boolean().optional().describe(
            "Automatically escalate to a proxy if the direct request fails.",
        ),
        retry: z.boolean().optional().describe(
            "Automatically retry failed requests.",
        ),
        max_retries: z.number().int().min(1).max(4).optional().describe(
            "Maximum number of retry attempts (1–4). Defaults to 4.",
        ),
        retry_escalate: z.boolean().optional().describe(
            "Escalate proxy tier on each retry attempt. Defaults to true.",
        ),
        // AI sanitizer
        ai_sanitize: z.boolean().optional().describe(
            "Scan the fetched content for prompt-injection attempts.",
        ),
        ai_sanitize_mode: z.enum(["sanitize", "warn", "block"]).optional().describe(
            "'sanitize' cleans the content, 'warn' returns a safety report, 'block' returns HTTP 422.",
        ),
    });

    outputSchema = z.object({
        url:             z.string(),
        markdown:        z.string().describe("Full Markdown content of the page"),
        length:          z.number().describe("Character count of the Markdown content"),
        onlyMainContent: z.boolean().optional(),
        requestInfo:     z.any().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            const content = await getSiteMarkdown(url, this.appId, options);
            return toResult(
                formatMarkdown(url, {
                    markdown:       content,
                    onlyMainContent: args.only_main_content,
                }),
            );
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Page as Markdown", reason));
        }
    }
}

export default GetOgMarkdownTool;
