import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getAuditStatus } from "@/utils/site-audit-api";
import { formatAuditStatus, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetSiteAuditStatusTool extends BaseTool {
    private accessToken: string;

    constructor(accessToken = "") {
        super();
        this.accessToken = accessToken;
    }

    name = ToolNames.GET_SITE_AUDIT_STATUS;

    description =
        "Poll the status of a running site audit. Returns the current status " +
        "(QUEUED, CRAWLING, SCORING, COMPLETE, or FAILED), plus progress counters and summary scores " +
        "once the audit finishes.\n\n" +
        "Call this repeatedly every 5–10 seconds after **startSiteAudit** until status is COMPLETE, " +
        "then call **getSiteAuditReport** to retrieve the full results.\n\n" +
        "Pick the right tool:\n" +
        "  getSiteAuditStatus → Poll progress after startSiteAudit\n" +
        "  getSiteAuditReport → Get the full report once status is COMPLETE";

    annotations = {
        title:          "Get Site Audit Status",
        readOnlyHint:   true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint:  true,
    };

    inputSchema = z.object({
        auditId: z.string().describe(
            "The audit ID returned by startSiteAudit.",
        ),
    });

    outputSchema = z.object({
        auditId:        z.string(),
        status:         z.enum(["QUEUED", "CRAWLING", "SCORING", "COMPLETE", "FAILED"]),
        domain:         z.string(),
        score:          z.number().nullable().optional(),
        pagesRequested: z.number(),
        pagesAudited:   z.number().nullable().optional(),
        pagesFetched:   z.number().nullable().optional(),
        criticalIssues: z.number().nullable().optional(),
        totalIssues:    z.number().nullable().optional(),
        completedAt:    z.string().nullable().optional(),
        errorMessage:   z.string().nullable().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Get Site Audit Status", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        try {
            const { audit } = await getAuditStatus(args.auditId, this.accessToken);
            return toResult(formatAuditStatus(audit));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Site Audit Status", reason));
        }
    }
}

export default GetSiteAuditStatusTool;
