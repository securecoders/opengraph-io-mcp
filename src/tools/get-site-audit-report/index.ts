import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getAuditReport } from "@/utils/site-audit-api";
import { formatAuditReport, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetSiteAuditReportTool extends BaseTool {
    private accessToken: string;

    constructor(accessToken = "") {
        super();
        this.accessToken = accessToken;
    }

    name = ToolNames.GET_SITE_AUDIT_REPORT;

    description =
        "Retrieve the full structured report for a completed site audit. " +
        "Returns an overall site score (0–100), per-page scores and issues, " +
        "an AI-generated site overview with top priorities and issue rollup, " +
        "and social preview data for each audited page.\n\n" +
        "Only available once the audit status is COMPLETE. Use **getSiteAuditStatus** to " +
        "check progress first.\n\n" +
        "Report contents:\n" +
        "  - Overall site score and summary (critical issues, total issues, passed checks)\n" +
        "  - AI overview: site summary, top priorities, strength areas\n" +
        "  - Issue rollup: business impact, affected page count, fix guidance\n" +
        "  - Per-page: score, check results, issues, social card previews (Facebook, Twitter, LinkedIn, Google)\n\n" +
        "Pick the right tool:\n" +
        "  getSiteAuditReport → Full results after audit is COMPLETE\n" +
        "  getSiteAuditStatus → Check status while audit is running\n" +
        "  previewPageAudit   → Instant single-URL audit without waiting";

    annotations = {
        title:          "Get Site Audit Report",
        readOnlyHint:   true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint:  true,
    };

    inputSchema = z.object({
        auditId: z.string().describe(
            "The audit ID returned by startSiteAudit. The audit must be in COMPLETE status.",
        ),
    });

    outputSchema = z.object({
        auditId:     z.string(),
        domain:      z.string(),
        score:       z.number().nullable().optional().describe("Overall site score 0–100"),
        status:      z.string(),
        pagesAudited: z.number().optional(),
        summary: z.object({
            totalIssues:    z.number(),
            criticalIssues: z.number(),
            warningIssues:  z.number(),
            passedChecks:   z.number(),
        }).optional(),
        aiSiteOverview: z.any().optional().describe("AI-generated overview: siteSummary, reportHighlights, issueRollup"),
        pages: z.array(z.object({
            url:          z.string(),
            score:        z.number().nullable().optional(),
            pageTitle:    z.string().nullable().optional(),
            issues:       z.array(z.any()).optional(),
            checks:       z.record(z.any()).optional(),
            previews:     z.any().optional(),
            aiAnalysis:   z.any().optional(),
        })).optional().describe("Per-page scores, checks, issues, and social previews"),
        completedAt: z.string().nullable().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Get Site Audit Report", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        try {
            const { report } = await getAuditReport(args.auditId, this.accessToken);
            return toResult(formatAuditReport(report));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Site Audit Report", reason));
        }
    }
}

export default GetSiteAuditReportTool;
