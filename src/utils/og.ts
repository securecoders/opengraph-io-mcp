import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// ---------------------------------------------------------------------------
// Base URL + App ID resolution
// ---------------------------------------------------------------------------

export const getBaseUrl = (): string => {
    return process.env.OG_BASE_URL || 'https://opengraph.io';
};

const getAppId = (app_id?: string): string => {
    return app_id || process.env.APP_ID || process.env.OPENGRAPH_APP_ID || '';
};

// ---------------------------------------------------------------------------
// API version map — single place to control which version each capability
// hits.  `extract` stays on 1.1 (no v3 GET route exists).
// `query` stays on 1.1 until og-api's billing path check is updated for 3.0.
// ---------------------------------------------------------------------------

export const API_VERSIONS = {
    site:       '3.0',
    scrape:     '3.0',
    screenshot: '3.0',
    markdown:   '3.0',
    query:      '1.1',   // billing path check in requestCount.js is v1.1-only
    extract:    '1.1',   // no v3 GET route; only POST /api/3.0/extract exists
} as const;

// ---------------------------------------------------------------------------
// Option interfaces
// ---------------------------------------------------------------------------

/** Shared fetch/proxy options available on all scraping endpoints. */
export interface CommonOgOptions {
    // Cache
    cache_ok?: boolean;
    max_cache_age?: number;
    // Rendering
    full_render?: boolean;
    auto_render?: boolean;
    wait_for_selector?: string;
    scroll_to_bottom?: boolean;
    load_more_selector?: string;
    load_more_clicks?: number;
    load_more_wait?: number;
    load_more_item_selector?: string;
    load_more_scroll?: boolean;
    // Language
    accept_lang?: string;
    // Proxy / retry
    use_proxy?: boolean;
    use_premium?: boolean;
    use_superior?: boolean;
    proxy_country?: string;
    auto_proxy?: boolean;
    retry?: boolean;
    max_retries?: number;
    retry_escalate?: boolean;
    // AI sanitizer
    ai_sanitize?: boolean;
    ai_sanitize_mode?: 'sanitize' | 'warn' | 'block';
}

/** Additional options exclusive to the /sites (OG data) endpoint. */
export interface SiteOptions extends CommonOgOptions {
    use_ai?: boolean;
}

export interface ScreenshotOptions extends CommonOgOptions {
    full_page?: boolean;
    format?: string;
    dimensions?: string;
    quality?: number;
    dark_mode?: boolean;
    block_cookie_banner?: boolean;
    selector?: string;
    /** Comma-separated CSS selectors to hide before capture. */
    exclude_selectors?: string;
    /** Whether to hide matched selectors. */
    hideSelectors?: boolean;
    /** Delay in ms before capturing (og-api reads this as `captureDelay`). */
    capture_delay?: number;
    /** Navigation timeout in ms (1000–60000). */
    navigationTimeout?: number;
}

export interface QueryOptions extends CommonOgOptions {
    modelSize?: string;
}

export interface MarkdownOptions extends CommonOgOptions {
    /** Comma-separated CSS selectors — keep only matching elements. */
    include_tags?: string[];
    /** Comma-separated CSS selectors to remove; supports *regex* wildcards. */
    exclude_tags?: string[];
    /** Strip nav/header/footer/ads heuristics. Defaults to true server-side. */
    only_main_content?: boolean;
}

// ---------------------------------------------------------------------------
// Query parameter builder
// ---------------------------------------------------------------------------

function buildQueryParams(options: Record<string, any>, appId: string): string {
    const params = new URLSearchParams();
    params.set('app_id', appId);

    // Default accept_lang to 'auto' when not explicitly provided
    if (options.accept_lang === undefined) {
        params.set('accept_lang', 'auto');
    }

    for (const [key, value] of Object.entries(options)) {
        if (value === undefined || value === null) continue;

        // Rename capture_delay → captureDelay (og-api reads req.query.captureDelay)
        const paramKey = key === 'capture_delay' ? 'captureDelay' : key;

        // Array params: comma-join (include_tags, exclude_tags)
        if (Array.isArray(value)) {
            if (value.length > 0) {
                params.set(paramKey, value.join(','));
            }
        } else {
            params.set(paramKey, String(value));
        }
    }

    return params.toString();
}

