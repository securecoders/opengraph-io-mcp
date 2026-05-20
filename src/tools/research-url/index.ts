import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getSiteOgData, extractHtmlElements, getScreenshotUrl, type CommonOgOptions } from "@/utils/og";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { successEnvelope, catchToEnvelope } from "@/tools/envelope";

const DEFAULT_BODY_SELECTORS = ["h1", "h2", "h3", "p"];

class ResearchUrlTool extends BaseTool {
    private appId: string;

    constructor(appId = "") {
        super();
        this.appId = appId;
    }

    name = ToolNames.RESEARCH_URL;
    annotations = {
        title: "Research URL (One-Shot)",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };
    description = `One-shot URL research: fetches OpenGraph metadata, extracts body content (h1/h2/h3/p), and optionally captures a screenshot \u2014 all in parallel and returned as a single envelope. Saves 2\u20133 tool calls per agent task vs. orchestrating ${ToolNames.GET_OG_DATA} + ${ToolNames.GET_OG_EXTRACT} + ${ToolNames.GET_OG_SCREENSHOT} yourself.

WHEN TO USE:
- First-touch summarization of an unknown URL (link in a chat, search result, citation).
- Building a link preview card with both metadata AND body context.
- Any workflow where you need the page's title/description AND its body text in the same step.

WHEN NOT TO USE:
- You only need OG metadata \u2192 use ${ToolNames.GET_OG_DATA} (cheaper, fewer credits).
- You need targeted CSS-selector extraction \u2192 use ${ToolNames.GET_OG_EXTRACT}.
- You need to ask a natural-language question about the page \u2192 use ${ToolNames.GET_OG_QUERY}.

CREDIT COST: 1 (og data) + 1 (extract) + 20 (screenshot, if include_screenshot=true; cache hit: 1). Standard/Premium/Superior proxy add-ons stack per sub-call.

CHAIN HINTS:
- If \`data.body.text\` comes back empty, retry with full_render: true (heavier but handles SPAs).
- If \`success === false\` with code BLOCKED_BY_TARGET, retry with use_premium: true; then use_superior: true.
- If you want a longer/different body shape, pass custom body_selectors (e.g. ["article", "main p"]).`;

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to research"),
        include_screenshot: z.boolean().optional().describe("Whether to also capture a screenshot in the same call. Adds ~1 credit. Defaults to false."),
        body_selectors: z.array(z.string()).optional().describe(`HTML selectors to extract body content from. Defaults to ${JSON.stringify(DEFAULT_BODY_SELECTORS)}.`),
        cache_ok: z.boolean().optional().describe("Whether to use cached results. Defaults to true."),
        max_cache_age: z.number().int().optional().describe("Maximum cache age in milliseconds. Defaults to 432000000 (5 days)."),
        full_render: z.boolean().optional().describe("Whether to fully render the page with JavaScript before extracting. Required for SPAs / JS-heavy sites. Defaults to false."),
        accept_lang: z.string().optional().describe("Accept-Language header value. Defaults to 'auto'."),
        use_proxy: z.boolean().optional().describe("Use a standard proxy. Defaults to false."),
        use_premium: z.boolean().optional().describe("Use a premium proxy. Defaults to false."),
        use_superior: z.boolean().optional().describe("Use a superior proxy. Defaults to false."),
    });

    outputSchema = z.object({
        url: z.string(),
        og: z.object({
            hybridGraph: z.any(),
            openGraph: z.any(),
            htmlInferred: z.any(),
        }),
        body: z.object({
            selectors: z.array(z.string()),
            extracted: z.any().nullable(),
            text: z.string(),
        }),
        screenshot: z.object({
            url: z.string(),
        }).nullable().optional(),
        partial_failures: z.array(z.object({
            step: z.string(),
            error: z.string(),
        })).optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        const { url, include_screenshot, body_selectors, ...sharedOptions } = args;
        const selectors = body_selectors && body_selectors.length > 0 ? body_selectors : DEFAULT_BODY_SELECTORS;
        const ogOptions: CommonOgOptions = sharedOptions;

        try {
            const tasks = await Promise.allSettled([
                getSiteOgData(url, this.appId, ogOptions),
                extractHtmlElements(url, selectors, this.appId, ogOptions),
                include_screenshot
                    ? getScreenshotUrl(url, this.appId, ogOptions)
                    : Promise.resolve(null),
            ]);

            const [ogResult, extractResult, screenshotResult] = tasks;
            const partialFailures: { step: string; error: string }[] = [];

            // If the og data call failed outright, surface that as the canonical
            // error since the rest of the payload is unlikely to be useful.
            if (ogResult.status === "rejected") {
                return catchToEnvelope(ogResult.reason, {
                    tool: this.name,
                    prefix: "research_url failed during og data fetch",
                });
            }

            let extractedData: unknown = null;
            let bodyText = "";
            if (extractResult.status === "fulfilled") {
                extractedData = extractResult.value ?? null;
                bodyText = flattenExtractToText(extractedData);
            } else {
                partialFailures.push({
                    step: "extract",
                    error: extractResult.reason instanceof Error
                        ? extractResult.reason.message
                        : String(extractResult.reason),
                });
            }

            let screenshot: { url: string } | null = null;
            if (include_screenshot) {
                if (screenshotResult.status === "fulfilled" && typeof screenshotResult.value === "string") {
                    screenshot = { url: screenshotResult.value };
                } else if (screenshotResult.status === "rejected") {
                    partialFailures.push({
                        step: "screenshot",
                        error: screenshotResult.reason instanceof Error
                            ? screenshotResult.reason.message
                            : String(screenshotResult.reason),
                    });
                }
            }

            const og = ogResult.value;
            const data = {
                url,
                og: {
                    hybridGraph: og.hybridGraph || {},
                    openGraph: og.openGraph || {},
                    htmlInferred: og.htmlInferred || {},
                },
                body: {
                    selectors,
                    extracted: extractedData,
                    text: bodyText,
                },
                ...(include_screenshot ? { screenshot } : {}),
                ...(partialFailures.length ? { partial_failures: partialFailures } : {}),
            };

            return successEnvelope(data, { tool: this.name });
        } catch (err) {
            return catchToEnvelope(err, { tool: this.name, prefix: "research_url failed" });
        }
    }
}

/**
 * Best-effort flattening of the og-api /extract response into a single text
 * blob. The response shape evolves so we defensively handle a few common
 * variants (concatenatedText, per-selector arrays, plain string fallback).
 */
const flattenExtractToText = (extracted: unknown): string => {
    if (!extracted) return "";
    if (typeof extracted === "string") return extracted;
    if (typeof extracted !== "object") return "";

    const obj = extracted as Record<string, unknown>;
    if (typeof obj.concatenatedText === "string") return obj.concatenatedText;
    if (Array.isArray(obj.extracted)) {
        return obj.extracted.filter((v): v is string => typeof v === "string").join("\n\n");
    }
    if (obj.extracted && typeof obj.extracted === "object") {
        return flattenSelectorMap(obj.extracted as Record<string, unknown>);
    }
    return flattenSelectorMap(obj);
};

const flattenSelectorMap = (selectorMap: Record<string, unknown>): string => {
    const parts: string[] = [];
    for (const value of Object.values(selectorMap)) {
        if (typeof value === "string") {
            parts.push(value);
        } else if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === "string") parts.push(item);
            }
        }
    }
    return parts.join("\n\n");
};

export default ResearchUrlTool;
