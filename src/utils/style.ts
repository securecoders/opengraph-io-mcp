/**
 * OpenGraph.io brand style primitives for MCP Markdown responses.
 *
 * Mirrors the og-next-ui "URL Intelligence Platform" design language
 * (June 2026 overhaul) translated into plain Markdown text:
 *   - ✓ for present/good states; → for next-step pointers
 *   - UPPERCASE severity words; Title Case status labels
 *   - Backticked OG tag names (`og:image`)
 *   - Middot · as meta-fact separator
 *   - Score as n/100
 *   - No sales CTAs; no other emoji
 */

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

export const CHECK = '✓';
export const ARROW = '→';
export const MIDDOT = '·';

// ---------------------------------------------------------------------------
// Status labels (Title Case) — mirrors linkPreviewAnalysis.ts
// ---------------------------------------------------------------------------

export const STATUS_LABELS = {
    excellent:        'Excellent',
    good:             'Good',
    fair:             'Fair',
    needs_improvement:'Needs Improvement',
    poor:             'Poor',
    critical:         'Critical',
} as const;

export type StatusKey = keyof typeof STATUS_LABELS;

// ---------------------------------------------------------------------------
// Severity labels (UPPERCASE) — mirrors site-audit badge conventions
// ---------------------------------------------------------------------------

export const SEVERITY_LABELS = {
    critical: 'CRITICAL',
    high:     'HIGH',
    medium:   'MEDIUM',
    low:      'LOW',
    info:     'INFO',
} as const;

export type SeverityKey = keyof typeof SEVERITY_LABELS;

// ---------------------------------------------------------------------------
// Presence / coverage vocabulary — Title Case (for use in tag field rows)
// ---------------------------------------------------------------------------

export const PRESENCE = {
    found:   'Found',
    partial: 'Partial',
    missing: 'Missing',
} as const;

export type PresenceKey = keyof typeof PRESENCE;

// ---------------------------------------------------------------------------
// Formatter helpers
// ---------------------------------------------------------------------------

/** Format a numeric score as "n/100". */
export function scoreLine(n: number): string {
    return `${Math.round(n)}/100`;
}

/**
 * Join non-empty parts with the middot separator.
 * e.g. metaLine(['1366×768', 'JPEG', 'cached']) → '1366×768 · JPEG · cached'
 */
export function metaLine(parts: Array<string | null | undefined>): string {
    return parts.filter((p): p is string => !!p && p.trim() !== '').join(` ${MIDDOT} `);
}

/**
 * Wrap a tag or field name in backticks.
 * e.g. tag('og:image') → '`og:image`'
 */
export function tag(name: string): string {
    return `\`${name}\``;
}

/**
 * Produce a "→ text" next-step pointer line (no trailing newline).
 * Only use this when a next step is genuinely useful.
 */
export function nextStep(text: string): string {
    return `${ARROW} ${text}`;
}

/**
 * Truncate text to `cap` characters, appending a marker when truncated.
 * The full content is always available in structuredContent.
 */
export function truncate(text: string, cap: number): string {
    if (text.length <= cap) return text;
    return text.slice(0, cap) + `\n\n… _(truncated — full content available in structured output)_`;
}

/**
 * Extract a domain label from a URL string for display in response headings.
 * Falls back to the raw URL if parsing fails.
 */
export function domainFromUrl(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

/**
 * Render a `requestInfo.is_cache` flag as a human-readable freshness label.
 */
export function freshnessLabel(isCached: boolean | undefined): string {
    return isCached ? 'cached' : 'fresh';
}

/**
 * Resolve a status key (from og-api requestInfo or hybridGraph) to a
 * Title Case label, with a fallback for unknown values.
 */
export function statusLabel(key: string | undefined): string {
    if (!key) return '';
    return STATUS_LABELS[key as StatusKey] ?? key;
}

/**
 * Render a field presence row for a Markdown list:
 *   "- **Title** — `og:title` · Found"
 *   "- **Image** — `og:image` · Missing"
 */
export function fieldRow(label: string, tagName: string, value: string | null | undefined): string {
    const presence = value ? PRESENCE.found : PRESENCE.missing;
    const check    = value ? `${CHECK} ` : '';
    const display  = value ? `: ${truncate(String(value), 120)}` : '';
    return `- **${label}** — ${tag(tagName)} · ${check}${presence}${display}`;
}
