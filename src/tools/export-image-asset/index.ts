import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getAssetFile, getSession } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";

function validateDestinationPath(destinationPath: string): { valid: boolean; error?: string; normalizedPath?: string } {
    if (!path.isAbsolute(destinationPath)) {
        return { valid: false, error: "Destination path must be an absolute path" };
    }

    const normalizedPath = path.normalize(destinationPath);

    if (normalizedPath.includes('\0')) {
        return { valid: false, error: "Invalid characters in path" };
    }

    const blockedPrefixes = [
        '/etc/', '/usr/', '/bin/', '/sbin/', '/var/',
        '/System/', '/Library/',
        'C:\\Windows\\', 'C:\\Program Files\\', 'C:\\Program Files (x86)\\',
    ];

    const lowerPath = normalizedPath.toLowerCase();
    for (const blocked of blockedPrefixes) {
        if (lowerPath.startsWith(blocked.toLowerCase())) {
            return { valid: false, error: `Cannot write to system directory: ${blocked}` };
        }
    }

    return { valid: true, normalizedPath };
}

class ExportImageAssetTool extends BaseTool {
    private appId: string;
    private isLocal: boolean;

    constructor(appId = '', isLocal = false) {
        super();
        this.appId = appId;
        this.isLocal = isLocal;
    }

    name = ToolNames.EXPORT_IMAGE_ASSET;
    description = `Export a generated image asset by session and asset ID.

Returns the image inline as base64 along with metadata (format, dimensions, size).

When running locally (stdio transport), you can optionally provide a destinationPath to save the image to disk.

USAGE:
After generating an image with generateImage, use the sessionId and assetId to export:
  exportImageAsset(sessionId="...", assetId="...")

To save to disk (local/stdio only):
  exportImageAsset(sessionId="...", assetId="...", destinationPath="/Users/me/project/images/logo.png")`;

    inputSchema = z.object({
        sessionId: z.string().uuid().describe("The session UUID containing the asset"),
        assetId: z.string().uuid().describe("The asset UUID to export"),
        destinationPath: z.string().optional().describe(
            "Optional absolute path to save the image to disk. Only works when the server is running locally (stdio transport)."
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

            let savedPath: string | undefined;

            if (args.destinationPath && this.isLocal) {
                const pathValidation = validateDestinationPath(args.destinationPath);
                if (!pathValidation.valid) {
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
                                    success: false,
                                    error: `Security Error: ${pathValidation.error}`,
                                    size: data.length,
                                    format,
                                }),
                            },
                        ],
                    };
                }

                const destPath = pathValidation.normalizedPath!;
                const parentDir = path.dirname(destPath);
                await fs.mkdir(parentDir, { recursive: true });
                await fs.writeFile(destPath, data);
                savedPath = destPath;
            }

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
                            ...(savedPath ? { path: savedPath, message: `Saved to ${savedPath}` } : {}),
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
