import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getSiteOgData } from "@/utils/og";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgDataTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_DATA;
    description = "Get OpenGraph data from a given URL";

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to analyze meta tags from"),
        cache_ok: z.boolean().optional().describe("Whether to use cached results. Set to false to bypass cache and get fresh data. Defaults to true."),
        max_cache_age: z.number().int().optional().describe("Maximum cache age in milliseconds. Results older than this will be re-fetched. Defaults to 432000000 (5 days)."),
        full_render: z.boolean().optional().describe("Whether to fully render the page with JavaScript before extracting data. Useful for SPAs and JS-heavy sites. Defaults to false."),
        accept_lang: z.string().optional().describe("Accept-Language header value to send with the request. Use 'auto' to use the default. Defaults to 'en-US,en;q=0.9'."),
        use_proxy: z.boolean().optional().describe("Whether to use a proxy for the request. Defaults to false."),
        use_premium: z.boolean().optional().describe("Whether to use a premium proxy for the request. Defaults to false."),
        use_superior: z.boolean().optional().describe("Whether to use a superior proxy for the request. Defaults to false.")
    });

    outputSchema = z.object({
        hybridGraph: z.any().describe("Hybrid Graph"),
        openGraph: z.any().describe("Open Graph"),
        htmlInferred: z.any().describe("HTML Inferred")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            const og_data = await getSiteOgData(url, this.appId, options);
            
            return {
                content: [
                    { 
                        type: "text", 
                        text: JSON.stringify({
                            hybridGraph: og_data.hybridGraph || {},
                            openGraph: og_data.openGraph || {},
                            htmlInferred: og_data.htmlInferred || {}
                        })
                    }
                ]
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    { 
                        type: "text", 
                        text: JSON.stringify({ error: `Error fetching OG Data: ${errorMessage}` })
                    }
                ]
            };
        }
    }
}

export default GetOgDataTool;
