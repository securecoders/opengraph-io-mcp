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
        "Extract specific content from any URL via the OpenGraph.io API (v3). " +
        "Two modes — choose based on what you need:\n\n" +
        "**Mode 1 — Tag-based** (`html_elements`): pass an array of HTML tag names, e.g. `['h1','h2','p','a']`. " +
        "The API collects all matching elements and joins their text into a single `concatenatedText` string. " +
        "Best for bulk content extraction where you want all headings, paragraphs, or links as one block of text.\n\n" +
        "**Mode 2 — Selector-based** (`selectors`): pass a CSS selector map where each key is your chosen label and each value is a CSS selector, " +
        "e.g. `{ \"title\": \"article h1\", \"price\": \".price-box .price\", \"sku\": \"#product-sku\" }`. " +
        "The API returns a `data` object keyed by those labels — ideal for structured scraping of specific named fields.\n\n" +
        "**Response shape by mode:**\n" +
        "- `html_elements` only → `{ concatenatedText }`\n" +
        "- `selectors` only → `{ data, concatenatedText }`\n" +
        "- Both provided → `{ data, concatenatedText }`\n\n" +
        "For JS-heavy / SPA pages set `full_render: true` to guarantee JavaScript execution before extraction. " +
        "Use `wait_for_selector` when content loads asynchronously.\n\n" +
        "Pick the right tool:\n" +
        "  getOgData        → Open Graph tags, social preview metadata (title, description, image, favicon)\n" +
        "  getOgMarkdown    → Clean readable text / article prose — ideal for feeding into an LLM\n" +
        "  getOgScrapeData  → Raw HTML — use when you need to do your own parsing or link extraction\n" +
        "  getOgExtract     → Targeted elements by tag (html_elements) or named CSS selectors (selectors)\n" +
        "  getOgScreenshot  → Visual capture of a page as an image\n" +
        "  getOgQuery       → Natural-language question answered from page content (100–200 credits/request)";

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
        url:              z.string(),
        concatenatedText: z.string().optional().describe(
            "All matched element text joined into one string. Present in both html_elements and selectors modes.",
        ),
        data:             z.record(z.string(), z.any()).optional().describe(
            "Structured object keyed by your selector labels. Only present when the selectors param was used.",
        ),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, html_elements = [], selectors, ...options } = args;
            const raw = await extractHtmlElements(url, html_elements, this.appId, { ...options, selectors });
            const payload = {
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
