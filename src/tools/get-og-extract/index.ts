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
        "Extract specific HTML elements from a webpage by tag name via the OpenGraph.io API. " +
        "Useful for pulling headings, links, paragraphs, images, or any other elements at scale. " +
        "Returns a count summary, a compact table, and the full element data in structured output. " +
        "Note: uses the v1.1 GET endpoint — no v3 GET route exists for this capability yet.";

    annotations = {
        title: "Extract HTML Elements",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to extract elements from."),
        html_elements: z.array(z.string()).min(1).describe(
            "List of HTML tag names to extract (e.g. ['h1', 'h2', 'a', 'img', 'p']).",
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
            "Automatically detect and switch to headless rendering for SPA pages.",
        ),
        wait_for_selector: z.string().optional().describe(
            "CSS selector to wait for before extracting.",
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
            "Automatically escalate to a proxy if the direct request fails.",
        ),
        retry: z.boolean().optional().describe(
            "Automatically retry failed requests.",
        ),
        max_retries: z.number().int().min(1).max(4).optional().describe(
            "Maximum number of retry attempts (1–4). Defaults to 4.",
        ),
        ai_sanitize: z.boolean().optional().describe(
            "Scan the fetched content for prompt-injection attempts.",
        ),
        ai_sanitize_mode: z.enum(["sanitize", "warn", "block"]).optional().describe(
            "'sanitize' cleans the content, 'warn' returns a safety report, 'block' returns HTTP 422.",
        ),
    });

    outputSchema = z.object({
        url:               z.string(),
        tags:              z.array(z.object({
            tag:       z.string(),
            innerText: z.string(),
            position:  z.number().optional(),
        })).describe("Extracted elements with their text content"),
        concatenatedText:  z.string().optional().describe("All inner text concatenated"),
        data:              z.any().optional().describe("Full raw API response data"),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, html_elements, ...options } = args;
            const raw = await extractHtmlElements(url, html_elements, this.appId, options);
            // Normalize response — og-api returns { tags, concatenatedText, data, ... }
            const payload = {
                tags:            raw?.tags            ?? raw?.elements ?? [],
                concatenatedText: raw?.concatenatedText ?? raw?.allText,
                data:            raw?.data,
                ai_safety:       raw?.ai_safety,
            };
            return toResult(formatExtract(url, payload));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Extract HTML Elements", reason));
        }
    }
}

export default GetOgExtractTool;
