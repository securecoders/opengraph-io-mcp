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
    annotations = {
        title: "Scrape Website Data",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to scrape data from"),
        cache_ok: z.boolean().optional().describe("Whether to use cached results. Set to false to bypass cache and get fresh data. Defaults to true."),
        max_cache_age: z.number().int().optional().describe("Maximum cache age in milliseconds. Results older than this will be re-fetched. Defaults to 432000000 (5 days)."),
        full_render: z.boolean().optional().describe("Whether to fully render the page with JavaScript before scraping. Useful for SPAs and JS-heavy sites. Defaults to false."),
        accept_lang: z.string().optional().describe("Accept-Language header value to send with the request. Use 'auto' to use the default. Defaults to 'en-US,en;q=0.9'."),
        use_proxy: z.boolean().optional().describe("Whether to use a proxy for the request. Defaults to false."),
        use_premium: z.boolean().optional().describe("Whether to use a premium proxy for the request. Defaults to false."),
        use_superior: z.boolean().optional().describe("Whether to use a superior proxy for the request. Defaults to false.")
    });

    outputSchema = z.object({
        scrapeData: z.any().describe("Raw scraped data from the URL")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            const scrapeData = await scrapeSite(url, this.appId, options);
            
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
