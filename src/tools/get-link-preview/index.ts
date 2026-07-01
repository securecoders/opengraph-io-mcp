import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { previewPage } from "@/utils/site-audit-api";
import { formatLinkPreview, formatError, toResult } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GetLinkPreviewTool extends BaseTool {
    private accessToken: string;
    private organizationId: string;

    constructor(accessToken = "", organizationId = "") {
        super();
        this.accessToken    = accessToken;
        this.organizationId = organizationId;
    }

    name = ToolNames.GET_LINK_PREVIEW;

    description =
        "Check how a URL will appear when shared on Facebook, Twitter/X, LinkedIn, and Google. " +
        "Returns platform-specific preview cards showing the title, description, and image each " +
        "platform will render, plus a quality score (0–100) and a list of issues to fix.\n\n" +
        "Use this tool when the user asks:\n" +
        "  - 'check the link preview for example.com'\n" +
        "  - 'how does this page look when shared on social media?'\n" +
        "  - 'check my og tags'\n" +
        "  - 'what will this look like on Twitter / Facebook / LinkedIn?'\n\n" +
        "This is synchronous — results are returned immediately. Does not count against your " +
        "monthly audit quota. Requires OAuth authentication.\n\n" +
        "For a full multi-page audit with per-page scoring and an AI report, use **startSiteAudit** instead.";

    annotations = {
        title:           "Get Link Preview",
        readOnlyHint:    true,
        destructiveHint: false,
        idempotentHint:  true,
        openWorldHint:   true,
    };

    inputSchema = z.object({
        url: z.string().url().describe(
            "The full URL to preview (e.g. https://example.com/pricing).",
        ),
    });

    outputSchema = z.object({
        url:        z.string(),
        score:      z.number().describe("Quality score 0–100"),
        scoreLabel: z.string().describe("Score tier: Well Optimized / Good / Room for Improvement / Needs Attention / Poor"),
        platforms: z.object({
            facebook: z.object({
                title:       z.string().nullable().optional(),
                description: z.string().nullable().optional(),
                imageUrl:    z.string().nullable().optional(),
                imageStatus: z.string().nullable().optional(),
                domain:      z.string().nullable().optional(),
            }).optional(),
            twitter: z.object({
                cardType:    z.string().nullable().optional(),
                title:       z.string().nullable().optional(),
                description: z.string().nullable().optional(),
                imageUrl:    z.string().nullable().optional(),
                imageStatus: z.string().nullable().optional(),
                domain:      z.string().nullable().optional(),
            }).optional(),
            linkedin: z.object({
                title:       z.string().nullable().optional(),
                description: z.string().nullable().optional(),
                imageUrl:    z.string().nullable().optional(),
                imageStatus: z.string().nullable().optional(),
                domain:      z.string().nullable().optional(),
            }).optional(),
            google: z.object({
                title:             z.string().nullable().optional(),
                metaDescription:   z.string().nullable().optional(),
                url:               z.string().nullable().optional(),
                hasStructuredData: z.boolean().optional(),
            }).optional(),
        }).describe("What each platform will display when this URL is shared"),
        issues: z.array(z.object({
            severity: z.string(),
            message:  z.string().optional(),
            title:    z.string().optional(),
            code:     z.string().optional(),
        })).optional().describe("Issues found — fix these to improve scores and previews"),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        if (!this.accessToken) {
            return toResult(formatError("Get Link Preview", "Link Preview requires OAuth authentication. Reconnect the OpenGraph MCP server to authorize."));
        }
        if (!this.organizationId) {
            return toResult(formatError("Get Link Preview", "Organization ID not found in token. Reconnect the MCP server."));
        }
        try {
            const result = await previewPage(this.organizationId, args.url, this.accessToken);
            return toResult(formatLinkPreview(result));
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Get Link Preview", reason));
        }
    }
}

export default GetLinkPreviewTool;