// ---------------------------------------------------------------------------
// API client functions
// ---------------------------------------------------------------------------

/** Scrape raw HTML from a URL via /api/3.0/scrape. */
export const scrapeSite = async (
    url: string,
    app_id?: string,
    options: CommonOgOptions = {},
): Promise<string> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    const qs = buildQueryParams(options, actualAppId);
    const response = await fetch(
        `${getBaseUrl()}/api/${API_VERSIONS.scrape}/scrape/${encodeURIComponent(url)}?${qs}`,
        { headers: { "Referrer": "mcp" } },
    );
    return response.text();
};

const OGScreenshotResponseSchema = z.object({
    screenshotUrl: z.string(),
    message: z.string().optional(),
});

/** Capture a screenshot and return the hosted URL via /api/3.0/screenshot. */
export const getScreenshotUrl = async (
    url: string,
    app_id?: string,
    options: ScreenshotOptions = {},
): Promise<{ screenshotUrl: string; message?: string }> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    const qs = buildQueryParams(options, actualAppId);
    const response = await fetch(
        `${getBaseUrl()}/api/${API_VERSIONS.screenshot}/screenshot/${encodeURIComponent(url)}?${qs}`,
        { headers: { "Referrer": "mcp" } },
    );
    const data = await response.json();
    return OGScreenshotResponseSchema.parse(data);
};

/** Fetch OG / hybrid / HTML-inferred metadata via /api/3.0/site. */
export const getSiteOgData = async (
    url: string,
    app_id?: string,
    options: SiteOptions = {},
): Promise<{ hybridGraph: any; openGraph: any; htmlInferred: any; requestInfo?: any }> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    const qs = buildQueryParams(options, actualAppId);
    const response = await fetch(
        `${getBaseUrl()}/api/${API_VERSIONS.site}/site/${encodeURIComponent(url)}?${qs}`,
        { headers: { "Referrer": "mcp" } },
    );
    const data = await response.json() as {
        hybridGraph: any;
        openGraph: any;
        htmlInferred: any;
        requestInfo?: any;
    };
    return {
        hybridGraph:  data.hybridGraph,
        openGraph:    data.openGraph,
        htmlInferred: data.htmlInferred,
        requestInfo:  data.requestInfo,
    };
};

/** Ask a natural-language question about page content via /api/1.1/query. */
export const querySite = async (
    site: string,
    query: string,
    responseStructure?: any,
    app_id?: string,
    options: QueryOptions = {},
): Promise<any> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    const encodedSite = encodeURIComponent(site);
    const qs = buildQueryParams(options, actualAppId);
    const url = `${getBaseUrl()}/api/${API_VERSIONS.query}/query/${encodedSite}?${qs}`;
    const body: any = { query };
    if (responseStructure !== undefined) {
        body.responseStructure = responseStructure;
    }
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Referrer": "mcp" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`Query API request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
};

/** Extract HTML elements by tag name via /api/1.1/extract (GET). */
export const extractHtmlElements = async (
    url: string,
    html_elements: string[],
    app_id?: string,
    options: CommonOgOptions = {},
): Promise<any> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    const qs = buildQueryParams(
        { ...options, html_elements: html_elements.join(",") },
        actualAppId,
    );
    const response = await fetch(
        `${getBaseUrl()}/api/${API_VERSIONS.extract}/extract/${encodeURIComponent(url)}?${qs}`,
        { headers: { "Referrer": "mcp" } },
    );
    return response.json();
};

/** Convert a URL's HTML to clean Markdown via /api/3.0/markdown. */
export const getSiteMarkdown = async (
    url: string,
    app_id?: string,
    options: MarkdownOptions = {},
): Promise<string> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    const qs = buildQueryParams(options, actualAppId);
    const response = await fetch(
        `${getBaseUrl()}/api/${API_VERSIONS.markdown}/markdown/${encodeURIComponent(url)}?${qs}`,
        { headers: { "Referrer": "mcp" } },
    );
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Markdown API request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
    }
    return response.text();
};
