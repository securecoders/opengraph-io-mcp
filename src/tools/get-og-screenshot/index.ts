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
    annotations = {
        title: "Take Website Screenshot",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: z.string().url().describe("URL of the webpage to screenshot"),
        cache_ok: z.boolean().optional().describe("Whether to use cached results. Set to false to bypass cache and get fresh data. Defaults to true."),
        max_cache_age: z.number().int().optional().describe("Maximum cache age in milliseconds. Results older than this will be re-fetched. Defaults to 432000000 (5 days)."),
        full_render: z.boolean().optional().describe("Whether to fully render the page with JavaScript before taking the screenshot. Useful for SPAs and JS-heavy sites. Defaults to false."),
        accept_lang: z.string().optional().describe("Accept-Language header value to send with the request. Use 'auto' to use the default. Defaults to 'en-US,en;q=0.9'."),
        full_page: z.boolean().optional().describe("Whether to capture the full scrollable page instead of just the viewport. Defaults to false."),
        format: z.enum(["jpeg", "png", "webp"]).optional().describe("Image format for the screenshot. Options: 'jpeg', 'png', 'webp'. Defaults to 'jpeg'."),
        dimensions: z.enum(["lg", "md", "sm", "xs"]).optional().describe("Viewport dimensions for the screenshot. 'lg' (1920x1080), 'md' (1366x768), 'sm' (1024x768), 'xs' (375x812 mobile). Defaults to 'md'."),
        quality: z.number().int().min(10).max(80).optional().describe("Image quality (10-80, rounded to nearest 10). Lower values = smaller file size. Defaults to 80."),
        dark_mode: z.boolean().optional().describe("Whether to enable dark mode when capturing the screenshot. Defaults to false."),
        block_cookie_banner: z.boolean().optional().describe("Whether to attempt to block cookie consent banners. Defaults to true."),
        selector: z.string().optional().describe("CSS selector to capture a specific element instead of the full page."),
        exclude_selectors: z.string().optional().describe("Comma-separated CSS selectors of elements to hide before capturing the screenshot."),
        capture_delay: z.number().int().min(0).max(10000).optional().describe("Delay in milliseconds to wait before capturing the screenshot (0-10000). Useful for pages with animations."),
        use_proxy: z.boolean().optional().describe("Whether to use a proxy for the request. Defaults to false."),
        use_premium: z.boolean().optional().describe("Whether to use a premium proxy for the request. Defaults to false."),
        use_superior: z.boolean().optional().describe("Whether to use a superior proxy for the request. Defaults to false.")
    });

    outputSchema = z.object({
        screenshotUrl: z.string().describe("URL to the screenshot image")
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            const screenshotUrl = await getScreenshotUrl(url, this.appId, options);
            
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
