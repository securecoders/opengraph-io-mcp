import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Get app_id from environment variable if not provided explicitly
const getAppId = (app_id?: string): string => {
    return app_id || process.env.APP_ID || process.env.OPENGRAPH_APP_ID || '';
};

export const scrapeSite = async (url: string, app_id?: string) => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    
    const response = await fetch(`https://opengraph.io/api/1.1/scrape/${encodeURIComponent(url)}?accept_lang=auto&app_id=${actualAppId}`)
    const data = await response.text()
    return data
}

const OGScrapeResponseSchema = z.object({
    screenshotUrl: z.string(),
    message: z.string().optional(),
})

export const getScreenshotUrl = async (url: string, app_id?: string): Promise<string> => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    
    const response = await fetch(`https://opengraph.io/api/1.1/screenshot/${encodeURIComponent(url)}?accept_lang=auto&quality=80&dimensions=md&full_page=true&app_id=${actualAppId}`)

    const data = await response.json();

    try {
        console.log("OG Scrape Response: ", data)
        const parsedData = OGScrapeResponseSchema.parse(data);
        return parsedData.screenshotUrl;
    } catch (error) {
        console.error("Error parsing OG scrape response:", error);
        throw error;
    }
}

export const getSiteOgData = async (url: string, app_id?: string) => {
    const actualAppId = getAppId(app_id);
    if (!actualAppId) {
        throw new Error("OpenGraph app_id is required. Provide it as an argument or set OPENGRAPH_APP_ID environment variable.");
    }
    
    const response = await fetch(`https://opengraph.io/api/1.1/site/${encodeURIComponent(url)}?accept_lang=auto&app_id=${actualAppId}`)
    const data = await response.json() as { hybridGraph: any, openGraph: any, htmlInferred: any }
    const { hybridGraph, openGraph, htmlInferred } = data;
    return { hybridGraph, openGraph, htmlInferred }
}