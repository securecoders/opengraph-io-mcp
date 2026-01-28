import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { createAndGenerate, getAssetFile, type GenerateParams } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GenerateImageTool extends BaseTool {
    name = ToolNames.GENERATE_IMAGE;
    description = `Generate a professional, polished image (illustration, diagram, icon, or social-card).

For diagrams, the 'prompt' field should contain EITHER:
1. Natural language description - We will generate diagram code for you
2. Pure diagram syntax (Mermaid/D2/Vega) - We will render it directly

NEVER mix diagram syntax with descriptive text in the prompt!

Put styling information in the appropriate parameters:
- Visual style preferences → "stylePreferences" parameter
- Colors → "brandColors" parameter
- Project context → "projectContext" parameter`;

    inputSchema = z.object({
        prompt: z.string().describe(
            "For diagrams: Either natural language description OR pure Mermaid/D2/Vega syntax. " +
            "For illustrations: Describe the image content, style, and composition."
        ),
        kind: z.enum(["illustration", "diagram", "icon", "social-card", "qr-code"])
            .default("illustration")
            .describe("The type of image to create"),
        
        // Preset parameters
        aspectRatio: z.enum([
            "og-image", "twitter-card", "twitter-post", "linkedin-post", "facebook-post",
            "instagram-square", "instagram-portrait", "instagram-story",
            "youtube-thumbnail", "wide", "square", "portrait",
            "icon-small", "icon-medium", "icon-large"
        ]).optional().describe("Preset aspect ratio (e.g., 'og-image' for 1200x630)"),
        stylePreset: z.enum([
            "github-dark", "github-light", "notion", "vercel", "linear", "stripe",
            "neon-cyber", "pastel", "minimal-mono", "corporate", "startup",
            "documentation", "technical"
        ]).optional().describe("Preset style with brand colors"),
        diagramTemplate: z.enum([
            "auth-flow", "oauth2-flow", "crud-api", "microservices", "ci-cd", "gitflow",
            "database-schema", "state-machine", "user-journey", "cloud-architecture", "system-context"
        ]).optional().describe("Pre-built diagram template"),
        
        // AI context
        projectContext: z.string().optional().describe("Description of the project this image is for"),
        brandColors: z.array(z.string()).optional().describe("Brand colors as hex codes (e.g., ['#0033A0', '#FF8C00'])"),
        stylePreferences: z.string().optional().describe("Style preferences: 'modern', 'minimalist', 'corporate', etc."),
        referenceAssetId: z.string().uuid().optional().describe("Asset UUID to use as style reference"),
        
        // Diagram-specific
        diagramSyntax: z.enum(["mermaid", "d2", "vega"]).optional().describe("Preferred diagram syntax"),
        template: z.string().optional().describe("Template name for template-based graphics"),
        labels: z.array(z.string()).optional().describe("Labels for templates/diagrams"),
        
        // Generation settings
        model: z.string().optional().describe("Model: 'gpt-image-1.5', 'gemini-flash', 'gemini-pro'"),
        quality: z.enum(["low", "medium", "high", "fast"]).optional().describe("Quality setting"),
        transparent: z.boolean().optional().describe("Request transparent background"),
        
        // Cropping
        autoCrop: z.boolean().optional().describe("Auto-crop transparent edges"),
        autoCropPadding: z.number().optional().describe("Padding for auto-crop (default: 20)"),
        cropX1: z.number().int().min(0).optional().describe("Manual crop: top-left X"),
        cropY1: z.number().int().min(0).optional().describe("Manual crop: top-left Y"),
        cropX2: z.number().int().min(0).optional().describe("Manual crop: bottom-right X"),
        cropY2: z.number().int().min(0).optional().describe("Manual crop: bottom-right Y"),
        cornerRadius: z.number().optional().describe("Corner radius for rounded corners"),
        
        // Output style
        outputStyle: z.enum(["draft", "standard", "premium"]).optional()
            .describe("Polish level: 'draft' (fast), 'standard' (AI-enhanced), 'premium' (full AI polish)"),
        layoutPreservation: z.enum(["strict", "flexible", "creative"]).optional()
            .describe("How strictly to preserve layout during premium polish"),
    });

    outputSchema = z.object({
        sessionId: z.string(),
        assetId: z.string(),
        status: z.string(),
        url: z.string().optional(),
        format: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            // Build params from args
            const params: GenerateParams = {
                prompt: args.prompt,
                kind: args.kind,
                aspectRatio: args.aspectRatio,
                stylePreset: args.stylePreset,
                diagramTemplate: args.diagramTemplate,
                projectContext: args.projectContext,
                brandColors: args.brandColors,
                stylePreferences: args.stylePreferences,
                referenceAssetId: args.referenceAssetId,
                diagramSyntax: args.diagramSyntax,
                template: args.template,
                labels: args.labels,
                model: args.model,
                quality: args.quality,
                transparent: args.transparent,
                autoCrop: args.autoCrop,
                autoCropPadding: args.autoCropPadding,
                cropX1: args.cropX1,
                cropY1: args.cropY1,
                cropX2: args.cropX2,
                cropY2: args.cropY2,
                cornerRadius: args.cornerRadius,
                outputStyle: args.outputStyle,
                layoutPreservation: args.layoutPreservation,
            };

            // Create session and generate
            const { session, result } = await createAndGenerate(params);

            // If succeeded, fetch the image and return it
            if (result.status === "succeeded" && result.assetId) {
                try {
                    const { data, contentType } = await getAssetFile(result.assetId);
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
                                    sessionId: session.sessionId,
                                    assetId: result.assetId,
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
                    // Return metadata even if image fetch fails
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    sessionId: session.sessionId,
                                    assetId: result.assetId,
                                    status: result.status,
                                    format: result.format,
                                    width: result.width,
                                    height: result.height,
                                    url: result.url,
                                    warning: "Image generated but could not be fetched inline",
                                }),
                            },
                        ],
                    };
                }
            }

            // Return result for non-success or pending
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            sessionId: session.sessionId,
                            assetId: result.assetId,
                            status: result.status,
                            error: result.error,
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
                        text: JSON.stringify({ error: `Error generating image: ${errorMessage}` }),
                    },
                ],
            };
        }
    }
}

export default GenerateImageTool;
