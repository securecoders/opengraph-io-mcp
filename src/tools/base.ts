import { z } from "zod";
import { CallToolResult, Tool, ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

abstract class BaseTool {
    constructor() {}

    abstract name:        string;
    abstract description: string;

    abstract inputSchema:  z.ZodSchema;
    abstract outputSchema: z.ZodSchema;

    abstract execute(args: any): Promise<CallToolResult>;

    toToolType(): Tool {
        return {
            name: this.name,
            description: this.description,
            inputSchema: zodToJsonSchema(this.inputSchema) as ToolInput,
        };
    }
}
export default BaseTool;