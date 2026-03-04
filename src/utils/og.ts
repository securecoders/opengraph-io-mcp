import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Get base URL from environment variable with default
export const getBaseUrl = (): string => {
    return process.env.OG_BASE_URL || 'https://opengraph.io';
};

// Get app_id from environment variable if not provided explicitly
const getAppId = (app_id?: string): string => {
    return app_id || process.env.APP_ID || process.env.OPENGRAPH_APP_ID || '';
};

export interface CommonOgOptions {
    cache_ok?: boolean;
    max_cache_age?: number;
    full_render?: boolean;
    accept_lang?: string;
    use_proxy?: boolean;
    use_premium?: boolean;
    use_superior?: boolean;
}

export interface ScreenshotOptions extends CommonOgOptions {
    full_page?: boolean;
    format?: string;
    dimensions?: string;
    quality?: number;
    dark_mode?: boolean;
    block_cookie_banner?: boolean;
    selector?: string;
    exclude_selectors?: string;
    capture_delay?: number;
}

export interface QueryOptions extends CommonOgOptions {
    modelSize?: string;
}

function buildQueryParams(options: Record<string, any>, appId: string): string {
    const params = new URLSearchParams();
    params.set('app_id', appId);

    if (options.accept_lang === undefined) {
        params.set('accept_lang', 'auto');
    }

    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined && value !== null) {
            params.set(key, String(value));
        }
    }

    return params.toString();
}

export const scrapeSite = async (url: string, app_id?: string, options: CommonOgOptions = {}) => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }

    const qs = buildQueryParams(options, actualAppId);
    const response = await fetch(`${getBaseUrl()}/api/1.1/scrape/${encodeURIComponent(url)}?${qs}`, {
        headers: {
            "Referrer": "mcp"
        }
    })
    const data = await response.text()
    return data
}

const OGScrapeResponseSchema = z.object({
    screenshotUrl: z.string(),
    message: z.string().optional(),
})

export const getScreenshotUrl = async (url: string, app_id?: string, options: ScreenshotOptions = {}): Promise<string> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }

    const qs = buildQueryParams(options, actualAppId);
    const response = await fetch(`${getBaseUrl()}/api/1.1/screenshot/${encodeURIComponent(url)}?${qs}`, {
        headers: {
            "Referrer": "mcp"
        }
    })

    const data = await response.json();

    try {
        const parsedData = OGScrapeResponseSchema.parse(data);
        return parsedData.screenshotUrl;
    } catch (error) {
        console.error("Error parsing OG scrape response:", error);
        throw error;
    }
}

export const getSiteOgData = async (url: string, app_id?: string, options: CommonOgOptions = {}) => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }

    const qs = buildQueryParams(options, actualAppId);
    const response = await fetch(`${getBaseUrl()}/api/1.1/site/${encodeURIComponent(url)}?${qs}`, {
        headers: {
            "Referrer": "mcp"
        }
    })
    const data = await response.json() as { hybridGraph: any, openGraph: any, htmlInferred: any }
    const { hybridGraph, openGraph, htmlInferred } = data;
    return { hybridGraph, openGraph, htmlInferred }
}

export const querySite = async (site: string, query: string, responseStructure?: any, app_id?: string, options: QueryOptions = {}) => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    const encodedSite = encodeURIComponent(site);
    const qs = buildQueryParams(options, actualAppId);
    const url = `${getBaseUrl()}/api/1.1/query/${encodedSite}?${qs}`;
    const body: any = { query };
    if (responseStructure) {
        body.responseStructure = responseStructure;
    }
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Referrer": "mcp"
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error(`Query API request failed: ${response.status} ${response.statusText}`);
    }
    return await response.json();
}


export const extractHtmlElements  = async (url: string, html_elements: string[], app_id?: string, options: CommonOgOptions = {}) => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }

    const qs = buildQueryParams({ ...options, html_elements: html_elements.join(",") }, actualAppId);
    const response = await fetch(`${getBaseUrl()}/api/1.1/extract/${encodeURIComponent(url)}?${qs}`, {
        headers: {
            "Referrer": "mcp"
        }
    })
    const data = await response.json();
    return data
}
