import { Tool } from "@modelcontextprotocol/sdk/types.js";
import GetOgDataTool from "@/tools/get-og-data";
import GetOgScrapeDataTool from "@/tools/get-og-scrape-data";
import GetOgScreenshotTool from "@/tools/get-og-screenshot";
import GetOgQueryTool from "@/tools/get-og-query";
import GetOgExtractTool from "@/tools/get-og-extract";
// Image generation tools
import GenerateImageTool from "@/tools/generate-image";
import IterateImageTool from "@/tools/iterate-image";
import InspectImageSessionTool from "@/tools/inspect-image-session";
import ExportImageAssetTool from "@/tools/export-image-asset";
import { ToolNames } from "@/tools/constants";

const tools: Tool[] = [
    new GetOgDataTool().toToolType(),
    new GetOgScrapeDataTool().toToolType(),
    new GetOgScreenshotTool().toToolType(),
    new GetOgQueryTool().toToolType(),
    new GetOgExtractTool().toToolType(),
    // Image generation tools
    new GenerateImageTool().toToolType(),
    new IterateImageTool().toToolType(),
    new InspectImageSessionTool().toToolType(),
    new ExportImageAssetTool().toToolType(),
];

export { ToolNames };
export default tools;