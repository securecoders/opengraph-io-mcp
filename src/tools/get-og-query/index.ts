import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { querySite } from "@/utils/og";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgQueryTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_QUERY;
    description = "Query a site with a custom question and response structure using the OG Query endpoint.";
    annotations = {
        title: "Query Website Content",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        site: z.string().url().describe("Site to request (full URL)"),
        query: z.string().describe("Query to ask about the site"),
        responseStructure: z.any().optional().describe("Optional JSON for response structure"),
        modelSize: z.enum(["nano", "mini", "standard"]).optional().describe("AI model size to use for the query. 'nano' is fastest/cheapest, 'standard' is most capable. Defaults to 'nano'."),
        cache_ok: z.boolean().optional().describe("Whether to use cached results. Set to false to bypass cache and get fresh data. Defaults to true."),
        max_cache_age: z.number().int().optional().describe("Maximum cache age in milliseconds. Results older than this will be re-fetched. Defaults to 432000000 (5 days)."),
        full_render: z.boolean().optional().describe("Whether to fully render the page with JavaScript before querying. Useful for SPAs and JS-heavy sites. Defaults to false."),
        accept_lang: z.string().optional().describe("Accept-Language header value to send with the request. Use 'auto' to use the default. Defaults to 'en-US,en;q=0.9'."),
        use_proxy: z.boolean().optional().describe("Whether to use a proxy for the request. Defaults to false."),
        use_premium: z.boolean().optional().describe("Whether to use a premium proxy for the request. Defaults to false."),
        use_superior: z.boolean().optional().describe("Whether to use a superior proxy for the request. Defaults to false.")
    });

    outputSchema = z.object({
        result: z.any().describe("Raw JSON response from the OG Query endpoint")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { site, query, responseStructure, ...options } = args;
            const result = await querySite(site, query, responseStructure, this.appId, options);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ result })
                    }
                ]
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ error: `Error querying site: ${errorMessage}` })
                    }
                ]
            };
        }
    }
}

export default GetOgQueryTool;
