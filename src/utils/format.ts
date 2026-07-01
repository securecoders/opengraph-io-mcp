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
import type { AuditSummary, AuditStatus, DiscoverResult } from "@/utils/site-audit-api";
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
// Site Audit formatters
// ---------------------------------------------------------------------------

const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
    QUEUED:   "Queued",
    CRAWLING: "Crawling",
    SCORING:  "Scoring",
    COMPLETE: "Complete",
    FAILED:   "Failed",
};

function scoreBar(score: number | null | undefined): string {
    if (score == null) return "";
    const filled = Math.round(score / 10);
    const bar    = "█".repeat(filled) + "░".repeat(10 - filled);
    return `${bar} ${score}/100`;
}

function issuesCounts(audit: AuditSummary): string {
    const parts: string[] = [];
    if (audit.criticalIssues) parts.push(`${audit.criticalIssues} CRITICAL`);
    if (audit.totalIssues)    parts.push(`${audit.totalIssues} total issues`);
    return parts.join(" · ") || "no issues counted yet";
}

export function formatDiscoverResult(result: DiscoverResult): FormatResult {
    const { domain, totalFound, urls, remainingQuota } = result;

    // Group by depth so the user can see sections of the site
    const byDepth = new Map<number, typeof urls>();
    for (const u of urls) {
        const d = u.depth ?? 0;
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d)!.push(u);
    }

    const quotaLine = remainingQuota != null
        ? `Quota remaining this period: **${remainingQuota}** pages`
        : null;

    const lines: string[] = [
        `## URLs Discovered on ${domain}`,
        '',
        metaLine([
            `${totalFound} total URL${totalFound !== 1 ? 's' : ''} found`,
            `${urls.length} returned`,
            quotaLine,
        ].filter(Boolean) as string[]),
        '',
    ];

    // Build the domain-relative path list. Paths are much shorter than full
    // URLs (saves ~20 chars each), maximising how many fit within the context
    // window. The base URL is shown once so agents can reconstruct full URLs.
    let baseUrl = '';
    try {
        const parsed = new URL(urls[0]?.url ?? `https://${domain}`);
        baseUrl = `${parsed.protocol}//${parsed.host}`;
    } catch {
        baseUrl = `https://${domain}`;
    }

    lines.push(`Base URL: \`${baseUrl}\``);
    lines.push('');

    // Show ALL URLs grouped by depth — agent reads these to build the urls[]
    // array for startSiteAudit. Use paths only (prepend base URL when calling).
    const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);
    let shownCount = 0;
    for (const depth of depths) {
        const group = byDepth.get(depth)!;
        const label = depth === 0 ? 'Homepage / root pages' : depth === 1 ? 'Top-level pages' : `Depth ${depth}`;
        lines.push(`### ${label} (${group.length})`);
        group.forEach((u) => {
            let path = u.url;
            try { path = new URL(u.url).pathname || '/'; } catch { /* keep full url */ }
            const src = u.source && u.source !== 'crawl' ? ` _(${u.source})_` : '';
            lines.push(`- \`${path}\`${src}`);
            shownCount++;
        });
        lines.push('');
    }

    lines.push('---');

    const omitted = urls.length - shownCount;
    if (omitted > 0) {
        lines.push(`> **Note:** ${omitted} URL${omitted !== 1 ? 's' : ''} could not be shown due to length limits. Ask the user to specify pages manually or audit the site without a URL list so the backend crawls it directly.`);
    }

    lines.push('Ask the user which pages to audit, then call **startSiteAudit** with the full URLs (base URL + path).');
    if (remainingQuota != null && remainingQuota < totalFound) {
        lines.push(`> **Plan limit:** Your quota allows **${remainingQuota}** more pages this period. Select up to that many URLs, or [upgrade your plan](https://dashboard.opengraph.io/organization/billing) to audit more.`);
    }

    // Normalize URL objects to exactly match the output schema:
    // strip extra API fields and coerce depth to a number.
    const normalizedUrls = urls.map((u) => ({
        url:    u.url,
        source: u.source ?? "crawl",
        depth:  typeof u.depth === "number" ? u.depth : Number(u.depth ?? 0),
    }));

    return {
        // Use a generous limit — agents need the full URL list to pass to startSiteAudit
        markdown:   truncate(lines.join('\n'), 20000),
        structured: {
            domain,
            totalFound,
            urls: normalizedUrls,
            siteContextText: result.siteContext?.concatenatedText,
            remainingQuota,
        },
    };
}

