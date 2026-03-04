import { z } from "zod";
import { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface ToolAnnotations {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

abstract class BaseTool {
    constructor() {}

    abstract name:        string;
    abstract description: string;

    abstract inputSchema:  z.ZodSchema;
    abstract outputSchema: z.ZodSchema;

    annotations?: ToolAnnotations;

    abstract execute(args: any): Promise<CallToolResult>;

    toToolType(): Tool {
        return {
            name: this.name,
            description: this.description,
            inputSchema: zodToJsonSchema(this.inputSchema) as Tool["inputSchema"],
            ...(this.annotations && { annotations: this.annotations }),
        };
    }
}
export default BaseTool;
