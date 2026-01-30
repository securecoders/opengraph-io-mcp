import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { createAndGenerate, getAssetFile, type GenerateParams } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class GenerateImageTool extends BaseTool {
    name = ToolNames.GENERATE_IMAGE;
    description = `Generate a professional, polished image (illustration, diagram, icon, or social-card).

DIAGRAM OPTIONS - Three ways to create diagrams:

1. **Natural language description** - AI generates diagram code for you (easiest)
2. **Pure diagram syntax in prompt** - Provide Mermaid/D2/Vega in the prompt field (AI may style it)
3. **Direct diagram code** - Use diagramCode + diagramFormat for full control (most reliable)

RECOMMENDED FOR AGENTS: Use diagramCode + diagramFormat
When you (the calling agent) want full control over the diagram syntax and to avoid AI styling issues:
{
  "diagramCode": "flowchart LR\\n  A[Request] --> B[Auth]\\n  B --> C[Process]\\n  C --> D[Response]",
  "diagramFormat": "mermaid",
  "kind": "diagram"
}

Benefits of diagramCode:
- Bypasses AI generation/styling - no risk of invalid syntax from styling
- You control the exact syntax - iterate on errors yourself
- Clear error messages if syntax is invalid
- Can omit 'prompt' entirely when using diagramCode

CORRECT USAGE EXAMPLES:

Example 1 - Using diagramCode (RECOMMENDED FOR AGENTS):
{
  "diagramCode": "flowchart LR\\n  A[Request] --> B[Auth]\\n  B --> C[Scrape]\\n  C --> D[Cache]\\n  D --> E[Response]",
  "diagramFormat": "mermaid",
  "kind": "diagram",
  "brandColors": ["#2CBD6B", "#090a3a"]
}

Example 2 - Natural language (for users who want AI to generate):
{
  "prompt": "API request flow showing: Request, Auth, Scrape, Cache, Response connected in sequence",
  "kind": "diagram",
  "brandColors": ["#2CBD6B", "#090a3a"],
  "stylePreferences": "modern tech aesthetic, dark background, subtle glow effects"
}

Example 3 - Pure Mermaid syntax in prompt (AI may style it):
{
  "prompt": "flowchart LR\\n  A[Request] --> B[Auth]\\n  B --> C[Scrape]\\n  C --> D[Cache]\\n  D --> E[Response]",
  "kind": "diagram",
  "brandColors": ["#2CBD6B", "#090a3a"]
}

WRONG - DO NOT DO THIS (mixing syntax with description in prompt):
{
  "prompt": "graph LR A[Request] --> B[Auth] Create a premium beautiful diagram with glow effects"
}
^ This WILL FAIL because Mermaid cannot parse the descriptive text after the syntax.

WHERE TO PUT STYLING INFORMATION:
- Visual style preferences → "stylePreferences" parameter
- Colors → "brandColors" parameter  
- Project context → "projectContext" parameter
- NOT in the "prompt" field when using diagram syntax

HANDLING DIAGRAM GENERATION ISSUES:
When using 'premium' output style for diagrams, the GPT-Image polish step may occasionally produce artifacts like:
- Clipped edges (elements cut off at image boundaries)
- Duplicate elements (boxes or labels appearing twice)
- Misaligned or reorganized structure

If this happens:
1. ALWAYS include the original Mermaid/D2/Vega source in your regeneration prompt so the LLM knows the exact structure to preserve
2. Consider generating with 'standard' first to get an accurate render, then use that asset as referenceAssetId for a premium generation
3. When regenerating, explicitly mention what went wrong (e.g., "ensure all elements fit within frame", "no duplicate boxes")
4. For complex diagrams, 'standard' output often produces more accurate results than 'premium'

DATA VISUALIZATION WITH VEGA-LITE:
For charts and data visualizations, use Vega-Lite JSON syntax. The agent will auto-detect Vega-Lite specs or you can set diagramSyntax: "vega".
Supported chart types: bar, line, area, pie/donut, scatter, heatmap, and more.
Example: {"$schema": "https://vega.github.io/schema/vega-lite/v5.json", "data": {"values": [...]}, "mark": "bar", ...}

CROPPING OPTIONS:
There are two ways to crop images:

1. **Auto-crop (for transparent images)**: Set autoCrop: true to automatically detect and remove transparent edges.
   - Useful for icons and diagrams with large transparent margins
   - Use autoCropPadding (default: 20) to control padding around content

2. **Manual crop (precise coordinates)**: Specify exact pixel coordinates for cropping.
   - Provide cropX1, cropY1 (top-left corner) and cropX2, cropY2 (bottom-right corner)
   - Coordinates are in pixels from the top-left of the image (0,0)
   - The coding agent should analyze the image and provide exact coordinates
   - Example: To crop a 1000x800 image to show only the center 500x400 area:
     cropX1: 250, cropY1: 200, cropX2: 750, cropY2: 600

MANUAL CROP EXAMPLES:
- Crop to remove 100px from all edges of a 1200x630 image:
  cropX1: 100, cropY1: 100, cropX2: 1100, cropY2: 530
- Crop to select the left half of a 1000x500 image:
  cropX1: 0, cropY1: 0, cropX2: 500, cropY2: 500
- Crop to select a specific region (e.g., logo in top-right):
  cropX1: 800, cropY1: 50, cropX2: 1150, cropY2: 200`;

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
        diagramCode: z.string().optional()
            .describe(
                "Pre-validated diagram syntax (Mermaid/D2/Vega-Lite JSON). " +
                "When provided, bypasses AI generation/styling and renders directly. " +
                "Caller is responsible for valid syntax. Must be used with diagramFormat."
            ),
        diagramFormat: z.enum(["mermaid", "d2", "vega"]).optional()
            .describe(
                "Format of the diagramCode. Required when diagramCode is provided. " +
                "Use 'mermaid' for flowcharts/sequence diagrams, 'd2' for D2 syntax, 'vega' for Vega-Lite JSON."
            ),
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
                diagramCode: args.diagramCode,
                diagramFormat: args.diagramFormat,
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