export function formatAuditStarted(
    audit: AuditSummary,
    clamp?: { field: string; requested: number; applied: number; remaining?: number },
): FormatResult {
    const lines = [
        `## Site Audit Started`,
        `**${audit.domain}**`,
        '',
        metaLine([`${audit.pagesRequested} pages requested`, AUDIT_STATUS_LABEL[audit.status]]),
        '',
        `Audit ID: \`${audit.id}\``,
        '',
        `Poll with **getSiteAuditStatus** using this ID until status is **Complete**.`,
    ];

    if (clamp && clamp.requested > clamp.applied) {
        const remaining = clamp.remaining ?? clamp.applied;
        lines.push('');
        lines.push(
            `> **Monthly quota reached:** You requested ${clamp.requested} pages but only **${remaining} page${remaining !== 1 ? 's' : ''} remain** in your quota this month. ` +
            `This audit will cover ${clamp.applied} page${clamp.applied !== 1 ? 's' : ''}. ` +
            `[Upgrade your plan](https://dashboard.opengraph.io/organization/billing) to increase your monthly page quota.`,
        );
    }

    return {
        markdown: lines.join('\n'),
        structured: { auditId: audit.id, status: audit.status, domain: audit.domain, pagesRequested: audit.pagesRequested },
    };
}

export function formatAuditStatus(audit: AuditSummary): FormatResult {
    const statusLabel = AUDIT_STATUS_LABEL[audit.status] || audit.status;
    const progress = audit.pagesAudited != null && audit.pagesRequested
        ? ` (${audit.pagesAudited}/${audit.pagesRequested} pages)`
        : "";

    const lines = [
        `## Site Audit Status`,
        `**${audit.domain}**`,
        '',
        `Status: **${statusLabel}**${progress}`,
    ];

    if (audit.status === "COMPLETE") {
        if (audit.score != null) lines.push('', `Score: ${scoreBar(audit.score)}`);
        lines.push('', issuesCounts(audit));
        lines.push('', `${CHECK} Use **getSiteAuditReport** to get the full results.`);
    } else if (audit.status === "FAILED") {
        if (audit.errorMessage) lines.push('', `Error: ${audit.errorMessage}`);
    } else {
        lines.push('', `Poll again in a few seconds — audit is still running.`);
    }

    return {
        markdown: lines.join('\n'),
        structured: {
            auditId:      audit.id,
            status:       audit.status,
            domain:       audit.domain,
            score:        audit.score,
            pagesAudited: audit.pagesAudited,
            pagesFetched: audit.pagesFetched,
            pagesRequested: audit.pagesRequested,
            criticalIssues: audit.criticalIssues,
            totalIssues:    audit.totalIssues,
            completedAt:    audit.completedAt,
            errorMessage:   audit.errorMessage,
        },
    };
}

const SCORE_GRADE = (s: number | null | undefined): string => {
    if (s == null) return '';
    if (s >= 90) return 'Well Optimized';
    if (s >= 80) return 'Good';
    if (s >= 70) return 'Room for Improvement';
    if (s >= 60) return 'Needs Attention';
    return 'Poor Optimization';
};

