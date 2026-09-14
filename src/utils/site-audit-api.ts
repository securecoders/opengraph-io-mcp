/**
 * HTTP client for OpenGraph.io Site Audit calls via apifur-api.
 *
 * All requests require a valid OAuth 2.1 Bearer token (the MCP access token
 * issued by apifur-api). The token is forwarded as the Authorization header
 * so apifur-api can authenticate the caller and enforce plan/tier gating.
 *
 * Base URL is controlled by SITE_AUDIT_API_URL (defaults to production).
 */

import dotenv from "dotenv";

dotenv.config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const getSiteAuditBaseUrl = (): string =>
    process.env.SITE_AUDIT_API_URL || "https://dashboard-api.opengraph.io";

// ---------------------------------------------------------------------------
// Shared types (minimal — controllers define the full shapes)
// ---------------------------------------------------------------------------

export type AuditStatus = "QUEUED" | "CRAWLING" | "SCORING" | "COMPLETE" | "FAILED";

export interface AuditSummary {
    id: string;
    domain: string;
    status: AuditStatus;
    score?: number | null;
    pagesRequested: number;
    pagesFetched?: number | null;
    pagesAudited?: number | null;
    criticalIssues?: number | null;
    totalIssues?: number | null;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    errorMessage?: string | null;
}

export interface CreateAuditResult {
    audit: AuditSummary;
    clamp?: {
        field: string;
        requested: number;
        applied: number;
        remaining?: number;
    };
}

