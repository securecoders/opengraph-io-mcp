import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { previewPage } from "@/utils/site-audit-api";
import { formatPagePreview, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class PreviewPageAuditTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.PREVIEW_PAGE_AUDIT;

    description =
        "Run an instant quality audit of a single URL. Returns a score (0–100), " +
        "a score label (Well Optimized / Good / Needs Attention / Poor), " +
        "a breakdown of Open Graph and social metadata checks, any issues found, " +
        "and mock social previews for Facebook, Twitter, LinkedIn, and Google.\n\n" +
        "This is a synchronous, single-URL check — it returns results immediately without creating " +
        "a persisted audit. It does not count against your audit page quota.\n\n" +
        "Score labels:\n" +
        "  Well Optimized (≥90) · Good (≥80) · Room for Improvement (≥70) · Needs Attention (≥60) · Poor (<60)\n\n" +
        "Pick the right tool:\n" +
        "  previewPageAudit  → Instant check of one URL (no quota consumed, returns immediately)\n" +
        "  startSiteAudit    → Crawl and audit an entire domain (async, uses quota)";

    annotations = {
        title:          "Preview Page Audit",
        readOnlyHint:   true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint:  true,
    };

    inputSchema = z.object({
        url: z.string().url().describe(
            "The full URL of the page to audit (e.g. https://example.com/product).",
        ),
    });

    outputSchema = z.object({
        url:        z.string(),
        score:      z.number().describe("Quality score 0–100"),
        scoreLabel: z.string().describe("Human-readable score tier"),
        summary: z.object({
            totalIssues:    z.number(),
            criticalIssues: z.number(),
            warningIssues:  z.number(),
            passedChecks:   z.number(),
        }).optional(),
        checks:   z.record(z.any()).optional().describe("Individual check results keyed by check name"),
        issues:   z.array(z.any()).optional().describe("Issues found on the page with severity and guidance"),
        previews: z.any().optional().describe("Social card mock previews: facebook, twitter, linkedin, google"),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Preview Page Audit", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        if (!this.organizationId) {
            return toResult(formatError("Preview Page Audit", "Organization ID not found in token. Reconnect the MCP server."));
        }
        try {
            const result = await previewPage(this.organizationId, args.url, this.accessToken);
            return toResult(formatPagePreview(result));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Preview Page Audit", reason));
        }
    }
}

export default PreviewPageAuditTool;
