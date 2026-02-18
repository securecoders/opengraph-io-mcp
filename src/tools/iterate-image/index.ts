import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { iterateImage, getAssetFile, getSession, type IterateParams } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Classify an error message into a type to help AI assistants decide what action to take.
 */
function classifyError(message: string | undefined): "syntax_error" | "request_error" | "server_error" {
    if (!message) return "server_error";
    const lower = message.toLowerCase();
    if (
        lower.includes("syntax error") || lower.includes("parse error") ||
        lower.includes("mermaid syntax") || lower.includes("d2 syntax") ||
        lower.includes("vega spec") || lower.includes("vega render") ||
        lower.includes("render failed")
    ) return "syntax_error";
    if (
        lower.includes("invalid request") || lower.includes("is required") ||
        lower.includes("must be") || lower.includes("not found") ||
        lower.includes("invalid uuid")
    ) return "request_error";
    return "server_error";
}

class IterateImageTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.ITERATE_IMAGE;
    description = `Refine, modify, or create variations of an existing generated image.

Use this to:
- Edit specific parts of an image ("change the background to blue", "add a title")
- Apply style changes ("make it more minimalist", "use darker colors")
- Fix issues ("remove the text", "make the icon larger")
- Crop the image to specific coordinates

For diagram iterations:
1. Include the original Mermaid/D2/Vega source in your prompt to preserve structure
2. Be explicit about visual issues (e.g., "the left edge is clipped")`;

    inputSchema = z.object({
        sessionId: z.string().uuid().describe("The session UUID containing the image to iterate on"),
        assetId: z.string().uuid().describe("The asset UUID of the image to iterate on"),
        prompt: z.string().describe(
            "Detailed instruction for the iteration. Be specific about what to change. " +
            "Examples: 'Change the primary color to #0033A0', 'Add a subtle drop shadow'"
        ),
        // Cropping parameters
        cropX1: z.number().int().min(0).optional().describe("Crop: X coordinate of the top-left corner in pixels"),
        cropY1: z.number().int().min(0).optional().describe("Crop: Y coordinate of the top-left corner in pixels"),
        cropX2: z.number().int().min(0).optional().describe("Crop: X coordinate of the bottom-right corner in pixels"),
        cropY2: z.number().int().min(0).optional().describe("Crop: Y coordinate of the bottom-right corner in pixels"),
    });

    outputSchema = z.object({
        sessionId: z.string(),
        assetId: z.string(),
        parentAssetId: z.string(),
        status: z.string(),
        url: z.string().optional(),
        format: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            // First verify the session exists
            try {
                await getSession(args.sessionId, this.appId);
            } catch {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({ error: `Session ${args.sessionId} not found` }),
                        },
                    ],
                };
            }

            // Build params
            const params: IterateParams = {
                assetId: args.assetId,
                prompt: args.prompt,
                cropX1: args.cropX1,
                cropY1: args.cropY1,
                cropX2: args.cropX2,
                cropY2: args.cropY2,
            };

            // Call iterate API
            const result = await iterateImage(args.sessionId, params, this.appId);

            // If succeeded, fetch the image
            if (result.status === "succeeded" && result.assetId) {
                try {
                    const { data, contentType } = await getAssetFile(result.assetId, this.appId);
                    const base64Image = data.toString("base64");

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
                                    sessionId: result.sessionId,
                                    assetId: result.assetId,
                                    parentAssetId: result.parentAssetId,
                                    status: result.status,
                                    format: result.format,
                                    width: result.width,
                                    height: result.height,
                                    url: result.url,
                                }),
                            },
                        ],
                    };
                } catch (fetchError) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    sessionId: result.sessionId,
                                    assetId: result.assetId,
                                    parentAssetId: result.parentAssetId,
                                    status: result.status,
                                    format: result.format,
                                    width: result.width,
                                    height: result.height,
                                    url: result.url,
                                    warning: "Image iterated but could not be fetched inline",
                                }),
                            },
                        ],
                    };
                }
            }

            // Return result for non-success
            const errorType = classifyError(result.error);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            sessionId: result.sessionId,
                            assetId: result.assetId,
                            parentAssetId: result.parentAssetId,
                            status: result.status,
                            error: result.error,
                            errorType,
                        }),
                    },
                ],
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorType = classifyError(errorMessage);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ error: errorMessage, errorType }),
                    },
                ],
            };
        }
    }
}

export default IterateImageTool;
