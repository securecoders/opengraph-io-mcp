import { Tool } from "@modelcontextprotocol/sdk/types.js";
import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";

import GetOgDataTool from "@/tools/get-og-data";
import GetOgScrapeDataTool from "@/tools/get-og-scrape-data";
import GetOgScreenshotTool from "@/tools/get-og-screenshot";
import GetOgQueryTool from "@/tools/get-og-query";
import GetOgExtractTool from "@/tools/get-og-extract";
import GetOgMarkdownTool from "@/tools/get-og-markdown";
import GenerateImageTool from "@/tools/generate-image";
import IterateImageTool from "@/tools/iterate-image";
import InspectImageSessionTool from "@/tools/inspect-image-session";
import ExportImageAssetTool from "@/tools/export-image-asset";
import DiscoverSiteUrlsTool from "@/tools/discover-site-urls";
import StartSiteAuditTool from "@/tools/start-site-audit";
import GetSiteAuditStatusTool from "@/tools/get-site-audit-status";
import GetSiteAuditReportTool from "@/tools/get-site-audit-report";
import ListSiteAuditsTool from "@/tools/list-site-audits";
import GetSiteAuditChangesTool from "@/tools/get-site-audit-changes";
import ListWebsitesTool from "@/tools/list-websites";
import GetMonitoringScheduleTool from "@/tools/get-monitoring-schedule";
import SetMonitoringScheduleTool from "@/tools/set-monitoring-schedule";
import GetConnectionContextTool from "@/tools/get-connection-context";
import ListFixItemsTool from "@/tools/list-fix-items";
import SaveFixItemsTool from "@/tools/save-fix-items";
import DeleteFixItemTool from "@/tools/delete-fix-item";
import ExportFixItemsCsvTool from "@/tools/export-fix-items-csv";
import DeleteSiteAuditTool from "@/tools/delete-site-audit";
import EmailSiteAuditReportTool from "@/tools/email-site-audit-report";
import PreviewPageAuditTool from "@/tools/preview-page-audit";
import GetLinkPreviewTool from "@/tools/get-link-preview";

/** Per-request credentials resolved from the session's AuthContext. */
export interface ToolContext {
  appId: string;
  organizationId: string;
  accessToken: string;
  /** stdio/dev session with no session id — the app id falls back to the environment. */
  isLocal: boolean;
}

interface ToolRegistration {
  create: (ctx: ToolContext) => BaseTool;
  /**
   * Data and image tools refuse to run without the session's own app id over
   * HTTP; otherwise the API client falls back to the server's OPENGRAPH_APP_ID and
   * bills the operator. Site-audit tools don't carry it: they return a "reconnect
   * to authorize" result from execute() rather than throwing.
   */
  requiresAppId?: boolean;
  /**
   * Needs an OAuth session (organization identity), which a local stdio server
   * never has, so local servers neither list nor run these.
   */
  requiresOAuth?: boolean;
}

