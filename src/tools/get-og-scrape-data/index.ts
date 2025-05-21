import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { scrapeSite } from "@/utils/og";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetOgScrapeDataTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_OG_SCRAPE_DATA;
    description = "Scrape data from a given URL using OpenGraph's scrape endpoint";

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to scrape data from")
    });

    outputSchema = z.object({
        scrapeData: z.any().describe("Raw scraped data from the URL")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            // Fetch the webpage content using scrape endpoint
            const scrapeData = await scrapeSite(args.url, this.appId);
            
            // Format the response as expected by CallToolResult
            return {
                content: [
                    { 
                        type: "text", 
                        text: JSON.stringify({ 
                            scrapeData: typeof scrapeData === 'string' ? scrapeData : scrapeData
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
                        text: JSON.stringify({ error: `Error scraping data: ${errorMessage}` })
                    }
                ]
            };
        }
    }
}

export default GetOgScrapeDataTool; 