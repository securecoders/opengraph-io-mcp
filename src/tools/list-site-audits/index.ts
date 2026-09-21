import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { listAudits } from "@/utils/site-audit-api";
import { formatAuditList, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class ListSiteAuditsTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.LIST_SITE_AUDITS;

    description =
        "List past site audits for the connected organization — newest first by default. " +
        "Use this to find an audit to inspect, to track a domain's score over time, or to get " +
        "the previous audit ID for a comparison.\n\n" +
        "Filter with `q` (domain substring), `status`, `from` / `to` (ISO dates), or `websiteId` " +
        "to see every run for one monitored site. Page with `limit` and `offset`.\n\n" +
        "Returns audit IDs — feed one to **getSiteAuditReport** for full results, or to " +
        "**getSiteAuditChanges** to see what moved since the previous run.";

    annotations = {
        title: "List Site Audits",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        limit: z.number().int().min(1).max(100).optional().describe(
            "How many audits to return (1–100). Defaults to the server's page size.",
        ),
        offset: z.number().int().min(0).optional().describe("Rows to skip, for paging."),
        q: z.string().optional().describe("Filter by domain substring."),
        status: z.array(z.enum(["QUEUED", "CRAWLING", "SCORING", "COMPLETE", "FAILED"]))
            .optional().describe("Only return audits in these states."),
        from: z.string().optional().describe("Only audits created on or after this ISO date."),
        to: z.string().optional().describe("Only audits created on or before this ISO date."),
        sort: z.string().optional().describe("Server-supported sort key, e.g. '-createdAt'."),
        websiteId: z.string().optional().describe(
            "Only audits for this monitored website — use it to build a single site's history.",
        ),
    });

    outputSchema = z.object({
        audits: z.array(z.any()),
        total:  z.number(),
        limit:  z.number().optional(),
        offset: z.number().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("List Site Audits", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        if (!this.organizationId) {
            return toResult(formatError("List Site Audits", "Organization ID not found in token. Reconnect the MCP server."));
        }
        try {
            const result = await listAudits(this.organizationId, this.accessToken, args);
            return toResult(formatAuditList(result, args));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("List Site Audits", reason));
        }
    }
}

export default ListSiteAuditsTool;
