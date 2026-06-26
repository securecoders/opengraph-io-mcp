import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { extractHtmlElements } from "@/utils/og";
import { formatExtract, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgExtractTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_EXTRACT;
    description =
        "Extract content from any URL via the OpenGraph.io API (v3 POST endpoint). " +
        "Two extraction modes:\n\n" +
        "1. **Tag-based** (`html_elements`): pass tag names like ['h1','p','a','img'] to get all matching elements with their text.\n\n" +
        "2. **Selector-based** (`selectors`): pass a CSS selector map like `{ \"title\": \"article h1\", \"price\": \".price\" }` " +
        "to extract structured data with named labels — ideal for scraping specific fields from a page.\n\n" +
        "Both modes support the full v3 fetch/proxy/render options including smart defaults (auto_render, auto_proxy, retry). " +
        "Returns a summary table plus the full structured payload.";

    annotations = {
        title: "Extract HTML Elements",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to extract content from."),
        html_elements: z.array(z.string()).optional().describe(
            "List of HTML tag names to extract (e.g. ['h1', 'h2', 'a', 'img', 'p']). " +
            "Defaults to ['title','h1','h2','h3','h4','h5','p'] when neither html_elements nor selectors is provided.",
        ),
        selectors: z.record(z.string(), z.string()).optional().describe(
            "CSS selector map for structured extraction. Keys are output labels; values are CSS selectors. " +
            "Example: { \"article_title\": \"article h1\", \"price\": \".price-box .price\", \"description\": \"#product-description p\" }. " +
            "When provided, returns a structured `data` object keyed by label instead of a raw element list. " +
            "Can be combined with html_elements.",
        ),
        // Fetch/proxy params
        cache_ok: z.boolean().optional().describe(
            "Use cached results. Set to false to bypass cache. Defaults to true.",
        ),
        max_cache_age: z.number().int().optional().describe(
            "Maximum cache age in milliseconds. Defaults to 432000000 (5 days).",
        ),
        full_render: z.boolean().optional().describe(
            "Fully render the page with JavaScript before extracting. Useful for SPAs.",
        ),
        auto_render: z.boolean().optional().describe(
            "Automatically detect and switch to headless rendering for SPA pages. Defaults to true on v3.",
        ),
        wait_for_selector: z.string().optional().describe(
            "CSS selector to wait for before extracting.",
        ),
        scroll_to_bottom: z.boolean().optional().describe(
            "Scroll to the bottom of the page before extracting. Useful for lazy-loaded content.",
        ),
        load_more_selector: z.string().optional().describe(
            "CSS selector for a 'load more' button to click before extracting.",
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
            "Accept-Language header for the outbound request. Defaults to 'auto'.",
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
            "Two-letter ISO country code for geo-targeted proxy exit node.",
        ),
        auto_proxy: z.boolean().optional().describe(
            "Automatically escalate to a proxy if the direct request fails. Defaults to true on v3.",
        ),
        retry: z.boolean().optional().describe(
            "Automatically retry failed requests. Defaults to true on v3.",
        ),
        max_retries: z.number().int().min(1).max(4).optional().describe(
            "Maximum number of retry attempts (1–4). Defaults to 4.",
        ),
        retry_escalate: z.boolean().optional().describe(
            "Escalate proxy tier on each retry attempt. Defaults to true.",
        ),
        ai_sanitize: z.boolean().optional().describe(
            "Scan the fetched content for prompt-injection attempts.",
        ),
        ai_sanitize_mode: z.enum(["sanitize", "warn", "block"]).optional().describe(
            "'sanitize' cleans the content, 'warn' returns a safety report, 'block' returns HTTP 422.",
        ),
    });

    outputSchema = z.object({
        url:             z.string(),
        concatenatedText: z.string().optional().describe("All matched text concatenated"),
        data:            z.record(z.string(), z.any()).optional().describe(
            "Structured data keyed by selector label (present when selectors param was used)",
        ),
        tags:            z.array(z.object({
            tag:       z.string(),
            innerText: z.string(),
            position:  z.number().optional(),
        })).optional().describe("Extracted tag elements (present when html_elements param was used on v1.1)"),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, html_elements = [], selectors, ...options } = args;
            const raw = await extractHtmlElements(url, html_elements, this.appId, { ...options, selectors });
            const payload = {
                tags:             raw?.tags            ?? raw?.elements ?? [],
                concatenatedText: raw?.concatenatedText ?? raw?.allText ?? '',
                data:             raw?.data,
                ai_safety:        raw?.ai_safety,
            };
            return toResult(formatExtract(url, payload));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Extract HTML Elements", reason));
        }
    }
}

export default GetOgExtractTool;
