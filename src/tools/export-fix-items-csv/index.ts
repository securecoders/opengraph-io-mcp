import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { exportFixItemsCsv } from "@/utils/site-audit-api";
import { formatFixItemsCsv, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class ExportFixItemsCsvTool extends BaseTool {
    private accessToken: string;
    constructor(accessToken = "") { super(); this.accessToken = accessToken; }

    name = ToolNames.EXPORT_FIX_ITEMS_CSV;
    description =
        "Export an audit's fix list as CSV — the developer-handoff format, with one row per " +
        "proposed change.\n\n" +
        "Returns the CSV as text you can read, transform, or write to a file. PDF export is " +
        "dashboard-only.";

    annotations = {
        title: "Export Fix List as CSV",
        readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true,
    };

    inputSchema = z.object({ auditId: z.string().describe("Audit ID.") });
    outputSchema = z.object({ auditId: z.string(), csv: z.string() });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) return toResult(formatError("Export Fix List as CSV", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        try {
            const csv = await exportFixItemsCsv(args.auditId, this.accessToken);
            return toResult(formatFixItemsCsv(args.auditId, csv ?? ""));
        } catch (error: unknown) {
            return toResult(formatError("Export Fix List as CSV", error instanceof Error ? error.message : String(error)));
        }
    }
}
export default ExportFixItemsCsvTool;
