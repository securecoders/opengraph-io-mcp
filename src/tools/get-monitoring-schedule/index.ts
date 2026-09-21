import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getSchedule } from "@/utils/site-audit-api";
import { formatSchedule, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetMonitoringScheduleTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.GET_MONITORING_SCHEDULE;

    description =
        "Read a website's recurring-audit schedule: how often it runs, the anchored day and time, " +
        "whether it is paused, when the next run is due, and whether newly discovered pages are " +
        "included.\n\n" +
        "Returns no schedule when the website is not monitored. Website IDs come from **listWebsites**.";

    annotations = {
        title: "Get Monitoring Schedule",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        websiteId: z.string().describe("Website ID from listWebsites."),
    });

    outputSchema = z.object({
        websiteId: z.string(),
        schedule:  z.any().nullable(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken || !this.organizationId) {
            return toResult(formatError("Get Monitoring Schedule", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        try {
            const result = await getSchedule(args.websiteId, this.organizationId, this.accessToken);
            return toResult(formatSchedule(args.websiteId, result));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Monitoring Schedule", reason));
        }
    }
}

export default GetMonitoringScheduleTool;
