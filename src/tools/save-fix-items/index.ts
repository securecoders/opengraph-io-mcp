import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { upsertFixItems } from "@/utils/site-audit-api";
import { formatFixItemsSaved, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class SaveFixItemsTool extends BaseTool {
    private accessToken: string;
    constructor(accessToken = "") { super(); this.accessToken = accessToken; }

    name = ToolNames.SAVE_FIX_ITEMS;
    description =
        "Record proposed metadata changes for one page of an audit — the developer handoff list.\n\n" +
        "THIS OVERWRITES existing items for the same page and field. The fix list is hand-authored " +
        "and is not reproducible by re-running the audit, so read it with **listFixItems** first and " +
        "confirm with the user before replacing entries.\n\n" +
        "An edit needs a `proposedValue` that is non-empty and different from `originalValue`; a note may leave it blank. " +
        "A blank or unchanged value is treated as a removal upstream and is rejected here — use " +
        "**deleteFixItem** to remove an entry deliberately.";

    annotations = {
        title: "Save Fix Items",
        readOnlyHint: false,
        // Overwrites hand-authored entries for the same page and field.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        auditId: z.string().describe("Audit ID."),
        pageUrl: z.string().describe("The page these items apply to, as audited."),
        items: z.array(z.object({
            field: z.string().describe("Which field to change, e.g. title, description, image."),
            proposedValue: z.string().describe("The new value. Required and must differ from originalValue for an edit; may be empty for a note."),
            originalValue: z.string().optional().describe("Current value, for the diff shown to a developer."),
            kind: z.enum(["edit", "note"]).optional().describe("'edit' proposes a value; 'note' records guidance."),
            recommendation: z.string().max(4000).optional().describe("Why this change is suggested."),
            issueCode: z.string().optional(),
            issueTitle: z.string().optional(),
            severity: z.string().optional(),
            source: z.enum(["manual", "ai", "suggested"]).optional(),
        })).min(1).describe("Items to save for this page."),
    });

    outputSchema = z.object({
        auditId: z.string(), pageUrl: z.string(), saved: z.number(), result: z.any().nullable(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) return toResult(formatError("Save Fix Items", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        // Caught here too so the agent gets the reason rather than a bare 400.
        // Notes carry guidance rather than a replacement value, so the
        // non-empty rule applies only to edits — matching the gateway.
        const blank = args.items.find((i) => i.kind !== "note" && i.proposedValue.trim() === "");
        if (blank) {
            return toResult(formatError("Save Fix Items",
                `proposedValue for "${blank.field}" is empty. An empty value removes the entry upstream — use deleteFixItem, or set kind: "note".`));
        }
        const noop = args.items.find((i) => i.kind !== "note" && i.originalValue !== undefined && i.proposedValue === i.originalValue);
        if (noop) {
            return toResult(formatError("Save Fix Items",
                `proposedValue for "${noop.field}" is identical to originalValue. Upstream treats that as a removal — use deleteFixItem to remove an entry.`));
        }
        try {
            const result = await upsertFixItems(args.auditId, this.accessToken, args.pageUrl, args.items);
            // Upstream skips items whose field is not editable, so reporting the
            // requested count would claim writes that never happened.
            const saved = Array.isArray(result?.items) ? result.items.length : args.items.length;
            const skipped = args.items.length - saved;
            return toResult(formatFixItemsSaved(args.auditId, args.pageUrl, saved, result, skipped));
        } catch (error: unknown) {
            return toResult(formatError("Save Fix Items", error instanceof Error ? error.message : String(error)));
        }
    }
}
export default SaveFixItemsTool;