const REGISTRY: Record<ToolNames, ToolRegistration> = {
  [ToolNames.GET_OG_DATA]:        { create: (c) => new GetOgDataTool(c.appId),        requiresAppId: true },
  [ToolNames.GET_OG_SCRAPE_DATA]: { create: (c) => new GetOgScrapeDataTool(c.appId),  requiresAppId: true },
  [ToolNames.GET_OG_SCREENSHOT]:  { create: (c) => new GetOgScreenshotTool(c.appId),  requiresAppId: true },
  [ToolNames.GET_OG_QUERY]:       { create: (c) => new GetOgQueryTool(c.appId),       requiresAppId: true },
  [ToolNames.GET_OG_EXTRACT]:     { create: (c) => new GetOgExtractTool(c.appId),     requiresAppId: true },
  [ToolNames.GET_OG_MARKDOWN]:    { create: (c) => new GetOgMarkdownTool(c.appId),    requiresAppId: true },

  [ToolNames.GENERATE_IMAGE]:        { create: (c) => new GenerateImageTool(c.appId),                 requiresAppId: true },
  [ToolNames.ITERATE_IMAGE]:         { create: (c) => new IterateImageTool(c.appId),                  requiresAppId: true },
  [ToolNames.INSPECT_IMAGE_SESSION]: { create: (c) => new InspectImageSessionTool(c.appId),           requiresAppId: true },
  [ToolNames.EXPORT_IMAGE_ASSET]:    { create: (c) => new ExportImageAssetTool(c.appId, c.isLocal), requiresAppId: true },

  [ToolNames.DISCOVER_SITE_URLS]:    { create: (c) => new DiscoverSiteUrlsTool(c.accessToken, c.organizationId), requiresOAuth: true },
  [ToolNames.START_SITE_AUDIT]:      { create: (c) => new StartSiteAuditTool(c.accessToken, c.organizationId), requiresOAuth: true },
  [ToolNames.GET_SITE_AUDIT_STATUS]: { create: (c) => new GetSiteAuditStatusTool(c.accessToken), requiresOAuth: true },
  [ToolNames.GET_SITE_AUDIT_REPORT]: { create: (c) => new GetSiteAuditReportTool(c.accessToken), requiresOAuth: true },
  [ToolNames.LIST_SITE_AUDITS]:       { create: (c) => new ListSiteAuditsTool(c.accessToken, c.organizationId), requiresOAuth: true },
  [ToolNames.GET_SITE_AUDIT_CHANGES]: { create: (c) => new GetSiteAuditChangesTool(c.accessToken), requiresOAuth: true },
  [ToolNames.LIST_WEBSITES]:            { create: (c) => new ListWebsitesTool(c.accessToken, c.organizationId), requiresOAuth: true },
  [ToolNames.GET_MONITORING_SCHEDULE]:  { create: (c) => new GetMonitoringScheduleTool(c.accessToken, c.organizationId), requiresOAuth: true },
  [ToolNames.SET_MONITORING_SCHEDULE]:  { create: (c) => new SetMonitoringScheduleTool(c.accessToken, c.organizationId), requiresOAuth: true },
  [ToolNames.GET_CONNECTION_CONTEXT]:   { create: (c) => new GetConnectionContextTool(c.accessToken), requiresOAuth: true },
  [ToolNames.LIST_FIX_ITEMS]:           { create: (c) => new ListFixItemsTool(c.accessToken), requiresOAuth: true },
  [ToolNames.SAVE_FIX_ITEMS]:           { create: (c) => new SaveFixItemsTool(c.accessToken), requiresOAuth: true },
  [ToolNames.DELETE_FIX_ITEM]:          { create: (c) => new DeleteFixItemTool(c.accessToken), requiresOAuth: true },
  [ToolNames.EXPORT_FIX_ITEMS_CSV]:     { create: (c) => new ExportFixItemsCsvTool(c.accessToken), requiresOAuth: true },
  [ToolNames.DELETE_SITE_AUDIT]:        { create: (c) => new DeleteSiteAuditTool(c.accessToken), requiresOAuth: true },
  [ToolNames.EMAIL_SITE_AUDIT_REPORT]:  { create: (c) => new EmailSiteAuditReportTool(c.accessToken), requiresOAuth: true },
  [ToolNames.PREVIEW_PAGE_AUDIT]:    { create: (c) => new PreviewPageAuditTool(c.accessToken, c.organizationId), requiresOAuth: true },
  [ToolNames.GET_LINK_PREVIEW]:      { create: (c) => new GetLinkPreviewTool(c.accessToken, c.organizationId), requiresOAuth: true },
};

const EMPTY_CONTEXT: ToolContext = { appId: "", organizationId: "", accessToken: "", isLocal: false };

/** Tool descriptors for ListTools, derived from the same table dispatch uses. */
export const toolDefinitions: Tool[] = (Object.keys(REGISTRY) as ToolNames[])
  .map((name) => REGISTRY[name].create(EMPTY_CONTEXT).toToolType());

/** What a local stdio server advertises: only tools an App ID alone can run. */
export const localToolDefinitions: Tool[] = toolDefinitions
  .filter((tool) => !REGISTRY[tool.name as ToolNames].requiresOAuth);

export function resolveTool(name: string, ctx: ToolContext): BaseTool {
  const registration = REGISTRY[name as ToolNames];
  if (!registration) {
    throw new Error(`Unknown tool: ${name}`);
  }
  if (registration.requiresOAuth && ctx.isLocal) {
    throw new Error(`${name} needs the hosted server with OAuth; it is not available when running locally.`);
  }
  if (registration.requiresAppId && !ctx.isLocal && !ctx.appId) {
    throw new Error("Could not find App ID for session.");
  }
  return registration.create(ctx);
}

export const registeredToolNames = Object.keys(REGISTRY) as ToolNames[];
