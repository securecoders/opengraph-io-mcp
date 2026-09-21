import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { putSchedule, deleteSchedule } from "@/utils/site-audit-api";
import { formatScheduleSaved, formatScheduleRemoved, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class SetMonitoringScheduleTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.SET_MONITORING_SCHEDULE;

    description =
        "Turn recurring audits on, change their settings, or turn them off for a website.\n\n" +
        "THIS COMMITS ONGOING SPEND. Each scheduled run consumes the organization's page quota " +
        "indefinitely until the schedule is changed or removed, and completed runs can trigger " +
        "alert email. Confirm with the user before enabling or changing a schedule.\n\n" +
        "Set `enabled: false` to stop monitoring. That DELETES the schedule configuration — " +
        "frequency, timing and options are not retained, and re-enabling means setting them again. " +
        "To pause temporarily and keep the configuration, use `paused: true` instead.\n\n" +
        "Settings you do not pass are carried over from the stored schedule, so you can change one " +
        "field without re-sending the rest. Alert recipients cannot be set here; they are managed " +
        "in the dashboard. Requires the " +
        "Site Audit scheduling entitlement — the call fails with a plan message without it.";

    annotations = {
        title: "Set Monitoring Schedule",
        readOnlyHint: false,
        // Disabling removes the configuration outright, and enabling commits
        // recurring quota spend — both warrant a client confirmation prompt.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
    };

    inputSchema = z.object({
        websiteId: z.string().describe("Website ID from listWebsites."),
        enabled: z.boolean().optional().describe(
            "false removes the schedule and stops recurring audits. Defaults to true.",
        ),
        frequency: z.enum(["WEEKLY", "MONTHLY"]).optional().describe(
            "How often the audit runs. Required when enabling.",
        ),
        dayOfWeek: z.number().int().min(0).max(6).optional().describe(
            "Day for a weekly schedule — 0 is Sunday.",
        ),
        dayOfMonth: z.number().int().min(1).max(28).optional().describe(
            "Day for a monthly schedule (1–28, so the day exists in every month).",
        ),
        runHour: z.number().int().min(0).max(23).optional().describe(
            "Hour of day to run (0–23). Anchoring needs runHour and timezone together.",
        ),
        runMinute: z.number().int().min(0).max(59).optional().describe("Minute of the hour."),
        timezone: z.string().optional().describe(
            "IANA zone, e.g. 'America/New_York'. Runs stay at the same wall-clock time across DST.",
        ),
        paused: z.boolean().optional().describe(
            "Pause without deleting — the configuration is kept and can be resumed.",
        ),
        includeNewPages: z.boolean().optional().describe(
            "Audit pages discovered after the schedule was created. Increases quota use over time.",
        ),
        autoAdvanceBaseline: z.boolean().optional().describe(
            "Move the comparison baseline forward after each run, so changes are measured against " +
            "the previous run rather than a fixed point.",
        ),
        pageScopeMode: z.enum(["ALL_KNOWN", "LATEST_AUDIT", "SPECIFIC_URLS"]).optional().describe(
            "Which pages each run covers.",
        ),
        notificationMode: z.enum(["IMMEDIATE_ONLY", "SUMMARY_AFTER_RUN", "BOTH"]).optional().describe(
            "When alert email is sent for this schedule.",
        ),
    });

    outputSchema = z.object({
        websiteId: z.string(),
        schedule:  z.any().nullable(),
        enabled:   z.boolean(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken || !this.organizationId) {
            return toResult(formatError("Set Monitoring Schedule", "Site Audit requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        const { websiteId, enabled, ...schedule } = args;
        try {
            if (enabled === false) {
                // Refuse a request that both deletes and configures — the other
                // fields would be silently dropped, and `paused` in particular
                // means the caller wanted the configuration kept.
                const alsoSet = Object.keys(schedule).filter((k) => schedule[k as keyof typeof schedule] !== undefined);
                if (alsoSet.length) {
                    return toResult(formatError("Set Monitoring Schedule",
                        `enabled: false removes the schedule, so ${alsoSet.join(", ")} would be discarded. Omit them, or use paused: true to keep the configuration.`));
                }
                await deleteSchedule(websiteId, this.organizationId, this.accessToken);
                return toResult(formatScheduleRemoved(websiteId));
            }
            if (!schedule.frequency) {
                return toResult(formatError(
                    "Set Monitoring Schedule",
                    "frequency is required when enabling a schedule (WEEKLY or MONTHLY).",
                ));
            }
            const result = await putSchedule(websiteId, this.organizationId, this.accessToken, schedule);
            return toResult(formatScheduleSaved(websiteId, result));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Set Monitoring Schedule", reason));
        }
    }
}

export default SetMonitoringScheduleTool;
