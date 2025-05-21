import { Tool } from "@modelcontextprotocol/sdk/types.js";
import GetOgDataTool from "@/tools/get-og-data";
import GetOgScrapeDataTool from "@/tools/get-og-scrape-data";
import GetOgScreenshotTool from "@/tools/get-og-screenshot";
import { ToolNames } from "@/tools/constants";

const tools: Tool[] = [
    new GetOgDataTool().toToolType(),
    new GetOgScrapeDataTool().toToolType(),
    new GetOgScreenshotTool().toToolType(),
];

export { ToolNames };
export default tools;