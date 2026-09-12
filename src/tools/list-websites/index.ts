import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { listWebsites, getWebsite } from "@/utils/site-audit-api";
import { formatWebsiteList, formatWebsiteDetail, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class ListWebsitesTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.LIST_WEBSITES;

    description =
        "List the websites this organization has audited, with their current health: score and " +
        "trend against the previous audit, critical issue count, how many issues have regressed, " +
        "known page count, and when the next scheduled audit runs.\n\n" +
        "Pass `websiteId` to get one website in detail instead of the list.\n\n" +
        "A website is the durable object behind repeated audits of the same domain — use its ID " +
        "with **getMonitoringSchedule** to see recurring-audit settings, or with **listSiteAudits** " +
        "as `websiteId` to page through that site's history.";

    annotations = {
        title: "List Monitored Websites",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        websiteId: z.string().optional().describe(
            "Return this one website in detail instead of the list.",
        ),
        q: z.string().optional().describe("Filter by domain substring."),
        health: z.enum(["HEALTHY", "NEEDS_ATTENTION", "CRITICAL_REGRESSIONS", "AUDIT_RUNNING", "MONITORING_PAUSED"])
            .optional().describe("Filter by health status."),
        monitoring: z.string().optional().describe(
            "Filter by monitoring state — whether a recurring schedule is configured.",
        ),
        sort: z.string().optional().describe("Server-supported sort key."),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
    });

    outputSchema = z.object({
        websites: z.array(z.any()).optional(),
        website:  z.any().optional(),
        total:    z.number().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken || !this.organizationId) {
            return toResult(formatError("List Monitored Websites", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        try {
            if (args.websiteId) {
                const detail = await getWebsite(args.websiteId, this.organizationId, this.accessToken);
                return toResult(formatWebsiteDetail(detail));
            }
            const { websiteId, ...filters } = args;
            const result = await listWebsites(this.organizationId, this.accessToken, filters);
            return toResult(formatWebsiteList(result, filters));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("List Monitored Websites", reason));
        }
    }
}

export default ListWebsitesTool;
