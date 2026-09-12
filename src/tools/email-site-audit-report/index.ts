import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { emailAuditReport } from "@/utils/site-audit-api";
import { formatReportEmailed, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class EmailSiteAuditReportTool extends BaseTool {
    private accessToken: string;
    constructor(accessToken = "") { super(); this.accessToken = accessToken; }

    name = ToolNames.EMAIL_SITE_AUDIT_REPORT;
    description =
        "Email an audit report, with PDF attachments, to the authenticated account's own address.\n\n" +
        "THIS SENDS REAL EMAIL EVERY TIME IT IS CALLED — it is not idempotent, so do not retry it " +
        "on a timeout without checking with the user first.\n\n" +
        "The recipient cannot be chosen: reports go only to the account that authorized this " +
        "connection. Sending to a colleague or client is a dashboard action. Requires the PDF " +
        "export entitlement, and is rate limited.";

    annotations = {
        title: "Email Site Audit Report",
        readOnlyHint: false,
        // Mail leaves the system and cannot be unsent, so clients should confirm
        // even though the recipient is pinned to the account owner.
        destructiveHint: true,
        // Each call renders PDFs and dispatches mail — repeats are not free.
        idempotentHint: false,
        openWorldHint: true,
    };

    inputSchema = z.object({ auditId: z.string().describe("The completed audit to send.") });
    outputSchema = z.object({
        auditId: z.string(), recipient: z.string().nullable(), filenames: z.array(z.string()),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) return toResult(formatError("Email Site Audit Report", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        try {
            return toResult(formatReportEmailed(args.auditId, await emailAuditReport(args.auditId, this.accessToken)));
        } catch (error: unknown) {
            return toResult(formatError("Email Site Audit Report", error instanceof Error ? error.message : String(error)));
        }
    }
}
export default EmailSiteAuditReportTool;
