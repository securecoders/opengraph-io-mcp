/**
 * Per-response Markdown + structuredContent formatters for all MCP tools.
 *
 * Each formatter returns { markdown, structured } where:
 *   - markdown  is the human-readable Markdown text block (agent-facing)
 *   - structured is the complete machine-readable payload (structuredContent)
 *
 * Brand conventions are imported from style.ts and applied consistently.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    CHECK,
    metaLine,
    tag,
    truncate,
    domainFromUrl,
    freshnessLabel,
    fieldRow,
} from "@/utils/style";

// ---------------------------------------------------------------------------
// CallToolResult builder
// ---------------------------------------------------------------------------

interface FormatResult {
    markdown:   string;
    structured: Record<string, any>;
    isError?:   boolean;
}

/**
 * Build a CallToolResult from a formatted response.
 * The text content block carries the Markdown summary; structuredContent
 * carries the complete machine-readable payload (omitted on errors so the MCP
 * SDK does not validate error content against the tool's outputSchema).
 */
export function toResult({ markdown, structured, isError }: FormatResult): CallToolResult {
    const result: CallToolResult = {
        content: [{ type: "text", text: markdown }],
        ...(isError ? {} : { structuredContent: structured }),
    };
    if (isError) {
        result.isError = true;
    }
    return result;
}

// ---------------------------------------------------------------------------
// Truncation caps (text block only — structuredContent is always complete)
// ---------------------------------------------------------------------------

const CAP_SCRAPE    = 3000;
const CAP_QUERY     = 4000;
const CAP_EXTRACT   = 2000;
const CAP_MARKDOWN  = 6000;

// ---------------------------------------------------------------------------
// formatOgData
// ---------------------------------------------------------------------------

export interface OgDataPayload {
    hybridGraph:  any;
    openGraph:    any;
    htmlInferred: any;
    requestInfo?: any;
}

export function formatOgData(url: string, data: OgDataPayload): FormatResult {
    const { hybridGraph = {}, openGraph = {}, htmlInferred = {}, requestInfo } = data;
    const domain = domainFromUrl(url);

    // --- meta line ---
    const parts: string[] = [];
    if (hybridGraph.type)      parts.push(hybridGraph.type);
    if (hybridGraph.site_name) parts.push(hybridGraph.site_name);
    if (hybridGraph.locale)    parts.push(hybridGraph.locale);
    const isCached = requestInfo?.is_cache;
    if (isCached !== undefined) parts.push(freshnessLabel(isCached));
    const meta = parts.length ? metaLine(parts) : null;

    // --- coverage indicators ---
    const hasOG       = !!(openGraph?.title || openGraph?.description || openGraph?.image);
    const hasInferred = !!(htmlInferred?.title || htmlInferred?.description);

    const coverageLines: string[] = [];
    if (hasOG)       coverageLines.push(`${CHECK} Open Graph tags present`);
    else             coverageLines.push(`Open Graph tags — Missing (using HTML inferred fallback)`);
    if (hasInferred) coverageLines.push(`${CHECK} HTML inferred data present`);

    // --- preview fields ---
    const previewLines = [
        fieldRow('Title',       'og:title',       hybridGraph.title),
        fieldRow('Description', 'og:description', hybridGraph.description),
        fieldRow('Site Name',   'og:site_name',   hybridGraph.site_name),
        fieldRow('Image',       'og:image',       hybridGraph.image),
        fieldRow('URL',         'og:url',         hybridGraph.url),
        fieldRow('Favicon',     'favicon',        hybridGraph.favicon),
    ];

    // --- additional fields if present ---
    const extras: string[] = [];
    if (hybridGraph.type)                 extras.push(`- **Type** — ${tag('og:type')}: ${hybridGraph.type}`);
    if (hybridGraph.video)                extras.push(`- **Video** — ${tag('og:video')}: ${CHECK} Found`);
    if (hybridGraph.articlePublishedTime) extras.push(`- **Published** — ${hybridGraph.articlePublishedTime}`);
    if (hybridGraph.articleAuthor)        extras.push(`- **Author** — ${hybridGraph.articleAuthor}`);

    const lines: string[] = [
        `## Open Graph Data`,
        `**${domain}**`,
        '',
    ];
    if (meta) {
        lines.push(meta, '');
    }
    lines.push(
        `### Preview`,
        ...previewLines,
    );
    if (extras.length) {
        lines.push('', ...extras);
    }
    lines.push(
        '',
        `### Coverage`,
        ...coverageLines,
    );

    return {
        markdown:  lines.join('\n'),
        structured: { url, hybridGraph, openGraph, htmlInferred, requestInfo },
    };
}

// ---------------------------------------------------------------------------
// formatScrape
// ---------------------------------------------------------------------------

export function formatScrape(url: string, html: string, requestInfo?: any): FormatResult {
    const domain   = domainFromUrl(url);
    const isCached = requestInfo?.is_cache;
    const length   = html.length;

    const meta = metaLine([
        `${length.toLocaleString()} chars`,
        'HTML',
        isCached !== undefined ? freshnessLabel(isCached) : null,
    ]);

    const preview = truncate(html, CAP_SCRAPE);

    const markdown = [
        `## Scraped HTML`,
        `**${domain}**`,
        '',
        meta,
        '',
        '```html',
        preview,
        '```',
    ].join('\n');

    return {
        markdown,
        structured: { url, html, length, requestInfo },
    };
}

// ---------------------------------------------------------------------------
// formatScreenshot
// ---------------------------------------------------------------------------

