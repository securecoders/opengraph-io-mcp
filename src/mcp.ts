import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolRequestSchema,
    CompleteRequestSchema,
    CreateMessageRequest,
    CreateMessageResultSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ListToolsRequestSchema,
    LoggingLevel,
    ReadResourceRequestSchema,
    SetLevelRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import tools, { ToolNames } from "@/tools";
import GetOgDataTool from "@/tools/get-og-data";
import GetOgScrapeDataTool from "@/tools/get-og-scrape-data";
import GetOgScreenshotTool from "@/tools/get-og-screenshot";
import GetOgQueryTool from "@/tools/get-og-query";
import GetOgExtractTool from "@/tools/get-og-extract";
// Image generation tools
import GenerateImageTool from "@/tools/generate-image";
import IterateImageTool from "@/tools/iterate-image";
import InspectImageSessionTool from "@/tools/inspect-image-session";
import ExportImageAssetTool from "@/tools/export-image-asset";
import { getAppId } from "@/utils/sessionIdToAppId";
import { getAssetFile } from "@/utils/og-image-api";

/* Input schemas for tools implemented in this server */

// Example completion values for prompts
const EXAMPLE_COMPLETIONS = {
    diagramType: ["flowchart", "sequence", "architecture", "er-diagram", "state", "other"],
    assetType: ["icons", "social-cards", "diagrams", "illustrations"],
    style: ["outline", "filled", "duotone", "3d"],
    count: ["2", "3", "4", "5", "6", "7", "8", "9", "10"],
};


enum PromptName {
    CREATE_BRANDED_DIAGRAM = "create-branded-diagram",
    ITERATE_AND_REFINE = "iterate-and-refine",
    CREATE_ASSET_SET = "create-asset-set",
    QUICK_ICON = "quick-icon",
}

