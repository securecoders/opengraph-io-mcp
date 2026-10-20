import { z } from "zod";

const MAX_URL_LENGTH = 2048;
/** og-site-audit's own ceiling on pages per audit. */
export const MAX_AUDIT_PAGES = 500;
/** Longer lists are fine (apifur-api trims to quota); this only bounds the payload. */
export const MAX_AUDIT_URL_LIST = 5_000;
/** discoverSiteUrls returns homepage text unbounded; this only stops an absurd payload. */
export const MAX_SITE_CONTEXT_CHARS = 1_000_000;

const HTTP_SCHEME = /^https?:\/\//i;

/** The upstreams only fetch http(s); any other scheme is a mistake or an injection. */
export const httpUrl = () =>
    z.string().max(MAX_URL_LENGTH).url().regex(HTTP_SCHEME, "Must be an http:// or https:// URL.");

/** Accepts a bare host (`example.com`) or an http(s) URL, matching what apifur-api takes. */
export const siteDomain = () =>
    z.string().min(1).max(MAX_URL_LENGTH).refine(
        (v) => toSiteUrl(v) !== null,
        "Must be a domain such as example.com, or an http:// or https:// URL.",
    );

function toSiteUrl(value: string): URL | null {
    const trimmed = value.trim();
    // Anything with a scheme must be http(s); a bare host gets https.
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^:/]+:\d+(\/|$)/.test(trimmed);
    if (hasScheme && !HTTP_SCHEME.test(trimmed)) return null;
    try {
        const url = new URL(HTTP_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
        return url.hostname ? url : null;
    } catch {
        return null;
    }
}

const bareHostname = (hostname: string): string => hostname.replace(/^www\./i, "").toLowerCase();

/**
 * Mirrors apifur-api's `sameHostname` (server/controllers/siteAuditLogic.js), which
 * rejects the whole audit if any URL is off-domain. Checking here first names the
 * offending URLs instead of spending a round trip to learn the same thing.
 */
export function isUnderDomain(candidate: string, domain: string): boolean {
    const a = toSiteUrl(candidate);
    const b = toSiteUrl(domain);
    if (!a || !b) return false;
    return bareHostname(a.hostname) === bareHostname(b.hostname);
}
