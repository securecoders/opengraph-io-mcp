import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { extractHtmlElements } from "@/utils/og";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgExtractTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_EXTRACT;
    description = "Extract specified HTML elements from a given URL using OpenGraph's scrape endpoint.";

    inputSchema = z.object({
        site: z.string().url().describe("Site to request (full URL)"),
        html_elements: z.array(z.string()).describe("Array of HTML selectors to extract from the page"),
        cache_ok: z.boolean().optional().describe("Whether to use cached results. Set to false to bypass cache and get fresh data. Defaults to true."),
        max_cache_age: z.number().int().optional().describe("Maximum cache age in milliseconds. Results older than this will be re-fetched. Defaults to 432000000 (5 days)."),
        full_render: z.boolean().optional().describe("Whether to fully render the page with JavaScript before extracting. Useful for SPAs and JS-heavy sites. Defaults to false."),
        accept_lang: z.string().optional().describe("Accept-Language header value to send with the request. Use 'auto' to use the default. Defaults to 'en-US,en;q=0.9'."),
        use_proxy: z.boolean().optional().describe("Whether to use a proxy for the request. Defaults to false."),
        use_premium: z.boolean().optional().describe("Whether to use a premium proxy for the request. Defaults to false."),
        use_superior: z.boolean().optional().describe("Whether to use a superior proxy for the request. Defaults to false.")
    });

    outputSchema = z.object({
        extracted: z.record(z.string(), z.array(z.string())).describe("Mapping of selector to array of extracted HTML strings")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { site, html_elements, ...options } = args;
            const extracted = await extractHtmlElements(site, html_elements, this.appId, options);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ extracted })
                    }
                ]
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ error: `Error extracting HTML elements: ${errorMessage}` })
                    }
                ]
            };
        }
    }
}

export default GetOgExtractTool;
