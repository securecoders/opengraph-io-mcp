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

    inputSchema = z.object({
        site: z.string().url().describe("Site to request (full URL)"),
        query: z.string().describe("Query to ask about the site"),
        responseStructure: z.any().optional().describe("Optional JSON for response structure")
    });

    outputSchema = z.object({
        result: z.any().describe("Raw JSON response from the OG Query endpoint")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const result = await querySite(args.site, args.query, args.responseStructure, this.appId);
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