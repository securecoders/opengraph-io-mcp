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

async function apiRequest<T>(
    method: "GET" | "POST",
    path: string,
    accessToken: string,
    body?: unknown,
): Promise<T> {
    const url = `${getSiteAuditBaseUrl()}${path}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
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

    return response.json() as Promise<T>;
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
