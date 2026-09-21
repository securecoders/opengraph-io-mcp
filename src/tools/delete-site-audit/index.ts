import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { deleteAudit } from "@/utils/site-audit-api";
import { formatAuditDeleted, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class DeleteSiteAuditTool extends BaseTool {
    private accessToken: string;
    constructor(accessToken = "") { super(); this.accessToken = accessToken; }

    name = ToolNames.DELETE_SITE_AUDIT;
    description =
        "Permanently delete one audit and all of its results — page scores, issues, and any fix " +
        "items saved against it.\n\n" +
        "This cannot be undone. The audit disappears from history and from the website's trend. " +
        "Re-running an audit produces a new one; it does not restore this. Confirm with the user " +
        "and delete exactly the audit they named.";

    annotations = {
        title: "Delete Site Audit",
        readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true,
    };

    inputSchema = z.object({ auditId: z.string().describe("The audit to delete.") });
    outputSchema = z.object({ auditId: z.string(), deleted: z.boolean(), alreadyGone: z.boolean() });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) return toResult(formatError("Delete Site Audit", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        try {
            await deleteAudit(args.auditId, this.accessToken);
            return toResult(formatAuditDeleted(args.auditId, false));
        } catch (error: unknown) {
            const status = (error as any)?.status;
            // Already gone is the requested end state. A 403 is not — treating
            // that as success would hide a denial and invite a retry loop.
            if (status === 404) return toResult(formatAuditDeleted(args.auditId, true));
            return toResult(formatError("Delete Site Audit", error instanceof Error ? error.message : String(error)));
        }
    }
}
export default DeleteSiteAuditTool;