export interface PreviewResult {
    url:       string;
    score:     number;
    scoreLabel: string;
    summary:   { totalIssues: number; criticalIssues: number; warningIssues: number; passedChecks: number };
    checks:    Record<string, any>;
    issues:    any[];
    previews?: any;
    hybridGraph?: any;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/** Drops undefined/null/empty entries so optional filters don't become "undefined". */
function toQuery(params: Record<string, unknown> = {}): string {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        qs.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    const out = qs.toString();
    return out ? `?${out}` : "";
}

async function apiRequest<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    accessToken: string,
    body?: unknown,
    query?: Record<string, unknown>,
    responseType: "json" | "text" = "json",
): Promise<T> {
    const url = `${getSiteAuditBaseUrl()}${path}${toQuery(query)}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: responseType === "text" ? "text/csv, text/plain" : "application/json",
    };

    const response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
        let errorBody: any;
        try {
            errorBody = await response.json();
        } catch {
            errorBody = { error: { message: response.statusText } };
        }
        const message =
            (errorBody?.error?.message) ||
            (errorBody?.message) ||
            `Request failed with status ${response.status}`;
        const err = new Error(message) as any;
        err.status = response.status;
        err.code   = errorBody?.error?.code;
        throw err;
    }

    // Deletes answer 204 with no body; calling .json() on that throws.
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    // CSV export is not JSON — parsing it would throw on the first comma.
    if (responseType === "text") return text as T;
    return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export interface DiscoveredUrl {
    url:      string;
    source:   "sitemap" | "crawl" | string;
    depth:    number;
    lastmod?: string | null;
}

export interface DiscoverResult {
    domain:          string;
    homepageUrl?:    string;
    totalFound:      number;
    urls:            DiscoveredUrl[];
    siteContext?:    { concatenatedText: string };
    remainingQuota?: number | null;
}

/**
 * Discover URLs on a domain via crawling and sitemap parsing.
 * Returns the full URL list plus homepage context text used to enrich
 * the AI analysis when you pass it to createAudit.
 */
export const discoverSiteUrls = async (
    organizationId: string,
    url: string,
    accessToken: string,
): Promise<DiscoverResult> =>
    apiRequest("POST", "/api/v1/site-audit/discover", accessToken, {
        organizationId,
        url,
    });

/**
 * Start a new site audit. Returns immediately (202) with the initial audit
 * record. Poll getSiteAuditStatus until status is COMPLETE or FAILED.
 *
 * Pass `urls` (from discoverSiteUrls) and `siteContextText` to get the same
 * enriched AI analysis the UI produces. Both are optional — if omitted,
 * og-site-audit crawls the domain internally.
 */
export const createAudit = async (
    organizationId: string,
    domain: string,
    pagesRequested: number = 10,
    accessToken: string,
    urls?: string[],
    siteContextText?: string,
): Promise<CreateAuditResult> =>
    apiRequest("POST", "/api/v1/site-audit/audits", accessToken, {
        organizationId,
        domain,
        pagesRequested,
        ...(urls && urls.length > 0 ? { urls } : {}),
        ...(siteContextText ? { siteContext: { concatenatedText: siteContextText } } : {}),
    });

/**
 * Poll the status of an existing audit. Returns the full audit row with
 * current status, progress counters, and summary stats (once complete).
 */
export const getAuditStatus = async (
    auditId: string,
    accessToken: string,
): Promise<{ audit: AuditSummary }> =>
    apiRequest("GET", `/api/v1/site-audit/audits/${auditId}`, accessToken);

/**
 * Retrieve the full structured report for a completed audit.
 * Returns 404 if the audit is not yet in COMPLETE status.
 */
export const getAuditReport = async (
    auditId: string,
    accessToken: string,
): Promise<{ report: any }> =>
    apiRequest("GET", `/api/v1/site-audit/audits/${auditId}/report`, accessToken);

/**
 * Run a fast, synchronous audit of a single URL.
 * Returns a score, issues, check results, and social previews immediately.
 * Suitable for quick quality checks without starting a full async audit.
 *
 * Routes through the existing /api/v1/link-preview gateway which enforces
 * the linkPreview feature flag, tier rate limits, and billing counters —
 * the same path used by the marketing dashboard.
 */
export const previewPage = async (
    organizationId: string,
    url: string,
    accessToken: string,
): Promise<PreviewResult> =>
    apiRequest("POST", "/api/v1/link-preview", accessToken, {
        organizationId,
        url,
    });

// ---------------------------------------------------------------------------
// History and change reporting
// ---------------------------------------------------------------------------

export interface ListAuditsParams {
    limit?:     number;
    offset?:    number;
    q?:         string;
    status?:    string[];
    from?:      string;
    to?:        string;
    sort?:      string;
    websiteId?: string;
}

export interface ListAuditsResult {
    audits: AuditSummary[];
    total?: number;
    limit?: number;
    offset?: number;
}

/**
 * Page through an organization's past audits. The gateway answers
 * 400 MISSING_ORG_ID without an organizationId, so it is always sent.
 */
export const listAudits = async (
    organizationId: string,
    accessToken: string,
    params: ListAuditsParams = {},
): Promise<ListAuditsResult> =>
    // organizationId last: the token's org must win even if a caller's params
    // carry one, so tenant pinning does not depend on zod stripping the key.
    apiRequest("GET", "/api/v1/site-audit/audits", accessToken, undefined, {
        ...params,
        organizationId,
    });

/** Issue-level change report for an audit against its baseline. */
export const getAuditDiff = async (
    auditId: string,
    accessToken: string,
    baseline?: string,
): Promise<any> =>
    apiRequest("GET", `/api/v1/site-audit/audits/${auditId}/diff`, accessToken, undefined, { baseline });

/** Issues grouped into fix-first / fix-as-pattern / review-next / low-priority. */
export const getAuditPriorities = async (
    auditId: string,
    accessToken: string,
): Promise<any> =>
    apiRequest("GET", `/api/v1/site-audit/audits/${auditId}/priorities`, accessToken);

// ---------------------------------------------------------------------------
// Website health and recurring monitoring
// ---------------------------------------------------------------------------

export interface ListWebsitesParams {
    limit?:      number;
    offset?:     number;
    q?:          string;
    sort?:       string;
    health?:     string;
    monitoring?: string;
}

/** Websites the org has audited, with denormalized health signals. */
export const listWebsites = async (
    organizationId: string,
    accessToken: string,
    params: ListWebsitesParams = {},
): Promise<any> =>
    apiRequest("GET", "/api/v1/site-audit/websites", accessToken, undefined, {
        ...params,
        organizationId,
    });

export const getWebsite = async (
    websiteId: string,
    organizationId: string,
    accessToken: string,
): Promise<any> =>
    apiRequest("GET", `/api/v1/site-audit/websites/${websiteId}`, accessToken, undefined, { organizationId });

export const getSchedule = async (
    websiteId: string,
    organizationId: string,
    accessToken: string,
): Promise<any> =>
    apiRequest("GET", `/api/v1/site-audit/websites/${websiteId}/schedule`, accessToken, undefined, { organizationId });

/**
 * Create or replace a website's recurring-audit schedule.
 *
 * organizationId travels in the BODY here, unlike the sibling reads which take
 * it as a query parameter. `recipients` is deliberately absent — the gateway
 * rejects it on a bearer connection.
 */
export const putSchedule = async (
    websiteId: string,
    organizationId: string,
    accessToken: string,
    schedule: Record<string, unknown>,
): Promise<any> =>
    apiRequest("PUT", `/api/v1/site-audit/websites/${websiteId}/schedule`, accessToken, {
        ...schedule,
        organizationId,
    });

/** Remove a schedule entirely. Answers 204. */
export const deleteSchedule = async (
    websiteId: string,
    organizationId: string,
    accessToken: string,
): Promise<void> =>
    apiRequest("DELETE", `/api/v1/site-audit/websites/${websiteId}/schedule`, accessToken, undefined, { organizationId });

/** Org identity and site-audit entitlements for the connected token. */
export const getConnectionContext = async (accessToken: string): Promise<any> =>
    apiRequest("GET", "/api/v1/site-audit/context", accessToken);

// ---------------------------------------------------------------------------
// Fix list and destructive actions
// ---------------------------------------------------------------------------

export interface FixItemInput {
    field:           string;
    proposedValue:   string;
    kind?:           "edit" | "note";
    originalValue?:  string;
    recommendation?: string;
    issueCode?:      string;
    issueTitle?:     string;
    severity?:       string;
    source?:         "manual" | "ai" | "suggested";
}

export const listFixItems = async (auditId: string, accessToken: string): Promise<any> =>
    apiRequest("GET", `/api/v1/site-audit/audits/${auditId}/fix-items`, accessToken);

/**
 * Upsert fix items for one page. The gateway rejects a blank or unchanged
 * proposedValue on an API connection, because upstream treats that as a delete.
 */
export const upsertFixItems = async (
    auditId: string,
    accessToken: string,
    pageUrl: string,
    items: FixItemInput[],
): Promise<any> =>
    apiRequest("POST", `/api/v1/site-audit/audits/${auditId}/fix-items`, accessToken, { pageUrl, items });

export const deleteFixItem = async (
    auditId: string,
    fixItemId: string,
    accessToken: string,
): Promise<void> =>
    apiRequest("DELETE", `/api/v1/site-audit/audits/${auditId}/fix-items/${fixItemId}`, accessToken);

/** Returns raw CSV text, not JSON. */
export const exportFixItemsCsv = async (auditId: string, accessToken: string): Promise<string> =>
    apiRequest("GET", `/api/v1/site-audit/audits/${auditId}/fix-items/export.csv`, accessToken, undefined, undefined, "text");

/** Permanently removes an audit and its results. Answers 204. */
export const deleteAudit = async (auditId: string, accessToken: string): Promise<void> =>
    apiRequest("DELETE", `/api/v1/site-audit/audits/${auditId}`, accessToken);

/**
 * Emails the audit report as PDF attachments. The recipient is fixed to the
 * authenticated account by the gateway — no address is sent from here.
 */
export const emailAuditReport = async (auditId: string, accessToken: string): Promise<any> =>
    apiRequest("POST", `/api/v1/site-audit/audits/${auditId}/email`, accessToken, {});
