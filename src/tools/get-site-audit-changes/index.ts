import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getAuditDiff, getAuditPriorities } from "@/utils/site-audit-api";
import { formatAuditChanges, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetSiteAuditChangesTool extends BaseTool {
    private accessToken: string;

    constructor(accessToken = "") {
        super();
        this.accessToken = accessToken;
    }

    name = ToolNames.GET_SITE_AUDIT_CHANGES;

    description =
        "Answer 'what changed on this site, and what should I fix first?' for a completed audit.\n\n" +
        "Combines two things the dashboard shows together: the change report against the previous " +
        "audit (issues that are new, fixed, or regressed, plus pages added or removed and the score " +
        "delta), and the prioritized issue groups (fix-first, fix-as-pattern, review-next, " +
        "low-priority).\n\n" +
        "A regressed issue is one that was previously verified as fixed and has come back — that is " +
        "tracked across runs by durable issue identity, not by comparing two lists, so it stays " +
        "accurate even when the baseline advances automatically.\n\n" +
        "Pass `baseline` to compare against a specific earlier audit instead of the default.";

    annotations = {
        title: "Get Site Audit Changes",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        auditId: z.string().describe("ID of a completed audit (from startSiteAudit or listSiteAudits)."),
        baseline: z.string().optional().describe(
            "Audit ID to compare against. Defaults to the audit's recorded baseline.",
        ),
    });

    outputSchema = z.object({
        auditId:    z.string(),
        diff:       z.any().nullable(),
        priorities: z.any().nullable(),
        degraded:   z.string().nullable().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Get Site Audit Changes", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        try {
            // Two independent gateway reads — run them together, and let one
            // succeed on its own rather than losing both to a single failure.
            const [diffOutcome, prioritiesOutcome] = await Promise.allSettled([
                getAuditDiff(args.auditId, this.accessToken, args.baseline),
                getAuditPriorities(args.auditId, this.accessToken),
            ]);

            const diff       = diffOutcome.status === "fulfilled" ? diffOutcome.value : null;
            const priorities = prioritiesOutcome.status === "fulfilled" ? prioritiesOutcome.value : null;

            if (!diff && !priorities) {
                const reason = diffOutcome.status === "rejected"
                    ? (diffOutcome.reason?.message ?? String(diffOutcome.reason))
                    : "Request failed";
                return toResult(formatError("Get Site Audit Changes", reason));
            }

            const degraded = !diff
                ? "Change report unavailable — priorities only."
                : (!priorities ? "Prioritization unavailable — change report only." : undefined);

            return toResult(formatAuditChanges(args.auditId, diff, priorities, degraded));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Site Audit Changes", reason));
        }
    }
}

export default GetSiteAuditChangesTool;
