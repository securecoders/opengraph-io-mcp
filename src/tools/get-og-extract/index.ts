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
        html_elements: z.array(z.string()).describe("Array of HTML selectors to extract from the page")
    });

    outputSchema = z.object({
        extracted: z.record(z.string(), z.array(z.string())).describe("Mapping of selector to array of extracted HTML strings")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const extracted = await extractHtmlElements(args.site, args.html_elements, this.appId);
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