export interface ScreenshotPayload {
    screenshotUrl: string;
    message?:      string;
    dimensions?:   string;
    format?:       string;
    fullPage?:     boolean;
}

export function formatScreenshot(url: string, payload: ScreenshotPayload): FormatResult {
    const { screenshotUrl, dimensions, format, fullPage } = payload;
    const domain = domainFromUrl(url);

    const meta = metaLine([
        dimensions              ?? null,
        format                  ? format.toUpperCase() : null,
        fullPage                ? 'full page' : 'viewport',
    ]);

    const markdown = [
        `## Screenshot`,
        `**${domain}**`,
        '',
        meta,
        '',
        `[View screenshot](${screenshotUrl})`,
    ].join('\n');

    return {
        markdown,
        structured: { url, screenshotUrl, dimensions, format, fullPage },
    };
}

// ---------------------------------------------------------------------------
// formatQuery
// ---------------------------------------------------------------------------

export function formatQuery(url: string, question: string, result: any): FormatResult {
    const domain = domainFromUrl(url);

    // Render the answer: object → list, string → prose
    let answerBlock: string;
    if (typeof result === 'string') {
        answerBlock = result;
    } else if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
        answerBlock = Object.entries(result)
            .map(([k, v]) => `- **${k}**: ${Array.isArray(v) ? (v as any[]).join(', ') : String(v)}`)
            .join('\n');
    } else if (Array.isArray(result)) {
        answerBlock = result.map((item, i) => `${i + 1}. ${typeof item === 'object' ? JSON.stringify(item) : item}`).join('\n');
    } else {
        answerBlock = String(result ?? '(no result)');
    }

    const markdown = truncate(
        [
            `## Query Result`,
            `**${domain}**`,
            '',
            `> ${question}`,
            '',
            `### Answer`,
            answerBlock,
        ].join('\n'),
        CAP_QUERY,
    );

    return {
        markdown,
        structured: { url, question, result },
    };
}

// ---------------------------------------------------------------------------
// formatExtract
// ---------------------------------------------------------------------------

export interface ExtractPayload {
    /** Tag-name based results (v1.1 or v3 html_elements without selectors) */
    tags?:            Array<{ tag: string; innerText: string; position?: number }>;
    concatenatedText?: string;
    /** Structured selector-based results (v3 selectors param) */
    data?:            Record<string, any>;
    ai_safety?:       any;
}

export function formatExtract(url: string, payload: ExtractPayload): FormatResult {
    const { tags = [], concatenatedText, data } = payload;
    const domain = domainFromUrl(url);

    const tableRows: string[] = [];
    let countLine = '';

    if (data && Object.keys(data).length > 0) {
        // v3 selector-based: render as Label → Value table
        const entries = Object.entries(data);
        countLine = `${entries.length} field${entries.length !== 1 ? 's' : ''} extracted`;
        tableRows.push('| Label | Value |');
        tableRows.push('|-------|-------|');
        for (const [label, value] of entries) {
            const cell = truncate(
                (Array.isArray(value) ? value.join(', ') : String(value ?? '')).replace(/\n/g, ' ').trim(),
                120,
            );
            tableRows.push(`| **${label}** | ${cell} |`);
        }
    } else if (tags.length > 0) {
        // v1.1 or v3 tag-based: render Element → Text table
        countLine = `${tags.length} element${tags.length !== 1 ? 's' : ''} extracted`;
        tableRows.push('| Element | Text |');
        tableRows.push('|---------|------|');
        for (const { tag: t, innerText } of tags) {
            const cell = truncate(innerText.replace(/\n/g, ' ').trim(), 120);
            tableRows.push(`| ${tag(t)} | ${cell} |`);
        }
    } else {
        countLine = '0 elements extracted';
    }

    const markdown = truncate(
        [
            `## Extracted Elements`,
            `**${domain}**`,
            '',
            countLine,
            '',
            ...(tableRows.length ? tableRows : ['_(no elements matched)_']),
            ...(concatenatedText
                ? ['', '### Concatenated text', truncate(concatenatedText, 600)]
                : []),
        ].join('\n'),
        CAP_EXTRACT,
    );

    return {
        markdown,
        structured: { url, tags, concatenatedText, data },
    };
}

// ---------------------------------------------------------------------------
// formatMarkdown
// ---------------------------------------------------------------------------

export interface MarkdownPayload {
    markdown:      string;
    onlyMainContent?: boolean;
    requestInfo?:  any;
}

export function formatMarkdown(url: string, payload: MarkdownPayload): FormatResult {
    const { markdown: content, onlyMainContent, requestInfo } = payload;
    const domain   = domainFromUrl(url);
    const isCached = requestInfo?.is_cache;

    const meta = metaLine([
        `${content.length.toLocaleString()} chars`,
        onlyMainContent !== false ? 'main content' : 'full page',
        isCached !== undefined ? freshnessLabel(isCached) : null,
    ]);

    // The markdown response from og-api IS the content — pass it through with
    // a branded header block, then truncate if needed.
    const markdown = truncate(
        [
            `## Markdown`,
            `**${domain}**`,
            '',
            meta,
            '',
            '---',
            '',
            content,
        ].join('\n'),
        CAP_MARKDOWN,
    );

    return {
        markdown,
        structured: { url, markdown: content, length: content.length, onlyMainContent, requestInfo },
    };
}

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------

export function formatError(toolTitle: string, reason: string): FormatResult {
    const markdown = [
        `## Could not complete request`,
        '',
        `**${toolTitle}** — ${reason}`,
    ].join('\n');

    return {
        markdown,
        structured: { error: reason },
        isError:    true,
    };
}
