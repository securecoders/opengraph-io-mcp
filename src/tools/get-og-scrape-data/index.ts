import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { scrapeSite } from "@/utils/og";
import { formatScrape, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgScrapeDataTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_SCRAPE_DATA;
    description =
        "Scrape and return the raw HTML of a URL via the OpenGraph.io API (v3). " +
        "Returns the complete page HTML — use this when you need to do your own parsing, extract all links, " +
        "inspect the DOM structure, or feed raw markup into another tool or model. " +
        "The text response includes the first 3 000 characters; the full HTML is in the structured `html` field.\n\n" +
        "For JS-heavy or single-page applications set `full_render: true` to guarantee JavaScript execution " +
        "before the HTML is captured. For most sites, the default `auto_render` handles this automatically.\n\n" +
        "Pick the right tool:\n" +
        "  getOgData        → Open Graph tags, social preview metadata (title, description, image, favicon)\n" +
        "  getOgMarkdown    → Clean readable text / article prose — ideal for feeding into an LLM\n" +
        "  getOgScrapeData  → Raw HTML — use when you need to do your own parsing or link extraction\n" +
        "  getOgExtract     → Targeted elements by tag (html_elements) or named CSS selectors (selectors)\n" +
        "  getOgScreenshot  → Visual capture of a page as an image\n" +
        "  getOgQuery       → Natural-language question answered from page content (100–200 credits/request)";

    annotations = {
        title: "Scrape HTML",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to scrape."),
        cache_ok: z.boolean().optional().describe(
            "Use cached results. Set to false to bypass cache and get fresh data. Defaults to true.",
        ),
        max_cache_age: z.number().int().optional().describe(
            "Maximum cache age in milliseconds. Results older than this will be re-fetched. Defaults to 432000000 (5 days).",
        ),
        full_render: z.boolean().optional().describe(
            "Forces a full browser execution pass on every request regardless of page type. " +
            "Use when auto_render hasn't produced the content you expected, or when you need guaranteed JavaScript execution. " +
            "Slower than auto_render — prefer auto_render for most cases.",
        ),
        auto_render: z.boolean().optional().describe(
            "Automatically detects JS-heavy / SPA pages and re-fetches with browser rendering when needed. " +
            "Enabled by default on v3 — leave unset unless you want to disable it. " +
            "For guaranteed JS execution on every request use full_render: true instead.",
        ),
        wait_for_selector: z.string().optional().describe(
            "CSS selector to wait for before scraping. Forces full_render.",
        ),
        scroll_to_bottom: z.boolean().optional().describe(
            "Scroll to the bottom of the page before scraping. Useful for lazy-loaded content.",
        ),
        load_more_selector: z.string().optional().describe(
            "CSS selector for a 'load more' button to click before scraping.",
        ),
        load_more_clicks: z.number().int().min(1).max(10).optional().describe(
            "Number of times to click the load_more_selector (1–10). Defaults to 3.",
        ),
        load_more_wait: z.number().int().min(0).max(5000).optional().describe(
            "Milliseconds to wait after each load_more click (0–5000). Defaults to 1500.",
        ),
        load_more_item_selector: z.string().optional().describe(
            "CSS selector to watch for new items when using load_more_selector.",
        ),
        load_more_scroll: z.boolean().optional().describe(
            "Scroll between load_more clicks. Defaults to true.",
        ),
        accept_lang: z.string().optional().describe(
            "Accept-Language header for the outbound request. Use 'auto' to mirror the caller's language. Defaults to 'auto'.",
        ),
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
            "Two-letter ISO country code for geo-targeted proxy exit node (e.g. 'US', 'GB').",
        ),
        auto_proxy: z.boolean().optional().describe(
            "Automatically escalate to a proxy if the direct request fails. Defaults to true on v3.",
        ),
        retry: z.boolean().optional().describe(
            "Automatically retry failed requests with escalating proxy tiers. Defaults to true on v3.",
        ),
        max_retries: z.number().int().min(1).max(4).optional().describe(
            "Maximum number of retry attempts (1–4). Defaults to 4.",
        ),
        retry_escalate: z.boolean().optional().describe(
            "Escalate proxy tier on each retry attempt. Defaults to true.",
        ),
        ai_sanitize: z.boolean().optional().describe(
            "Scan the fetched content for prompt-injection attempts before returning it.",
        ),
        ai_sanitize_mode: z.enum(["sanitize", "warn", "block"]).optional().describe(
            "'sanitize' cleans the content, 'warn' returns it with a safety report, 'block' returns HTTP 422 when risk_score >= 0.7.",
        ),
    });

    outputSchema = z.object({
        url:         z.string(),
        html:        z.string().describe("Full raw HTML of the scraped page"),
        length:      z.number().describe("Character count of the HTML"),
        requestInfo: z.any().optional().describe("Request metadata (cache status, version, options echo)"),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            const html = await scrapeSite(url, this.appId, options);
            return toResult(formatScrape(url, html));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Scrape HTML", reason));
        }
    }
}

export default GetOgScrapeDataTool;