export function formatAuditReport(report: any): FormatResult {
    const {
        domain,
        score,
        pagesAudited,
        summary     = {},
        aiSiteOverview,
        pages       = [],
        completedAt,
    } = report;

    const grade    = SCORE_GRADE(score);
    const dateStr  = completedAt ? new Date(completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

    // ── Header ────────────────────────────────────────────────────────────────
    const lines: string[] = [
        `## Site Audit Report — ${domain}`,
        '',
        `**Overall Score: ${score != null ? score : '—'}/100** — ${grade}`,
        `${scoreBar(score)}`,
        '',
        metaLine([
            `${pagesAudited ?? pages.length} pages audited`,
            summary.criticalIssues  ? `${summary.criticalIssues} critical` : null,
            summary.warningIssues   ? `${summary.warningIssues} warnings` : null,
            summary.passedChecks    ? `${summary.passedChecks} passed` : null,
            dateStr,
        ]),
        '',
        '---',
    ];

    // ── AI Executive Summary ──────────────────────────────────────────────────
    const siteSummary  = aiSiteOverview?.siteSummary;
    const rollup: any[]= aiSiteOverview?.issueRollup || [];
    const highlights: any[] = aiSiteOverview?.reportHighlights || [];

    if (siteSummary?.summary) {
        lines.push('', '### Overview');
        lines.push(truncate(siteSummary.summary, 800));
    }

    // ── Strengths ─────────────────────────────────────────────────────────────
    const strengths: string[] = siteSummary?.strengths || [];
    if (strengths.length) {
        lines.push('', '### What\'s Working');
        strengths.slice(0, 4).forEach((s: string) => lines.push(`- ${CHECK} ${s}`));
    }

    // ── Top Priorities ────────────────────────────────────────────────────────
    const priorities: string[] = siteSummary?.topPriorities || [];
    if (priorities.length) {
        lines.push('', '### Top Priorities');
        priorities.slice(0, 6).forEach((p: string, i: number) => lines.push(`${i + 1}. ${p}`));
    }

    // ── Issue Rollup (critical + high) ────────────────────────────────────────
    const criticalIssues = rollup.filter((i) => i.severity === 'critical' || i.severity === 'high');
    if (criticalIssues.length) {
        lines.push('', '### Issues Requiring Immediate Attention');
        criticalIssues.slice(0, 6).forEach((issue: any) => {
            const sev    = (issue.severity || 'high').toUpperCase();
            const count  = issue.affectedCount != null ? ` — **${issue.affectedCount} page(s) affected**` : '';
            lines.push(`#### ${sev}: ${issue.title}${count}`);
            if (issue.businessImpact) lines.push(truncate(issue.businessImpact, 180));
            if (issue.whyItMatters)   lines.push(`_Why it matters: ${truncate(issue.whyItMatters, 140)}_`);
            if (issue.fix?.description) lines.push(`> **Fix:** ${truncate(issue.fix.description, 160)}`);
            lines.push('');
        });
    } else if (highlights.length) {
        // Fall back to report highlights when no AI rollup available
        lines.push('', '### Key Findings');
        highlights.slice(0, 5).forEach((h: any) => {
            const sev = h.severity ? `**${h.severity.toUpperCase()}** — ` : '';
            lines.push(`- ${sev}${h.title}`);
            if (h.impact) lines.push(`  _${truncate(h.impact, 140)}_`);
        });
    }

    // ── Per-Page Breakdown ────────────────────────────────────────────────────
    const scoredPages = pages.filter((p: any) => p.score != null);
    if (scoredPages.length) {
        const worst = [...scoredPages]
            .sort((a: any, b: any) => (a.score ?? 100) - (b.score ?? 100))
            .slice(0, 8);
        const best  = [...scoredPages]
            .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, 4);

        if (worst.length) {
            lines.push('### Pages Needing Attention');
            worst.forEach((p: any) => {
                const critCount = (p.issues || []).filter((i: any) => i.severity === 'critical').length;
                const highCount = (p.issues || []).filter((i: any) => i.severity === 'high').length;
                const issueTag  = critCount
                    ? ` · ${critCount} CRITICAL`
                    : highCount
                        ? ` · ${highCount} HIGH`
                        : '';
                const path = (() => { try { return new URL(p.url).pathname || '/'; } catch { return p.url; } })();
                lines.push(`- **${path}** — ${p.score}/100${issueTag}`);
                // Show top issue per page
                const topIssue = (p.issues || []).find((i: any) => i.severity === 'critical' || i.severity === 'high');
                if (topIssue) lines.push(`  _${topIssue.message || topIssue.title || topIssue.code}_`);
            });
            lines.push('');
        }

        const topScored = best.filter((p: any) => p.score >= 85);
        if (topScored.length) {
            lines.push('### Pages Performing Well');
            topScored.forEach((p: any) => {
                const path = (() => { try { return new URL(p.url).pathname || '/'; } catch { return p.url; } })();
                lines.push(`- ${CHECK} **${path}** — ${p.score}/100`);
            });
            lines.push('');
        }
    }

    // ── Check Coverage Summary ────────────────────────────────────────────────
    // Aggregate check pass rates across pages
    const CHECK_KEYS = ['og_image', 'og_title', 'og_description', 'og_image_quality', 'meta_description', 'canonical'];
    const checkCounts: Record<string, { pass: number; total: number }> = {};
    for (const p of pages) {
        if (!p.checks) continue;
        for (const key of CHECK_KEYS) {
            if (!(key in p.checks)) continue;
            const result = p.checks[key];
            if (!checkCounts[key]) checkCounts[key] = { pass: 0, total: 0 };
            checkCounts[key].total++;
            if (result?.status === 'pass') checkCounts[key].pass++;
        }
    }
    const checkEntries = Object.entries(checkCounts).filter(([, v]) => v.total > 0);
    if (checkEntries.length) {
        lines.push('### Open Graph Coverage');
        checkEntries
            .sort(([, a], [, b]) => (a.pass / a.total) - (b.pass / b.total))
            .forEach(([key, { pass, total }]) => {
                const pct   = Math.round((pass / total) * 100);
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                const bar   = `${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))}`;
                const status = pct >= 80 ? CHECK : pct >= 50 ? '~' : '✗';
                lines.push(`- ${status} **${label}**: ${bar} ${pct}% (${pass}/${total} pages)`);
            });
    }

    return {
        markdown:   truncate(lines.join('\n'), 10000),
        structured: report,
    };
}