export const createServer = () => {
    const server = new Server(
        {
            name: "og-mcp-server",
            version: "1.0.0",
        },
        {
            capabilities: {
                prompts: {},
                resources: { subscribe: true },
                tools: {},
                logging: {},
                completions: {},
            },
        }
    );

    let subscriptions: Set<string> = new Set();
    let subsUpdateInterval: NodeJS.Timeout | undefined;
    let stdErrUpdateInterval: NodeJS.Timeout | undefined;

    // Set up update interval for subscribed resources
    subsUpdateInterval = setInterval(() => {
        for (const uri of subscriptions) {
            server.notification({
                method: "notifications/resources/updated",
                params: { uri },
            });
        }
    }, 10000);

    let logLevel: LoggingLevel = "debug";
    let logsUpdateInterval: NodeJS.Timeout | undefined;
    const messages = [
        { level: "debug", data: "Debug-level message" },
        { level: "info", data: "Info-level message" },
        { level: "notice", data: "Notice-level message" },
        { level: "warning", data: "Warning-level message" },
        { level: "error", data: "Error-level message" },
        { level: "critical", data: "Critical-level message" },
        { level: "alert", data: "Alert level-message" },
        { level: "emergency", data: "Emergency-level message" },
    ];

    const isMessageIgnored = (level: LoggingLevel): boolean => {
        const currentLevel = messages.findIndex((msg) => logLevel === msg.level);
        const messageLevel = messages.findIndex((msg) => level === msg.level);
        return messageLevel < currentLevel;
    };

    // Set up update interval for random log messages
    logsUpdateInterval = setInterval(() => {
        let message = {
            method: "notifications/message",
            params: messages[Math.floor(Math.random() * messages.length)],
        };
        if (!isMessageIgnored(message.params.level as LoggingLevel))
            server.notification(message);
    }, 20000);


    // Set up update interval for stderr messages
    stdErrUpdateInterval = setInterval(() => {
        const shortTimestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        server.notification({
            method: "notifications/stderr",
            params: { content: `${shortTimestamp}: A stderr message` },
        });
    }, 30000);

    // Helper method to request sampling from client
    const requestSampling = async (
        context: string,
        uri: string,
        maxTokens: number = 100
    ) => {
        const request: CreateMessageRequest = {
            method: "sampling/createMessage",
            params: {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Resource ${uri} context: ${context}`,
                        },
                    },
                ],
                systemPrompt: "You are a helpful test server.",
                maxTokens,
                temperature: 0.7,
                includeContext: "thisServer",
            },
        };

        return await server.request(request, CreateMessageResultSchema);
    };

    // Resources are dynamically fetched from the og-image-agent API
    // No static resources - assets are accessed via the asset:// URI template

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        // Resources are accessed via URI templates, not listed statically
        // Generated assets can be accessed via asset://{sessionId}/{assetId}
        return {
            resources: [],
        };
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
        return {
            resourceTemplates: [
                {
                    uriTemplate: "asset://{sessionId}/{assetId}",
                    name: "Generated Image Asset",
                    description: "Access generated image assets by session and asset ID. Use inspectImageSession to find asset IDs.",
                },
            ],
        };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri;

        // Handle asset:// URIs
        if (uri.startsWith("asset://")) {
            const parts = uri.replace("asset://", "").split("/");
            if (parts.length !== 2) {
                throw new Error(`Invalid asset URI format. Expected: asset://{sessionId}/{assetId}`);
            }
            const [sessionId, assetId] = parts;
            
            // Validate UUID format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(sessionId) || !uuidRegex.test(assetId)) {
                throw new Error("Invalid session ID or asset ID format - must be valid UUIDs");
            }

            try {
                const { data, contentType } = await getAssetFile(assetId);
                return {
                    contents: [
                        {
                            uri,
                            mimeType: contentType,
                            blob: data.toString("base64"),
                        },
                    ],
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to fetch asset: ${message}`);
            }
        }

        throw new Error(`Unknown resource URI scheme: ${uri}`);
    });

    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
        const { uri } = request.params;
        subscriptions.add(uri);

        // Request sampling from client when someone subscribes
        await requestSampling("A new subscription was started", uri);
        return {};
    });

    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
        subscriptions.delete(request.params.uri);
        return {};
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        return {
            prompts: [
                {
                    name: PromptName.CREATE_BRANDED_DIAGRAM,
                    description: "Guided workflow for creating professional diagrams that match your brand identity",
                    arguments: [
                        {
                            name: "diagramType",
                            description: "Type of diagram: flowchart, sequence, architecture, er-diagram, state, or other",
                            required: true,
                        },
                        {
                            name: "description",
                            description: "Brief description of what the diagram should show",
                            required: true,
                        },
                    ],
                },
                {
                    name: PromptName.ITERATE_AND_REFINE,
                    description: "Best practices for iterating on generated images to achieve the perfect result",
                    arguments: [
                        {
                            name: "sessionId",
                            description: "The session UUID containing the image",
                            required: true,
                        },
                        {
                            name: "assetId",
                            description: "The asset UUID to iterate on",
                            required: true,
                        },
                        {
                            name: "issue",
                            description: "What issue are you trying to fix?",
                            required: false,
                        },
                    ],
                },
                {
                    name: PromptName.CREATE_ASSET_SET,
                    description: "Create a set of visually consistent images (icons, social cards, diagrams, illustrations)",
                    arguments: [
                        {
                            name: "assetType",
                            description: "Type of assets: icons, social-cards, diagrams, or illustrations",
                            required: true,
                        },
                        {
                            name: "count",
                            description: "How many assets in the set (2-10)",
                            required: true,
                        },
                    ],
                },
                {
                    name: PromptName.QUICK_ICON,
                    description: "Quickly generate a simple icon with sensible defaults",
                    arguments: [
                        {
                            name: "iconDescription",
                            description: "What the icon should represent (e.g., 'settings gear', 'user profile')",
                            required: true,
                        },
                        {
                            name: "style",
                            description: "Icon style: outline, filled, duotone, or 3d (defaults to filled)",
                            required: false,
                        },
                    ],
                },
            ],
        };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        if (name === PromptName.CREATE_BRANDED_DIAGRAM) {
            const diagramType = args?.diagramType || "flowchart";
            const description = args?.description || "a diagram";
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `I need to create a ${diagramType} diagram: ${description}

Please help me create this diagram by following these steps:

## Step 1: Gather Brand Context
Before generating, I need to provide:
- **Brand colors**: What are my primary and secondary brand colors? (hex codes like #0033A0)
- **Style preferences**: Modern, minimalist, corporate, playful, technical?
- **Project context**: What is this diagram for? (documentation, presentation, website)

## Step 2: Define the Diagram Structure
Help me outline the diagram structure:
- What are the main components/nodes?
- What are the relationships/flows between them?
- Should we use Mermaid or D2 syntax?

## Step 3: Choose Output Style
- **draft**: Quick preview (fastest, minimal styling)
- **standard**: AI-enhanced with brand colors (recommended for most cases)
- **premium**: Full AI polish - stunning professional artwork (best for hero images, may need iteration)

## Step 4: Generate
Once we have the context, generate the diagram using the \`generateImage\` tool with:
- kind: "diagram"
- brandColors: [my colors]
- stylePreferences: [my style]
- projectContext: [my context]
- outputStyle: [chosen style]

## Tips for Best Results
- For complex diagrams, start with 'standard' output style
- If the result has clipping or duplicates, regenerate with explicit instructions
- Use the iterateImage tool for refinements rather than regenerating from scratch`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.ITERATE_AND_REFINE) {
            const sessionId = args?.sessionId || "[sessionId]";
            const assetId = args?.assetId || "[assetId]";
            const issueContext = args?.issue 
                ? `\n\n**Current issue to address**: ${args.issue}`
                : "";

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `I want to iterate on asset ${assetId} in session ${sessionId}.${issueContext}

## First: Inspect the Asset
Use \`inspectImageSession(sessionId=${sessionId})\` to review:
- What toolchain was used (mermaid, d2, openai, gemini)?
- What was the original prompt?
- What metadata is stored (diagram source, colors used)?

## Common Issues and Solutions

### Clipped Edges / Elements Cut Off
- Include padding instructions: "ensure 20px padding on all edges"
- For diagrams: regenerate with explicit Mermaid/D2 source
- Try 'standard' output style instead of 'premium'

### Duplicate Elements
- This happens with 'premium' GPT-Image polish
- Explicitly state: "no duplicate boxes or labels"
- Consider using 'standard' for accuracy

### Wrong Colors / Style
- Use \`iterateImage\` with specific color instructions: "change primary color to #0033A0"
- Reference the original brandColors if they were provided

### Text Readability Issues
- Request "high contrast text"
- Specify "minimum 14px font size"
- Try 'gemini-pro' model for better text rendering

### Layout Problems
- For diagrams: provide the exact Mermaid/D2 source to preserve structure
- Add direction hints: "left to right flow", "top to bottom hierarchy"

## Using the Iterate Tool
\`\`\`
iterateImage({
  sessionId: "${sessionId}",
  assetId: "${assetId}",
  prompt: "Specific changes you want..."
})
\`\`\`

## When to Regenerate Instead
- If the fundamental structure is wrong
- If you need a completely different style
- If iteration attempts aren't converging

Start by inspecting the asset, then tell me what you'd like to change.`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.CREATE_ASSET_SET) {
            const assetType = args?.assetType || "icons";
            const count = parseInt(args?.count as string, 10) || 3;
            const kindMap: Record<string, string> = {
                "icons": "icon",
                "social-cards": "social-card",
                "diagrams": "diagram",
                "illustrations": "illustration",
            };
            const kind = kindMap[assetType] || "illustration";

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `I need to create a set of ${count} consistent ${assetType}.

## Creating Visually Consistent Assets

### Step 1: Establish the Style Guide
Before creating any assets, define:
- **Color palette**: Primary, secondary, accent colors (hex codes)
- **Style**: Modern, flat, 3D, hand-drawn, technical, etc.
- **Background**: Transparent, solid color, gradient?
- **Dimensions**: Same size for all? Specific aspect ratios?

### Step 2: Create the First Asset
Generate the first asset with full context:
\`\`\`
generateImage({
  prompt: "[first asset description]",
  kind: "${kind}",
  brandColors: ["#primary", "#secondary"],
  stylePreferences: "[your style]",
  projectContext: "Part of a ${count}-asset set for [purpose]",
  outputStyle: "standard"
})
\`\`\`

### Step 3: Use First Asset as Reference
Once you're happy with the first asset, use its ID as a reference for consistency:
\`\`\`
generateImage({
  prompt: "[second asset description]",
  kind: "${kind}",
  referenceAssetId: "[first asset ID]",
  brandColors: ["#primary", "#secondary"],
  stylePreferences: "[same style]",
  outputStyle: "standard"
})
\`\`\`

### Step 4: Iterate for Consistency
If an asset doesn't match the set:
- Use \`iterateImage\` to adjust colors/style
- Reference the prompt: "match the style of asset [ID]"
- Keep the same brandColors and stylePreferences

### Tips for ${assetType}
${assetType === 'icons' ? `
- Use \`transparent: true\` for all icons
- Keep complexity consistent (same level of detail)
- Use the same line weights and corner radius
- Consider a consistent canvas size (e.g., 512x512)` : ''}
${assetType === 'social-cards' ? `
- Maintain consistent text placement zones
- Use the same typography style
- Keep brand logo in the same position
- Standard sizes: 1200x630 (OG), 1200x675 (Twitter)` : ''}
${assetType === 'diagrams' ? `
- Use the same diagram syntax (all Mermaid or all D2)
- Consistent node shapes and colors
- Same arrow styles and line weights
- Matching background treatment` : ''}
${assetType === 'illustrations' ? `
- Same art style throughout
- Consistent character proportions (if applicable)
- Matching color saturation and contrast
- Similar level of detail and complexity` : ''}

What ${assetType} do you need to create? Let's start with defining your style guide.`,
                        },
                    },
                ],
            };
        }

        if (name === PromptName.QUICK_ICON) {
            const iconDescription = args?.iconDescription || "an icon";
            const style = (args?.style as string) || "filled";
            const styleGuide: Record<string, string> = {
                outline: "line-art style with consistent 2px stroke weight, no fills",
                filled: "solid filled shapes, clean and simple",
                duotone: "two-tone design with primary color and lighter accent",
                "3d": "subtle 3D effect with soft shadows and gradients",
            };
            const styleDesc = styleGuide[style] || styleGuide.filled;

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Generate a ${style} icon: ${iconDescription}

Use these settings for best results:
\`\`\`
generateImage({
  prompt: "${iconDescription} icon, ${styleDesc}, centered on canvas, professional quality",
  kind: "icon",
  transparent: true,
  quality: "high",
  stylePreferences: "${style} icon style, clean vector aesthetic, suitable for UI",
  outputStyle: "standard"
})
\`\`\`

This will create a transparent PNG icon ready for use in your application.`,
                        },
                    },
                ],
            };
        }

        throw new Error(`Unknown prompt: ${name}`);
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        let { name, arguments: args } = request.params;
        
        // Only attempt to get appId if we're using SSE transport
        // For stdio transport we don't need appId
        const isSSETransport = server.transport && 'sessionId' in server.transport;
        const appId = isSSETransport ? getAppId(server.transport?.sessionId as string) : undefined;
        
        let validatedArgs: any;

        switch (name) {
            case ToolNames.GET_OG_DATA:
                if (isSSETransport && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_data_tool = new GetOgDataTool(appId);
                validatedArgs = og_data_tool.inputSchema.parse(args);
                return og_data_tool.execute(validatedArgs);

            case ToolNames.GET_OG_SCRAPE_DATA:
                if (isSSETransport && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_scrape_data_tool = new GetOgScrapeDataTool(appId);
                validatedArgs = og_scrape_data_tool.inputSchema.parse(args);
                return og_scrape_data_tool.execute(validatedArgs);

            case ToolNames.GET_OG_SCREENSHOT:
                if (isSSETransport && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_screenshot_tool = new GetOgScreenshotTool(appId);
                validatedArgs = og_screenshot_tool.inputSchema.parse(args);
                return og_screenshot_tool.execute(validatedArgs);

            case ToolNames.GET_OG_QUERY:
                if (isSSETransport && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_query_tool = new GetOgQueryTool(appId);
                validatedArgs = og_query_tool.inputSchema.parse(args);
                return og_query_tool.execute(validatedArgs);

            case ToolNames.GET_OG_EXTRACT:
                if (isSSETransport && !appId) {
                    throw new Error("Could not find App ID for session.");
                }
                const og_extract_tool = new GetOgExtractTool(appId);
                validatedArgs = og_extract_tool.inputSchema.parse(args);
                return og_extract_tool.execute(validatedArgs);

            // Image generation tools (use OG_BASE_URL, no appId required in switch)
            case ToolNames.GENERATE_IMAGE:
                const generate_image_tool = new GenerateImageTool();
                validatedArgs = generate_image_tool.inputSchema.parse(args);
                return generate_image_tool.execute(validatedArgs);

            case ToolNames.ITERATE_IMAGE:
                const iterate_image_tool = new IterateImageTool();
                validatedArgs = iterate_image_tool.inputSchema.parse(args);
                return iterate_image_tool.execute(validatedArgs);

            case ToolNames.INSPECT_IMAGE_SESSION:
                const inspect_session_tool = new InspectImageSessionTool();
                validatedArgs = inspect_session_tool.inputSchema.parse(args);
                return inspect_session_tool.execute(validatedArgs);

            case ToolNames.EXPORT_IMAGE_ASSET:
                const export_asset_tool = new ExportImageAssetTool();
                validatedArgs = export_asset_tool.inputSchema.parse(args);
                return export_asset_tool.execute(validatedArgs);

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    });

    server.setRequestHandler(CompleteRequestSchema, async (request) => {
        const { ref, argument } = request.params;

        if (ref.type === "ref/resource") {
            // Asset resources use UUIDs, no autocomplete suggestions
            return { completion: { values: [] } };
        }

        if (ref.type === "ref/prompt") {
            // Handle completion for prompt arguments
            const completions =
                EXAMPLE_COMPLETIONS[argument.name as keyof typeof EXAMPLE_COMPLETIONS];
            if (!completions) return { completion: { values: [] } };

            const values = completions.filter((value) =>
                value.toLowerCase().startsWith(argument.value.toLowerCase())
            );
            return { completion: { values, hasMore: false, total: values.length } };
        }

        throw new Error(`Unknown reference type`);
    });

    server.setRequestHandler(SetLevelRequestSchema, async (request) => {
        const { level } = request.params;
        logLevel = level;

        // Demonstrate different log levels
        await server.notification({
            method: "notifications/message",
            params: {
                level: "debug",
                logger: "test-server",
                data: `Logging level set to: ${logLevel}`,
            },
        });

        return {};
    });

    const cleanup = async () => {
        if (subsUpdateInterval) clearInterval(subsUpdateInterval);
        if (logsUpdateInterval) clearInterval(logsUpdateInterval);
        if (stdErrUpdateInterval) clearInterval(stdErrUpdateInterval);
    };

    return { server, cleanup };
};