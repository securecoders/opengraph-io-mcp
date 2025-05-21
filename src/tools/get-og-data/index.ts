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
        url: z.string().url().describe("URL of the webpage to analyze meta tags from")
    });

    outputSchema = z.object({
        hybridGraph: z.any().describe("Hybrid Graph"),
        openGraph: z.any().describe("Open Graph"),
        htmlInferred: z.any().describe("HTML Inferred")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            // Fetch the webpage content
            const og_data = await getSiteOgData(args.url, this.appId);
            
            // Format the response as expected by CallToolResult
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