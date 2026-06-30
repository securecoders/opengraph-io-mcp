import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { discoverSiteUrls } from "@/utils/site-audit-api";
import { formatDiscoverResult, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class DiscoverSiteUrlsTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.DISCOVER_SITE_URLS;

    description =
        "Discover all pages on a domain by crawling it and parsing its sitemap. " +
        "Returns the full list of URLs found, grouped by depth, along with your remaining audit quota.\n\n" +
        "Use this as the first step before starting a full site audit — it lets the user choose " +
        "exactly which pages to include. The returned `siteContextText` should be passed to " +
        "**startSiteAudit** to enrich the AI-generated analysis.\n\n" +
        "After calling this tool, present the URL list to the user and ask: " +
        "_\"Which pages would you like to audit? You can say 'all', pick specific numbers, " +
        "or describe a section (e.g. 'all blog posts' or 'just the homepage and product pages')._\"\n\n" +
        "Pick the right tool:\n" +
        "  discoverSiteUrls → Step 1: find and review all pages on the domain\n" +
        "  startSiteAudit   → Step 2: audit the pages the user selected\n" +
        "  previewPageAudit → Skip discovery — instantly audit a single specific URL";

    annotations = {
        title:          "Discover Site URLs",
        readOnlyHint:   true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint:  true,
    };

    inputSchema = z.object({
        domain: z.string().describe(
            "The domain to crawl (e.g. https://example.com). Include the protocol.",
        ),
    });

    outputSchema = z.object({
        domain:          z.string(),
        totalFound:      z.number().describe("Total URLs found across crawl and sitemap"),
        urls: z.array(z.object({
            url:    z.string(),
            source: z.string().describe("'sitemap' or 'crawl'"),
            depth:  z.number().describe("0 = homepage, 1 = top-level pages, 2+ = deeper"),
        })).describe("All discovered URLs — pass a subset to startSiteAudit as the urls array"),
        siteContextText: z.string().optional().describe(
            "Homepage text captured during discovery — pass this to startSiteAudit to enrich AI analysis",
        ),
        remainingQuota:  z.number().nullable().optional().describe("Pages remaining in your monthly audit quota"),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Discover Site URLs", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        if (!this.organizationId) {
            return toResult(formatError("Discover Site URLs", "Organization ID not found in token. Reconnect the MCP server."));
        }
        try {
            const result = await discoverSiteUrls(this.organizationId, args.domain, this.accessToken);
            return toResult(formatDiscoverResult(result));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Discover Site URLs", reason));
        }
    }
}

export default DiscoverSiteUrlsTool;
