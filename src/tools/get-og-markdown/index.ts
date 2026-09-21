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
        "Use `include_tags` / `exclude_tags` to target or remove specific page sections.\n\n" +
        "LONG PAGES — prefer retrieval over truncation. Set `query` with `chunking: true` to get " +
        "back only the passages that answer your question (ranked by relevance) instead of the whole " +
        "page. Use `max_chars` to cap raw output when you genuinely need prose. `chunk_size` and " +
        "`chunk_overlap` tune the split; `heading_aware` keeps sections intact.\n\n" +
        "EXTRAS — `include_links`, `include_images`, and `include_headings` return structured link, " +
        "image, and outline data, which avoids a second scrape call just to enumerate them.\n\n" +
        "UNTRUSTED CONTENT — this fetches arbitrary pages. Set `ai_sanitize: true` when the result " +
        "will be fed to a model: it scans for prompt-injection attempts and returns a safety report. " +
        "`ai_sanitize_mode: 'block'` rejects a risky page outright (HTTP 422) rather than returning it.\n\n" +
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
        // Content targeting
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
        max_chars: z.number().int().min(1).optional().describe(
            "Truncate the Markdown to this many characters. Prefer `query` + `chunking` when you " +
            "want the relevant part of a long page rather than an arbitrary prefix.",
        ),
        // Retrieval
        query: z.string().max(512).optional().describe(
            "Natural-language question. Returns only the most relevant chunks, ranked (BM25), " +
            "instead of the whole page. Requires chunking (enabled automatically when set).",
        ),
        query_top_k: z.number().int().min(1).max(25).optional().describe(
            "How many ranked chunks to return when `query` is set. Defaults to 5.",
        ),
        chunking: z.boolean().optional().describe(
            "Split the Markdown into chunks. Implied by `query`.",
        ),
        chunk_size: z.number().int().min(200).max(20000).optional().describe(
            "Target characters per chunk (200–20000). Defaults to 2000.",
        ),
        chunk_overlap: z.number().int().min(0).optional().describe(
            "Characters of overlap between consecutive chunks, for context. Max half of chunk_size.",
        ),
        heading_aware: z.boolean().optional().describe(
            "Split on heading boundaries where possible, so sections stay intact. Defaults to true.",
        ),
        heading_aware_level: z.number().int().min(1).max(6).optional().describe(
            "Deepest heading level treated as a split boundary (1–6). Defaults to 2.",
        ),
        max_chunks: z.number().int().min(1).max(2000).optional().describe(
            "Maximum chunks to return (1–2000). Defaults to 500.",
        ),
        // Structure extraction
        include_links: z.boolean().optional().describe(
            "Include every hyperlink with its text and rel attributes.",
        ),
        include_images: z.boolean().optional().describe(
            "Include every image with its src and alt text.",
        ),
        include_headings: z.boolean().optional().describe(
            "Include the heading outline, plus table/code-block detection flags.",
        ),
        // Envelope trimming
        include_markdown: z.boolean().optional().describe(
            "Set false to omit the prose body — useful when you only want structure or chunks.",
        ),
        include_metadata: z.boolean().optional().describe(
            "Include page metadata (title, description, language, canonical URL). Defaults to true.",
        ),
        include_chunks: z.boolean().optional().describe(
            "Set false to get chunk counts in `usage` without the chunk bodies.",
        ),
        // Rendering
        full_render: z.boolean().optional().describe(
            "Force full browser rendering before conversion. Rendering is applied automatically for " +
            "pages detected as JavaScript-heavy; set this when that detection is insufficient.",
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
        load_more_item_selector: z.string().optional().describe(
            "CSS selector for the repeating item, used to detect when clicking stopped adding content.",
        ),
        load_more_scroll: z.boolean().optional().describe(
            "Scroll between load_more clicks. Defaults to true.",
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
        use_proxy: z.boolean().optional().describe("Route the request through a standard proxy."),
        use_premium: z.boolean().optional().describe("Route the request through a premium proxy."),
        use_superior: z.boolean().optional().describe("Route the request through a superior-tier proxy."),
        proxy_country: z.string().optional().describe(
            "Two-letter ISO country code for geo-targeted proxy exit node.",
        ),
        auto_proxy: z.boolean().optional().describe(
            "Automatically escalate to a proxy if the direct request fails.",
        ),
        retry: z.boolean().optional().describe("Automatically retry failed requests."),
        max_retries: z.number().int().min(1).max(4).optional().describe(
            "Maximum number of retry attempts (1–4). Defaults to 4.",
        ),
        retry_escalate: z.boolean().optional().describe(
            "Escalate proxy tier on each retry attempt. Defaults to true.",
        ),
        // AI sanitizer
        ai_sanitize: z.boolean().optional().describe(
            "Scan the fetched content for prompt-injection attempts and return a safety report.",
        ),
        ai_sanitize_mode: z.enum(["sanitize", "warn", "block"]).optional().describe(
            "'sanitize' cleans the content, 'warn' reports without changing it, 'block' returns HTTP 422. " +
            "Only takes effect when ai_sanitize is true.",
        ),
    });

    outputSchema = z.object({
        url:             z.string(),
        markdown:        z.string().describe("Full Markdown content of the page"),
        length:          z.number().describe("Character count of the returned Markdown"),
        onlyMainContent: z.boolean().optional(),
        metadata:        z.any().optional().describe("Title, description, language, canonical and final URL"),
        usage:           z.any().optional().describe("Character/token counts and truncation status"),
        chunks:          z.any().optional().describe("Chunk objects, ranked by relevance when `query` is set"),
        headings:        z.any().optional(),
        links:           z.any().optional(),
        images:          z.any().optional(),
        ai_safety:       z.any().optional().describe("Prompt-injection report; present when ai_sanitize is true"),
        debug:           z.any().optional().describe("Whether rendering, a proxy, or retries were used"),
        request_id:      z.string().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            // Ranking is only meaningful over chunks, so asking a question implies it.
            if (options.query && options.chunking === undefined) {
                options.chunking = true;
            }
            const result = await getSiteMarkdown(url, this.appId, options);
            return toResult(
                formatMarkdown(url, { ...result, onlyMainContent: args.only_main_content }),
            );
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Page as Markdown", reason));
        }
    }
}

export default GetOgMarkdownTool;
