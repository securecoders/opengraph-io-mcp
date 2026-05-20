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
// Agent-first composite + meta tools (1.5.0)
import ResearchUrlTool from "@/tools/research-url";
import ListCapabilitiesTool from "@/tools/list-capabilities";
import { ToolNames } from "@/tools/constants";

const tools: Tool[] = [
    // Composite + meta first so they're easy to spot in tools/list output
    new ResearchUrlTool().toToolType(),
    new ListCapabilitiesTool().toToolType(),
    // Web tools
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