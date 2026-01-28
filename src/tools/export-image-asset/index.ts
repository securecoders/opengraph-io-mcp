import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getAssetFile, getSession } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Validates and sanitizes a destination path for security.
 */
function validateDestinationPath(destinationPath: string): { valid: boolean; error?: string; normalizedPath?: string } {
    // Must be absolute path
    if (!path.isAbsolute(destinationPath)) {
        return { valid: false, error: "Destination path must be an absolute path" };
    }

    // Normalize the path
    const normalizedPath = path.normalize(destinationPath);

    // Check for null bytes
    if (normalizedPath.includes('\0')) {
        return { valid: false, error: "Invalid characters in path" };
    }

    // Block system directories
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
    name = ToolNames.EXPORT_IMAGE_ASSET;
    description = `Export a generated image asset to a specific file path on the local filesystem.

Use this tool to save generated images to your project directory after reviewing them.

SECURITY:
- Destination path must be an absolute path
- Cannot write to system directories (/etc, /usr, /bin, /System, etc.)
- Parent directories will be created if they don't exist

USAGE:
After generating an image with generateImage, use the sessionId and assetId to export:
  exportImageAsset(sessionId="...", assetId="...", destinationPath="/Users/me/project/images/logo.png")`;

    inputSchema = z.object({
        sessionId: z.string().uuid().describe("The session UUID containing the asset"),
        assetId: z.string().uuid().describe("The asset UUID to export"),
        destinationPath: z.string().describe(
            "Absolute path where the image should be saved (e.g., /Users/me/project/images/output.png)"
        ),
        overwrite: z.boolean().optional().default(true).describe(
            "Whether to overwrite if a file already exists. Defaults to true."
        ),
    });

    outputSchema = z.object({
        success: z.boolean(),
        path: z.string().optional(),
        size: z.number().optional(),
        error: z.string().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            // Validate destination path
            const pathValidation = validateDestinationPath(args.destinationPath);
            if (!pathValidation.valid) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ 
                                success: false, 
                                error: `Security Error: ${pathValidation.error}` 
                            }),
                        },
                    ],
                };
            }

            const destinationPath = pathValidation.normalizedPath!;

            // Check if file exists and overwrite is disabled
            if (!args.overwrite) {
                try {
                    await fs.access(destinationPath);
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: false,
                                    error: `File already exists at ${destinationPath}. Set overwrite=true to replace it.`,
                                }),
                            },
                        ],
                    };
                } catch {
                    // File doesn't exist, which is what we want
                }
            }

            // Verify session exists
            try {
                await getSession(args.sessionId);
            } catch {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ 
                                success: false, 
                                error: `Session ${args.sessionId} not found` 
                            }),
                        },
                    ],
                };
            }

            // Fetch the asset file
            const { data, contentType } = await getAssetFile(args.assetId);

            // Create parent directories if needed
            const parentDir = path.dirname(destinationPath);
            await fs.mkdir(parentDir, { recursive: true });

            // Write the file
            await fs.writeFile(destinationPath, data);

            // Determine format from content type
            const formatMatch = contentType.match(/image\/(\w+)/);
            const format = formatMatch ? formatMatch[1].toUpperCase() : "UNKNOWN";

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            path: destinationPath,
                            size: data.length,
                            format,
                            message: `Successfully exported asset ${args.assetId} to ${destinationPath}`,
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
                            error: `Error exporting asset: ${errorMessage}` 
                        }),
                    },
                ],
            };
        }
    }
}

export default ExportImageAssetTool;
