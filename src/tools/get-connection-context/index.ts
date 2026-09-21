import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getConnectionContext } from "@/utils/site-audit-api";
import { formatConnectionContext, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetConnectionContextTool extends BaseTool {
    private accessToken: string;

    constructor(accessToken = "") {
        super();
        this.accessToken = accessToken;
    }

    name = ToolNames.GET_CONNECTION_CONTEXT;

    description =
        "Report which OpenGraph organization this connection is working on behalf of, and which " +
        "Site Audit features its plan allows.\n\n" +
        "Call this when a result is unexpectedly empty — it distinguishes 'this organization has " +
        "no data' from 'this connection is pointed at a different organization than you meant'. " +
        "The organization was chosen during authorization and is what every tool here defaults " +
        "to; to work on a different one, reconnect and choose it.\n\n" +
        "Also use it before suggesting a feature: entitlements here say whether audits, recurring " +
        "monitoring, PDF export, and link preview are actually available on the plan.";

    annotations = {
        title: "Get Connection Context",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({});

    outputSchema = z.object({
        organizationId:   z.string().nullable(),
        organizationName: z.string().nullable(),
        entitlements:     z.record(z.boolean()),
    });

    async execute(): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Get Connection Context", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        try {
            const ctx = await getConnectionContext(this.accessToken);
            return toResult(formatConnectionContext(ctx));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Connection Context", reason));
        }
    }
}

export default GetConnectionContextTool;
