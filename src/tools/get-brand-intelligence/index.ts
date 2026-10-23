import BaseTool from "@/tools/base";
import { ToolNames } from "@/tools/constants";
import { z } from "zod";
import { httpUrl } from "@/utils/urlInput";
import { getBrandIntelligence, BRAND_SECTIONS, BRAND_QUESTION_TYPES } from "@/utils/og";
import { formatBrandIntelligence, formatError, toResult, toUntrustedResult, provenanceSchema } from "@/utils/format";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Mirrors og-api's parseBrandRequest so a request it would 400 fails here first.
const MAX_QUESTIONS = 3;
const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];

const sectionsSchema = z.object(
    Object.fromEntries(BRAND_SECTIONS.map((name) => [name, z.boolean().optional()])) as
        Record<typeof BRAND_SECTIONS[number], z.ZodOptional<z.ZodBoolean>>,
).strict();

const questionSchema = z.object({
    key: z.string()
        .regex(/^[a-z0-9_]{1,64}$/i, "Keys must be 1-64 letters, digits or underscores.")
        .refine((k) => !RESERVED_KEYS.includes(k), "That key is reserved.")
        .describe("Stable key the answer is returned under in `custom`."),
    question: z.string().min(1).max(500).describe(
        "What to find out about the brand. Must be answerable from the brand's own website.",
    ),
    type: z.enum(BRAND_QUESTION_TYPES).optional().describe(
        "Type of the answer. Defaults to 'string'.",
    ),
});

class GetBrandIntelligenceTool extends BaseTool {
    private appId: string;

    constructor(appId = '') {
        super();
        this.appId = appId;
    }

    name = ToolNames.GET_BRAND_INTELLIGENCE;
    description =
        "Build a structured brand profile for a website via the OpenGraph.io Brand Intelligence API. " +
        "Crawls about ten of the brand's own pages and returns: brand (name, description, tagline, " +
        "category), identity (logos, an inline SVG logo when the site draws one, icon, colors, fonts), products, audiences, positioning, messaging, " +
        "voice, visual style, and links. Values with too little evidence come back null rather than guessed. " +
        "Use it when you need to understand or write as a brand; use getOgData or getOgMarkdown for a single page.\n\n" +
        "COST: a fresh analysis uses 500 API credits; a cached one uses 1; a failed one uses nothing. " +
        "The cache is reused only for the same url AND the same sections, so changing sections, adding " +
        "questions, or cache_ok:false each run and bill a fresh analysis. To read one section of a profile " +
        "you already fetched, reuse that result instead of calling again. Synchronous; can take up to a minute. " +
        "Rendering and proxies are chosen server-side; the usual fetch parameters do not apply.\n\n" +
        "identity.colors is a ranked candidate list, not the verified brand color: a 'primary' role is a " +
        "best-effort guess and is omitted for an all-neutral palette.";

    annotations = {
        title: "Brand Intelligence",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    };

    inputSchema = z.object({
        url: httpUrl().describe("The brand's website, e.g. https://linear.app."),
        sections: sectionsSchema.optional().describe(
            "Turn sections off by setting them to false; every section is on by default. Skipping " +
            "sections makes the request faster but does not lower the cost, and a different set of " +
            "sections does not reuse a cached full profile.",
        ),
        questions: z.array(questionSchema).max(MAX_QUESTIONS)
            .refine((qs) => new Set(qs.map((q) => q.key)).size === qs.length, "Question keys must be unique.")
            .optional()
            .describe(
                `Up to ${MAX_QUESTIONS} custom questions, answered under \`custom\` with the requested type. ` +
                "A request with questions is never served from cache.",
            ),
        include_meta: z.boolean().optional().describe(
            "Add a `_meta` object recording, per field, its basis (observed / derived / inferred) and " +
            "which analyzed pages support it. Defaults to false.",
        ),
        cache_ok: z.boolean().optional().describe(
            "Set to false to force a fresh analysis (500 credits). Defaults to true.",
        ),
    });

    outputSchema = z.object({
        provenance: provenanceSchema,
        url:     z.string(),
        // Sections the caller turned off are absent, and custom/_meta are
        // conditional, so the profile is left open rather than pinned.
        profile: z.record(z.any()).describe(
            "The brand profile: brand, identity, products, audiences, positioning, messaging, voice, " +
            "visual, links, plus custom and _meta when requested.",
        ),
    });

    async execute(args: z.infer<typeof this.inputSchema>): Promise<CallToolResult> {
        try {
            const { url, ...options } = args;
            const profile = await getBrandIntelligence(url, this.appId, options);
            return toUntrustedResult(formatBrandIntelligence(url, profile), url);
        } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            return toResult(formatError("Brand Intelligence", reason));
        }
    }
}

export default GetBrandIntelligenceTool;
