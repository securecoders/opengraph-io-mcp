import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { httpUrl } from "@/utils/urlInput";
import { querySite } from "@/utils/og";
import { formatQuery, formatError, toResult, toUntrustedResult, provenanceSchema } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgQueryTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_QUERY;
    description =
        "Ask a natural-language question about the content of any URL and receive an AI-generated answer via the OpenGraph.io API. " +
        "Optionally pass a responseStructure schema to extract structured data. " +
        "Uses 100 API credits per request (200 with the 'mini' model); a cached answer uses 1.";

    annotations = {
        title: "Query URL Content",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: httpUrl().describe("URL of the webpage to query."),
        query: z.string().min(1).describe(
            "Natural-language question to answer about the page content.",
        ),
        responseStructure: z.any().optional().describe(
            "Optional JSON schema describing the shape of the desired response. When provided, the model returns a structured JSON answer.",
        ),
        // og-api only knows nano and mini; it still maps the old small/large for installed older versions.
        modelSize: z.enum(["nano", "mini"]).optional().describe(
            "AI model size. 'nano' is fast and uses 100 credits; 'mini' uses a larger model for harder questions and uses 200. Defaults to 'nano'.",
        ),
        // Fetch/proxy params
        cache_ok: z.boolean().optional().describe(
            "Use cached page results. Set to false to bypass cache. Defaults to true.",
        ),
        max_cache_age: z.number().int().optional().describe(
            "Maximum cache age in milliseconds. Defaults to 432000000 (5 days).",
        ),
        full_render: z.boolean().optional().describe(
            "Fully render the page with JavaScript before querying.",
        ),
        auto_render: z.boolean().optional().describe(
            "Automatically detect and switch to headless rendering for SPA pages.",
        ),
        wait_for_selector: z.string().optional().describe(
            "CSS selector to wait for before querying.",
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
            "'sanitize' cleans the content, 'warn' returns a safety report, 'block' returns HTTP 422 when risk_score >= 0.7.",
        ),
    });

    outputSchema = z.object({
        provenance: provenanceSchema,
        url:      z.string(),
        question: z.string(),
        result:   z.any().describe("AI-generated answer. May be a string or structured object."),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, query, responseStructure, ...options } = args;
            const raw = await querySite(url, query, responseStructure, this.appId, options);
            // The API returns { answer: ... } or similar — surface the whole payload
            const result = raw?.answer ?? raw?.result ?? raw;
            return toUntrustedResult(formatQuery(url, query, result), url);
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Query URL Content", reason));
        }
    }
}

export default GetOgQueryTool;
