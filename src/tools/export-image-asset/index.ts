import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getAssetFile, getSession } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class ExportImageAssetTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.EXPORT_IMAGE_ASSET;
    description = `Export a generated image asset by session and asset ID.

Returns the image inline as base64 along with metadata (format, dimensions, size).

USAGE:
After generating an image with generateImage, use the sessionId and assetId to export:
  exportImageAsset(sessionId="...", assetId="...")`;

    inputSchema = z.object({
        sessionId: z.string().uuid().describe("The session UUID containing the asset"),
        assetId: z.string().uuid().describe("The asset UUID to export"),
    });

    outputSchema = z.object({
        success: z.boolean(),
        size: z.number().optional(),
        format: z.string().optional(),
        error: z.string().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            try {
                await getSession(args.sessionId, this.appId);
            } catch {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: `Session ${args.sessionId} not found`,
                            }),
                        },
                    ],
                };
            }

            const { data, contentType } = await getAssetFile(args.assetId, this.appId);
            const base64Image = data.toString("base64");

            const formatMatch = contentType.match(/image\/(\w+)/);
            const format = formatMatch ? formatMatch[1].toUpperCase() : "UNKNOWN";

            return {
                content: [
                    {
                        type: "image",
                        data: base64Image,
                        mimeType: contentType,
                    },
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            assetId: args.assetId,
                            sessionId: args.sessionId,
                            size: data.length,
                            format,
                        }),
                    },
                ],
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: `Error exporting asset: ${errorMessage}`,
                        }),
                    },
                ],
            };
        }
    }
}

export default ExportImageAssetTool;
