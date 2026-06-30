import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { createAudit } from "@/utils/site-audit-api";
import { formatAuditStarted, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class StartSiteAuditTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.START_SITE_AUDIT;

    description =
        "Start a full site audit for a domain. Audits each page for Open Graph, social media, " +
        "and SEO metadata quality, then generates an AI-powered overview and per-page scores.\n\n" +
        "The `urls` array can be sourced from anywhere — **discoverSiteUrls** structured output, " +
        "a codebase route scan (read route files and construct full URLs), a sitemap, or a manually " +
        "provided list. Calling discoverSiteUrls first is NOT required.\n\n" +
        "For 'audit all': pass every URL from discoverSiteUrls structured output directly. " +
        "For 'codebase scan': find routes in the project files (Next.js app/, pages/, React Router " +
        "config, etc.), prepend the domain, and pass them here. " +
        "If `urls` is omitted the backend crawls the domain internally.\n\n" +
        "Audits are asynchronous and can take several minutes. This tool returns an audit ID " +
        "immediately — use **getSiteAuditStatus** to poll progress, then **getSiteAuditReport** " +
        "to retrieve the completed report.\n\n" +
        "Pick the right tool:\n" +
        "  discoverSiteUrls  → Crawl-based page discovery (use when you don't have the codebase)\n" +
        "  startSiteAudit    → Run the audit — accepts URLs from any source\n" +
        "  getSiteAuditStatus → Poll until COMPLETE\n" +
        "  getSiteAuditReport → Get the full report\n" +
        "  previewPageAudit  → Instantly audit a single URL without waiting";

    annotations = {
        title:          "Start Site Audit",
        readOnlyHint:   false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint:  true,
    };

    inputSchema = z.object({
        domain: z.string().describe(
            "The domain to audit. Include the protocol (e.g. https://example.com).",
        ),
        pagesRequested: z.number().int().min(1).max(500).optional().describe(
            "Number of pages to audit (1–500). Defaults to the length of the `urls` array if provided, " +
            "otherwise 10. Your plan's monthly URL quota limits the maximum across all audits.",
        ),
        urls: z.array(z.string()).optional().describe(
            "Specific URLs to audit. Pass the user-selected subset from **discoverSiteUrls**. " +
            "When omitted, the audit crawls the domain internally.",
        ),
        siteContextText: z.string().optional().describe(
            "Homepage text from **discoverSiteUrls** structured output (`siteContextText`). " +
            "Including this enriches the AI-generated overview and top-priority analysis.",
        ),
    });

    outputSchema = z.object({
        auditId:        z.string().describe("ID to pass to getSiteAuditStatus and getSiteAuditReport"),
        status:         z.string().describe("Initial status — always QUEUED on creation"),
        domain:         z.string(),
        pagesRequested: z.number(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Start Site Audit", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        if (!this.organizationId) {
            return toResult(formatError("Start Site Audit", "Organization ID not found in token. Reconnect the MCP server."));
        }
        try {
            const { urls, siteContextText, domain, pagesRequested } = args;
            // When a URL list is provided, default pagesRequested to its length
            const pages = pagesRequested ?? (urls && urls.length > 0 ? urls.length : 10);
            const result = await createAudit(
                this.organizationId,
                domain,
                pages,
                this.accessToken,
                urls,
                siteContextText,
            );
            return toResult(formatAuditStarted(result.audit, result.clamp));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Start Site Audit", reason));
        }
    }
}

export default StartSiteAuditTool;