export function formatPagePreview(result: any): FormatResult {
    const { url, score, scoreLabel, summary, issues = [], previews } = result;
    const domain = domainFromUrl(url);

    const lines = [
        `## Page Audit Preview`,
        `**${domain}**`,
        `\`${url}\``,
        '',
        `Score: ${scoreBar(score)} — ${scoreLabel || ''}`,
        '',
        metaLine([
            summary?.criticalIssues ? `${summary.criticalIssues} CRITICAL` : null,
            summary?.totalIssues    ? `${summary.totalIssues} total` : null,
            summary?.passedChecks   ? `${summary.passedChecks} passed` : null,
        ]),
    ];

    const highIssues = issues.filter((i: any) => i.severity === "critical" || i.severity === "high");
    if (highIssues.length) {
        lines.push('', '### Issues');
        highIssues.slice(0, 8).forEach((i: any) => {
            lines.push(`- **${i.severity?.toUpperCase() || 'ISSUE'}**: ${i.message || i.title || i.code}`);
        });
    }

    // Show which social platforms are well covered
    if (previews) {
        const platforms = ['facebook', 'twitter', 'linkedin', 'google'] as const;
        const present = platforms.filter((p) => previews[p]?.title);
        if (present.length) lines.push('', `${CHECK} Previews available for: ${present.join(', ')}`);
    }

    return {
        markdown:   lines.join('\n'),
        structured: result,
    };
}

