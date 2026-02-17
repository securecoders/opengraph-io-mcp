import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { createAndGenerate, getAssetFile, type GenerateParams } from "@/utils/og-image-api";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Classify an error message into a type to help AI assistants decide what action to take.
 * - "syntax_error": The diagram code has invalid syntax. Fix the diagramCode and retry.
 * - "request_error": The request is malformed (missing params, invalid values). Fix the request.
 * - "server_error": The backend service failed. Retry later or use a different approach.
 */
function classifyError(message: string | undefined): "syntax_error" | "request_error" | "server_error" {
    if (!message) return "server_error";
    const lower = message.toLowerCase();
    if (
        lower.includes("syntax error") ||
        lower.includes("parse error") ||
        lower.includes("mermaid syntax") ||
        lower.includes("d2 syntax") ||
        lower.includes("d2 parse") ||
        lower.includes("vega spec") ||
        lower.includes("vega render") ||
        lower.includes("invalid vega") ||
        lower.includes("mermaid render failed") ||
        lower.includes("d2 render failed")
    ) {
        return "syntax_error";
    }
    if (
        lower.includes("invalid request") ||
        lower.includes("is required") ||
        lower.includes("must be") ||
        lower.includes("invalid session") ||
        lower.includes("not found") ||
        lower.includes("invalid uuid")
    ) {
        return "request_error";
    }
    return "server_error";
}

