import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getScreenshotUrl } from "@/utils/og";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgScreenshotTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_SCREENSHOT;
    description = "Get a screenshot of a given URL using OpenGraph's screenshot endpoint";

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to screenshot")
    });

    outputSchema = z.object({
        screenshotUrl: z.string().describe("URL to the screenshot image")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            // Fetch the screenshot URL
            const screenshotUrl = await getScreenshotUrl(args.url, this.appId);
            
            // Format the response as expected by CallToolResult
            return {
                content: [
                    { 
                        type: "text", 
                        text: JSON.stringify({ screenshotUrl })
                    }
                ]
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    { 
                        type: "text", 
                        text: JSON.stringify({ error: `Error getting screenshot: ${errorMessage}` })
                    }
                ]
            };
        }
    }
}

export default GetOgScreenshotTool; 