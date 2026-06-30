export enum ToolNames {
    GET_OG_DATA = "getOgData",
    GET_OG_SCRAPE_DATA = "getOgScrapeData",
    GET_OG_SCREENSHOT = "getOgScreenshot",
    GET_OG_QUERY = "getOgQuery",
    GET_OG_EXTRACT = "getOgExtract",
    GET_OG_MARKDOWN = "getOgMarkdown",
    // Image generation tools
    GENERATE_IMAGE = "generateImage",
    ITERATE_IMAGE = "iterateImage",
    INSPECT_IMAGE_SESSION = "inspectImageSession",
    EXPORT_IMAGE_ASSET = "exportImageAsset",
    // Site Audit tools (require OAuth + Site Audit plan)
    DISCOVER_SITE_URLS = "discoverSiteUrls",
    START_SITE_AUDIT = "startSiteAudit",
    GET_SITE_AUDIT_STATUS = "getSiteAuditStatus",
    GET_SITE_AUDIT_REPORT = "getSiteAuditReport",
    PREVIEW_PAGE_AUDIT = "previewPageAudit",
    GET_LINK_PREVIEW = "getLinkPreview",
}
