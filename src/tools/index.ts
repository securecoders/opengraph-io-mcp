import { Tool } from "@modelcontextprotocol/sdk/types.js";
import GetOgDataTool from "@/tools/get-og-data";
import GetOgScrapeDataTool from "@/tools/get-og-scrape-data";
import GetOgScreenshotTool from "@/tools/get-og-screenshot";
import GetOgQueryTool from "@/tools/get-og-query";
import GetOgExtractTool from "@/tools/get-og-extract";
import GetOgMarkdownTool from "@/tools/get-og-markdown";
// Image generation tools
import GenerateImageTool from "@/tools/generate-image";
import IterateImageTool from "@/tools/iterate-image";
import InspectImageSessionTool from "@/tools/inspect-image-session";
import ExportImageAssetTool from "@/tools/export-image-asset";
// Site Audit tools (require OAuth + Site Audit plan)
import DiscoverSiteUrlsTool from "@/tools/discover-site-urls";
import StartSiteAuditTool from "@/tools/start-site-audit";
import GetSiteAuditStatusTool from "@/tools/get-site-audit-status";
import GetSiteAuditReportTool from "@/tools/get-site-audit-report";
import PreviewPageAuditTool from "@/tools/preview-page-audit";
import GetLinkPreviewTool from "@/tools/get-link-preview";
import { ToolNames } from "@/tools/constants";

const tools: Tool[] = [
    new GetOgDataTool().toToolType(),
    new GetOgScrapeDataTool().toToolType(),
    new GetOgScreenshotTool().toToolType(),
    new GetOgQueryTool().toToolType(),
    new GetOgExtractTool().toToolType(),
    new GetOgMarkdownTool().toToolType(),
    // Image generation tools
    new GenerateImageTool().toToolType(),
    new IterateImageTool().toToolType(),
    new InspectImageSessionTool().toToolType(),
    new ExportImageAssetTool().toToolType(),
    // Site Audit tools
    new DiscoverSiteUrlsTool().toToolType(),
    new StartSiteAuditTool().toToolType(),
    new GetSiteAuditStatusTool().toToolType(),
    new GetSiteAuditReportTool().toToolType(),
    new PreviewPageAuditTool().toToolType(),
    new GetLinkPreviewTool().toToolType(),
];

export { ToolNames };
export { DiscoverSiteUrlsTool, StartSiteAuditTool, GetSiteAuditStatusTool, GetSiteAuditReportTool, PreviewPageAuditTool, GetLinkPreviewTool };
export default tools;