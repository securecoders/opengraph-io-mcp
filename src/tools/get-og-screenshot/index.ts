import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getScreenshotUrl } from "@/utils/og";
import { formatScreenshot, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgScreenshotTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_SCREENSHOT;
    description =
        "Capture a screenshot of any URL via the OpenGraph.io API (v3). " +
        "Supports full-page or viewport captures, custom viewport dimensions, dark mode, " +
        "image format/quality control, cookie-banner dismissal, and CSS selector-based element targeting or exclusion.\n\n" +
        "Returns a `screenshotUrl` — a hosted URL pointing to the screenshot image file, not inline image data. " +
        "Use this URL directly in a browser, an <img> tag, or pass it to another tool.\n\n" +
        "Pick the right tool:\n" +
        "  getOgData        → Open Graph tags, social preview metadata (title, description, image, favicon)\n" +
        "  getOgMarkdown    → Clean readable text / article prose — ideal for feeding into an LLM\n" +
        "  getOgScrapeData  → Raw HTML — use when you need to do your own parsing or link extraction\n" +
        "  getOgExtract     → Targeted elements by tag (html_elements) or named CSS selectors (selectors)\n" +
        "  getOgScreenshot  → Visual capture of a page as an image\n" +
        "  getOgQuery       → Natural-language question answered from page content (100–200 credits/request)";

    annotations = {
        title: "Screenshot URL",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to screenshot."),
        // Screenshot-specific
        full_page: z.boolean().optional().describe(
            "Capture the full scrollable page height. Defaults to false (viewport only).",
        ),
        format: z.enum(["jpg", "png", "webp"]).optional().describe(
            "Image format. Defaults to 'jpg'.",
        ),
        dimensions: z.string().optional().describe(
            "Viewport dimensions as WxH (e.g. '1280x800'). Defaults to '1366x768'.",
        ),
        quality: z.number().int().min(1).max(100).optional().describe(
            "Image compression quality 1–100. Only applies to jpg/webp. Defaults to 80.",
        ),
        dark_mode: z.boolean().optional().describe(
            "Enable dark mode (prefers-color-scheme: dark). Defaults to false.",
        ),
        block_cookie_banner: z.boolean().optional().describe(
            "Attempt to dismiss cookie consent banners before capturing. Defaults to false.",
        ),
        selector: z.string().optional().describe(
            "CSS selector — crop the screenshot to just this element.",
        ),
        exclude_selectors: z.string().optional().describe(
            "Comma-separated CSS selectors to hide (set visibility: hidden) before capturing.",
        ),
        hideSelectors: z.boolean().optional().describe(
            "Whether to apply the exclude_selectors hiding. Defaults to true when exclude_selectors is set.",
        ),
        capture_delay: z.number().int().min(0).max(10000).optional().describe(
            "Milliseconds to wait after page load before capturing (0–10 000). Defaults to 0.",
        ),
        navigationTimeout: z.number().int().min(1000).max(60000).optional().describe(
            "Navigation timeout in milliseconds (1 000–60 000). Defaults to 30 000.",
        ),
        // Fetch/proxy common params
        cache_ok: z.boolean().optional().describe(
            "Use cached results. Set to false to bypass cache. Defaults to true.",
        ),
        max_cache_age: z.number().int().optional().describe(
            "Maximum cache age in milliseconds. Defaults to 432000000 (5 days).",
        ),
        full_render: z.boolean().optional().describe(
            "Fully render the page with JavaScript before capturing. Defaults to true for screenshots.",
        ),
        wait_for_selector: z.string().optional().describe(
            "CSS selector to wait for before capturing.",
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
            "Two-letter ISO country code for geo-targeted proxy exit node (e.g. 'US', 'GB').",
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
    });

    outputSchema = z.object({
        url:           z.string().describe("Source URL that was screenshotted"),
        screenshotUrl: z.string().describe("Hosted URL of the screenshot image"),
        dimensions:    z.string().optional(),
        format:        z.string().optional(),
        fullPage:      z.boolean().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            const result = await getScreenshotUrl(url, this.appId, options);
            return toResult(
                formatScreenshot(url, {
                    screenshotUrl: result.screenshotUrl,
                    message:       result.message,
                    dimensions:    args.dimensions,
                    format:        args.format,
                    fullPage:      args.full_page,
                }),
            );
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Screenshot URL", reason));
        }
    }
}

export default GetOgScreenshotTool;
