import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { getSession } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class InspectImageSessionTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.INSPECT_IMAGE_SESSION;
    description = `Retrieve detailed information about an image generation session and all its assets.

Returns:
- Session metadata (creation time, name, status)
- List of all assets with their prompts, toolchains, and status
- Parent-child relationships showing iteration history

Use this to:
- Review what was generated in a session
- Find asset IDs for iteration
- Understand the generation history and toolchains used`;

    inputSchema = z.object({
        sessionId: z.string().uuid().describe("The session UUID to inspect"),
    });

    outputSchema = z.object({
        sessionId: z.string(),
        name: z.string().nullable(),
        status: z.string(),
        assetCount: z.number().optional(),
        assets: z.array(z.object({
            assetId: z.string(),
            prompt: z.string(),
            kind: z.string(),
            status: z.string(),
        })),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const session = await getSession(args.sessionId, this.appId);

            // Format the response
            const formattedAssets = session.assets.map((asset) => ({
                assetId: asset.assetId,
                parentAssetId: asset.parentAssetId,
                prompt: asset.prompt.length > 100 ? asset.prompt.slice(0, 100) + "..." : asset.prompt,
                kind: asset.kind,
                toolchain: asset.toolchain,
                status: asset.status,
                createdAt: asset.createdAt,
                format: asset.format,
                width: asset.width,
                height: asset.height,
                url: asset.url,
            }));

            const response = {
                sessionId: session.sessionId,
                name: session.name,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                status: session.status,
                assetCount: session.assetCount || session.assets.length,
                assets: formattedAssets,
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(response, null, 2),
                    },
                ],
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({ error: `Error inspecting session: ${errorMessage}` }),
                    },
                ],
            };
        }
    }
}

export default InspectImageSessionTool;