// ---------------------------------------------------------------------------
// formatLinkPreview
// ---------------------------------------------------------------------------

const PLATFORM_CHECK = '✓';
const PLATFORM_CROSS = '✗';

function previewField(label: string, value: string | null | undefined, fallback = '_(not set)_'): string {
    return `**${label}**: ${value || fallback}`;
}

export function formatLinkPreview(result: any): FormatResult {
    const { url, score, scoreLabel, issues = [], previews } = result;
    const domain = domainFromUrl(url);

    const fb  = previews?.facebook  ?? {};
    const tw  = previews?.twitter   ?? {};
    const li  = previews?.linkedin  ?? {};
    const goo = previews?.google    ?? {};

    const lines: string[] = [
        `## Link Preview — ${domain}`,
        `\`${url}\``,
        '',
        `Score: ${scoreBar(score)} — ${scoreLabel || ''}`,
        '',
        '---',
        '',
    ];

    // Facebook & LinkedIn share the same OG tags
    lines.push('### Facebook & LinkedIn');
    lines.push(previewField('Title',       fb.title       ?? li.title));
    lines.push(previewField('Description', fb.description ?? li.description));
    if (fb.imageUrl) {
        const status = fb.imageStatus && fb.imageStatus !== 'ok' ? ` _(${fb.imageStatus})_` : '';
        lines.push(`**Image**: ${fb.imageUrl}${status}`);
    } else {
        lines.push(`**Image**: _(not set)_`);
    }
    lines.push(previewField('Domain', fb.domain ?? domain));
    lines.push('');

    // Twitter / X
    lines.push('### Twitter / X');
    lines.push(previewField('Card type',   tw.cardType));
    lines.push(previewField('Title',       tw.title));
    lines.push(previewField('Description', tw.description));
    if (tw.imageUrl) {
        const status = tw.imageStatus && tw.imageStatus !== 'ok' ? ` _(${tw.imageStatus})_` : '';
        lines.push(`**Image**: ${tw.imageUrl}${status}`);
    } else {
        lines.push(`**Image**: _(not set)_`);
    }
    lines.push('');

    // Google Search
    lines.push('### Google Search');
    lines.push(previewField('Title',           goo.title));
    lines.push(previewField('Description',     goo.metaDescription));
    lines.push(previewField('URL',             goo.url ?? url));
    const sdIcon = goo.hasStructuredData ? PLATFORM_CHECK : PLATFORM_CROSS;
    lines.push(`**Structured data**: ${sdIcon} ${goo.hasStructuredData ? 'Present' : 'Not detected'}`);
    lines.push('');
    lines.push('---');

    // Issues
    const allIssues = Array.isArray(issues) ? issues : [];
    const criticalIssues  = allIssues.filter((i: any) => i.severity === 'critical');
    const warningIssues   = allIssues.filter((i: any) => i.severity === 'warning' || i.severity === 'high');
    const displayIssues   = [...criticalIssues, ...warningIssues].slice(0, 10);

    if (displayIssues.length) {
        lines.push('', `### Issues (${allIssues.length} found)`);
        displayIssues.forEach((i: any) => {
            const sev = i.severity?.toUpperCase() || 'ISSUE';
            const msg = i.message || i.title || i.code || 'Unknown issue';
            lines.push(`- **${sev}**: ${msg}`);
        });
    } else {
        lines.push('', `${PLATFORM_CHECK} No critical issues found.`);
    }

    // Build structured platforms object matching the tool outputSchema
    const platforms = {
        facebook: fb.title !== undefined ? fb : undefined,
        twitter:  tw.title !== undefined ? tw : undefined,
        linkedin: li.title !== undefined ? li : undefined,
        google:   goo.title !== undefined ? goo : undefined,
    };

    return {
        markdown:   lines.join('\n'),
        structured: {
            url,
            score,
            scoreLabel,
            platforms,
            issues: allIssues,
        },
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
