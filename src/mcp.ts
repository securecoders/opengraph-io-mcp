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
    Resource,
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

/* Input schemas for tools implemented in this server */

// Example completion values
const EXAMPLE_COMPLETIONS = {
    style: ["casual", "formal", "technical", "friendly"],
    temperature: ["0", "0.5", "0.7", "1.0"],
    resourceId: ["1", "2", "3", "4", "5"],
};


enum PromptName {
    SIMPLE = "simple_prompt",
    COMPLEX = "complex_prompt",
    RESOURCE = "resource_prompt",
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

    const ALL_RESOURCES: Resource[] = Array.from({ length: 100 }, (_, i) => {
        const uri = `test://static/resource/${i + 1}`;
        if (i % 2 === 0) {
            return {
                uri,
                name: `Resource ${i + 1}`,
                mimeType: "text/plain",
                text: `Resource ${i + 1}: This is a plaintext resource`,
            };
        } else {
            const buffer = Buffer.from(`Resource ${i + 1}: This is a base64 blob`);
            return {
                uri,
                name: `Resource ${i + 1}`,
                mimeType: "application/octet-stream",
                blob: buffer.toString("base64"),
            };
        }
    });

    const PAGE_SIZE = 10;

    server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
        const cursor = request.params?.cursor;
        let startIndex = 0;

        if (cursor) {
            const decodedCursor = parseInt(atob(cursor), 10);
            if (!isNaN(decodedCursor)) {
                startIndex = decodedCursor;
            }
        }

        const endIndex = Math.min(startIndex + PAGE_SIZE, ALL_RESOURCES.length);
        const resources = ALL_RESOURCES.slice(startIndex, endIndex);

        let nextCursor: string | undefined;
        if (endIndex < ALL_RESOURCES.length) {
            nextCursor = btoa(endIndex.toString());
        }

        return {
            resources,
            nextCursor,
        };
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
        return {
            resourceTemplates: [
                {
                    uriTemplate: "test://static/resource/{id}",
                    name: "Static Resource",
                    description: "A static resource with a numeric ID",
                },
            ],
        };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const uri = request.params.uri;

        if (uri.startsWith("test://static/resource/")) {
            const index = parseInt(uri.split("/").pop() ?? "", 10) - 1;
            if (index >= 0 && index < ALL_RESOURCES.length) {
                const resource = ALL_RESOURCES[index];
                return {
                    contents: [resource],
                };
            }
        }

        throw new Error(`Unknown resource: ${uri}`);
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
                    name: PromptName.SIMPLE,
                    description: "A prompt without arguments",
                },
                {
                    name: PromptName.COMPLEX,
                    description: "A prompt with arguments",
                    arguments: [
                        {
                            name: "temperature",
                            description: "Temperature setting",
                            required: true,
                        },
                        {
                            name: "style",
                            description: "Output style",
                            required: false,
                        },
                    ],
                },
                {
                    name: PromptName.RESOURCE,
                    description: "A prompt that includes an embedded resource reference",
                    arguments: [
                        {
                            name: "resourceId",
                            description: "Resource ID to include (1-100)",
                            required: true,
                        },
                    ],
                },
            ],
        };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        if (name === PromptName.SIMPLE) {
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: "This is a simple prompt without arguments.",
                        },
                    },
                ],
            };
        }

        if (name === PromptName.COMPLEX) {
            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `This is a complex prompt with arguments: temperature=${args?.temperature}, style=${args?.style}`,
                        },
                    },
                    {
                        role: "assistant",
                        content: {
                            type: "text",
                            text: "I understand. You've provided a complex prompt with temperature and style arguments. How would you like me to proceed?",
                        },
                    }
                ],
            };
        }

        if (name === PromptName.RESOURCE) {
            const resourceId = parseInt(args?.resourceId as string, 10);
            if (isNaN(resourceId) || resourceId < 1 || resourceId > 100) {
                throw new Error(
                    `Invalid resourceId: ${args?.resourceId}. Must be a number between 1 and 100.`
                );
            }

            const resourceIndex = resourceId - 1;
            const resource = ALL_RESOURCES[resourceIndex];

            return {
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `This prompt includes Resource ${resourceId}. Please analyze the following resource:`,
                        },
                    },
                    {
                        role: "user",
                        content: {
                            type: "resource",
                            resource: resource,
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
            const resourceId = ref.uri.split("/").pop();
            if (!resourceId) return { completion: { values: [] } };

            // Filter resource IDs that start with the input value
            const values = EXAMPLE_COMPLETIONS.resourceId.filter((id) =>
                id.startsWith(argument.value)
            );
            return { completion: { values, hasMore: false, total: values.length } };
        }

        if (ref.type === "ref/prompt") {
            // Handle completion for prompt arguments
            const completions =
                EXAMPLE_COMPLETIONS[argument.name as keyof typeof EXAMPLE_COMPLETIONS];
            if (!completions) return { completion: { values: [] } };

            const values = completions.filter((value) =>
                value.startsWith(argument.value)
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