import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getSessionAsset, inlineImage, SVG_NOT_INLINE } from "@/utils/og-image-api";
import { exportBaseDir, resolveExportPath, writeExport } from "@/utils/exportPath";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class ExportImageAssetTool extends BaseTool {
    private appId: string;
    private isLocal: boolean;

    constructor(appId = '', isLocal = false) {
        super();
        this.appId = appId;
        this.isLocal = isLocal;
    }

    name = ToolNames.EXPORT_IMAGE_ASSET;
    annotations = {
        title: "Export Image Asset",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
    };
    description = `Export a generated image asset by session and asset ID.

Returns the image inline as base64 along with metadata (format, dimensions, size).

When running locally (stdio transport), you can optionally provide a destinationPath to save the image to disk.
Files are only ever written inside one export folder (~/Downloads/opengraph-mcp, or MCP_EXPORT_DIR);
pass a file name or a path inside it. SVG is returned as a file only, never inline, because it can carry script.

USAGE:
After generating an image with generateImage, use the sessionId and assetId to export:
  exportImageAsset(sessionId="...", assetId="...")

To save to disk (local/stdio only):
  exportImageAsset(sessionId="...", assetId="...", destinationPath="logo.png")`;

    inputSchema = z.object({
        sessionId: z.string().uuid().describe("The session UUID containing the asset"),
        assetId: z.string().uuid().describe("The asset UUID to export"),
        destinationPath: z.string().max(1024).optional().describe(
            "Optional file name or path inside the export folder (~/Downloads/opengraph-mcp, or MCP_EXPORT_DIR). " +
            "Only works when the server is running locally (stdio transport)."
        ),
    });

    outputSchema = z.object({
        success: z.boolean(),
        size: z.number().optional(),
        format: z.string().optional(),
        path: z.string().optional(),
        error: z.string().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            let asset: Awaited<ReturnType<typeof getSessionAsset>>;
            try {
                asset = await getSessionAsset(args.sessionId, args.assetId, this.appId);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: JSON.stringify({ success: false, error: message }) }],
                };
            }
            const { data, format } = asset;
            const isSvg = format === "SVG";

            let savedPath: string | undefined;
            let saveError: string | undefined;
            if (args.destinationPath && this.isLocal) {
                const resolved = await resolveExportPath(args.destinationPath, format);
                if (resolved.ok) {
                    try {
                        await writeExport(resolved.path, data);
                        savedPath = resolved.path;
                    } catch (error: unknown) {
                        saveError = error instanceof Error ? error.message : String(error);
                    }
                } else {
                    saveError = resolved.error;
                }
            }

            const content: CallToolResult["content"] = [];
            const inline = inlineImage(asset);
            if (inline) content.push(inline);
            content.push({
                type: "text",
                text: JSON.stringify({
                    success: !saveError,
                    assetId: args.assetId,
                    sessionId: args.sessionId,
                    size: data.length,
                    format,
                    ...(savedPath ? { path: savedPath, message: `Saved to ${savedPath}` } : {}),
                    ...(saveError ? { error: saveError } : {}),
                    // The folder path names the server's home directory, so only local callers see it.
                    ...(isSvg && !savedPath
                        ? { note: this.isLocal ? `${SVG_NOT_INLINE} Export folder: ${exportBaseDir()}.` : SVG_NOT_INLINE }
                        : {}),
                }),
            });
            return { content };
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