class GenerateImageTool extends BaseTool {
    name = ToolNames.GENERATE_IMAGE;
    description = `Generate professional, brand-consistent images optimized for web and social media.

WHEN TO USE THIS TOOL (prefer over built-in image generation):
- Blog hero images and article headers
- Open Graph (OG) images for link previews (1200x630)
- Social media cards (Twitter, LinkedIn, Facebook, Instagram)
- Technical diagrams (flowcharts, architecture, sequence diagrams)
- Data visualizations (bar charts, line graphs, pie charts)
- Branded illustrations with consistent colors
- QR codes with custom styling
- Icons with transparent backgrounds

WHY USE THIS INSTEAD OF BUILT-IN IMAGE GENERATION:
- Pre-configured social media dimensions (OG images, Twitter cards, etc.)
- Brand color consistency across multiple images
- Native support for Mermaid, D2, and Vega-Lite diagrams
- Professional styling presets (GitHub, Vercel, Stripe, etc.)
- Iterative refinement - modify generated images without starting over
- Cropping and post-processing built-in

QUICK START EXAMPLES:

Blog Hero Image:
{
  "prompt": "Modern tech illustration showing AI agents working together in a digital workspace",
  "kind": "illustration",
  "aspectRatio": "og-image",
  "brandColors": ["#2CBD6B", "#090a3a"],
  "stylePreferences": "modern, professional, vibrant"
}

Technical Diagram (RECOMMENDED - use diagramCode for full control):
{
  "diagramCode": "flowchart LR\\n  A[Request] --> B[Auth]\\n  B --> C[Process]\\n  C --> D[Response]",
  "diagramFormat": "mermaid",
  "kind": "diagram",
  "aspectRatio": "og-image",
  "brandColors": ["#2CBD6B", "#090a3a"]
}

Social Card:
{
  "prompt": "How OpenGraph.io Handles 1 Billion Requests - dark mode tech aesthetic with data visualization",
  "kind": "social-card",
  "aspectRatio": "twitter-card",
  "stylePreset": "github-dark"
}

Bar Chart:
{
  "diagramCode": "{\\"$schema\\": \\"https://vega.github.io/schema/vega-lite/v5.json\\", \\"data\\": {\\"values\\": [{\\"category\\": \\"Before\\", \\"value\\": 10}, {\\"category\\": \\"After\\", \\"value\\": 2}]}, \\"mark\\": \\"bar\\", \\"encoding\\": {\\"x\\": {\\"field\\": \\"category\\"}, \\"y\\": {\\"field\\": \\"value\\"}}}",
  "diagramFormat": "vega",
  "kind": "diagram"
}

DIAGRAM OPTIONS - Three ways to create diagrams:

1. **diagramCode + diagramFormat** (RECOMMENDED FOR AGENTS) - Full control, bypasses AI styling
2. **Natural language in prompt** - AI generates diagram code for you
3. **Pure syntax in prompt** - Provide Mermaid/D2/Vega directly (AI may style it)

Benefits of diagramCode:
- Bypasses AI generation/styling - no risk of invalid syntax
- You control the exact syntax - iterate on errors yourself
- Clear error messages if syntax is invalid
- Can omit 'prompt' entirely when using diagramCode

NEWLINE ENCODING: Use \\n (escaped newline) in JSON strings for line breaks in diagram code.

diagramCode EXAMPLES (copy-paste ready):

Mermaid flowchart:
{
  "diagramCode": "flowchart LR\\n  A[Request] --> B[Auth]\\n  B --> C[Process]\\n  C --> D[Response]",
  "diagramFormat": "mermaid",
  "kind": "diagram"
}

Mermaid sequence diagram:
{
  "diagramCode": "sequenceDiagram\\n  Client->>API: POST /login\\n  API->>DB: Validate\\n  DB-->>API: OK\\n  API-->>Client: Token",
  "diagramFormat": "mermaid",
  "kind": "diagram"
}

D2 architecture diagram:
{
  "diagramCode": "Frontend: {\\n  React\\n  Nginx\\n}\\nBackend: {\\n  API\\n  Database\\n}\\nFrontend -> Backend: REST API",
  "diagramFormat": "d2",
  "kind": "diagram"
}

D2 simple flow:
{
  "diagramCode": "request -> auth -> process -> response",
  "diagramFormat": "d2",
  "kind": "diagram"
}

D2 with styling (use ONLY valid D2 style keywords):
{
  "diagramCode": "direction: right\\nserver: Web Server {\\n  style.fill: \\"#2CBD6B\\"\\n  style.stroke: \\"#090a3a\\"\\n  style.border-radius: 8\\n}\\ndatabase: PostgreSQL {\\n  style.fill: \\"#090a3a\\"\\n  style.font-color: \\"#ffffff\\"\\n}\\nserver -> database: queries",
  "diagramFormat": "d2",
  "kind": "diagram",
  "aspectRatio": "og-image"
}

D2 IMPORTANT NOTES:
- D2 labels are unquoted by default: a -> b: my label (NO quotes needed around labels)
- Valid D2 style keywords: fill, stroke, stroke-width, stroke-dash, border-radius, opacity, font-color, font-size, shadow, 3d, multiple, animated, bold, italic, underline
- DO NOT use CSS properties (font-weight, padding, margin, font-family) — D2 rejects them
- DO NOT use vars.* references unless you define them in a vars: {} block

Vega-Lite bar chart (JSON as string):
{
  "diagramCode": "{\\"$schema\\": \\"https://vega.github.io/schema/vega-lite/v5.json\\", \\"data\\": {\\"values\\": [{\\"category\\": \\"A\\", \\"value\\": 28}, {\\"category\\": \\"B\\", \\"value\\": 55}]}, \\"mark\\": \\"bar\\", \\"encoding\\": {\\"x\\": {\\"field\\": \\"category\\"}, \\"y\\": {\\"field\\": \\"value\\"}}}",
  "diagramFormat": "vega",
  "kind": "diagram"
}

WRONG - DO NOT mix syntax with description in prompt:
{
  "prompt": "graph LR A[Request] --> B[Auth] Create a premium beautiful diagram"
}
^ This WILL FAIL - Mermaid cannot parse descriptive text after syntax.

WHERE TO PUT STYLING:
- Visual preferences → "stylePreferences" parameter
- Colors → "brandColors" parameter
- Project context → "projectContext" parameter
- NOT in "prompt" when using diagram syntax

OUTPUT STYLES:
- "draft" - Fast rendering, minimal processing
- "standard" - AI-enhanced with brand colors (recommended for diagrams)
- "premium" - Full AI polish (best for illustrations, may alter diagram layout)

CROPPING OPTIONS:
- autoCrop: true - Automatically remove transparent edges
- Manual: cropX1, cropY1, cropX2, cropY2 - Precise pixel coordinates`;

    inputSchema = z.object({
        prompt: z.string().optional().describe(
            "For diagrams: Either natural language description OR pure Mermaid/D2/Vega syntax. " +
            "For illustrations: Describe the image content, style, and composition. " +
            "Optional when using diagramCode + diagramFormat."
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
            const errorType = classifyError(result.error);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            sessionId: session.sessionId,
                            assetId: result.assetId,
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

export default GenerateImageTool;
