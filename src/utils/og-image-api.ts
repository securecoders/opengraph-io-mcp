import { getBaseUrl } from "@/utils/og";
import { serviceUrl } from "@/utils/serviceUrl";
import {
    IMAGE_AGENT_TIMEOUT_MS,
    fetchWithTimeout,
    pathSegment,
    readBytes,
    readErrorBody,
    readJson,
    upstreamDetail,
} from "@/utils/http";

const SERVICE = "The image generation API";

const imageFetch = (url: string, init: RequestInit): Promise<Response> =>
    fetchWithTimeout(SERVICE, url, init, IMAGE_AGENT_TIMEOUT_MS);

async function throwFailed(action: string, response: Response): Promise<never> {
    const detail = upstreamDetail(await readErrorBody(SERVICE, response), response.status);
    throw new Error(`Failed to ${action}: ${detail || response.statusText || `status ${response.status}`}`);
}

/**
 * Get the base URL for the og-image-agent API
 * 
 * Priority:
 * 1. OG_IMAGE_AGENT_URL — direct override (e.g. http://localhost:8000 for local dev)
 * 2. OG_BASE_URL + /image-agent — production default (e.g. https://opengraph.io/image-agent)
 */
const getImageAgentBaseUrl = (): string => {
    return serviceUrl('OG_IMAGE_AGENT_URL', `${getBaseUrl()}/image-agent`);
};

/**
 * Get app_id from explicit parameter or environment variable
 */
const getAppId = (app_id?: string): string => {
    return app_id || process.env.APP_ID || process.env.OPENGRAPH_APP_ID || '';
};

/**
 * Common headers for API requests
 */
const getHeaders = (): Record<string, string> => {
    return {
        "Content-Type": "application/json",
        "Referrer": "mcp"
    };
};

/** URLSearchParams encodes the value, so an app id cannot add or replace other parameters. */
export const withAppId = (url: string, app_id?: string): string => {
    const appId = getAppId(app_id);
    if (!appId) return url;
    const parsed = new URL(url);
    parsed.searchParams.set('app_id', appId);
    return parsed.toString();
};

// ============================================
// Type definitions for API responses
// ============================================

export interface SessionResponse {
    sessionId: string;
    name: string | null;
    createdAt: string;
}

export interface GenerateResponse {
    sessionId: string;
    assetId: string;
    status: "pending" | "succeeded" | "failed";
    format?: string;
    width?: number;
    height?: number;
    url?: string;
    error?: string;
    usage?: {
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCost: number;
    };
}

export interface IterateResponse {
    sessionId: string;
    assetId: string;
    parentAssetId: string;
    status: "pending" | "succeeded" | "failed";
    format?: string;
    width?: number;
    height?: number;
    url?: string;
    error?: string;
    usage?: {
        totalInputTokens: number;
        totalOutputTokens: number;
        totalCost: number;
    };
}

export interface AssetInfo {
    assetId: string;
    sessionId: string;
    parentAssetId?: string | null;
    prompt: string;
    kind: string;
    toolchain: string;
    status: string;
    createdAt: string;
    completedAt?: string | null;
    format?: string;
    width?: number;
    height?: number;
    url?: string;
    error?: string;
}

export interface SessionDetails {
    sessionId: string;
    name: string | null;
    createdAt: string;
    updatedAt: string;
    status: string;
    assetCount?: number;
    assets: AssetInfo[];
}

// ============================================
// Generate request parameters
// ============================================

export interface GenerateParams {
    prompt?: string;
    kind?: "illustration" | "diagram" | "icon" | "social-card" | "qr-code";
    diagramSyntax?: "mermaid" | "d2" | "vega";
    diagramCode?: string;
    diagramFormat?: "mermaid" | "d2" | "vega";
    template?: string;
    templateData?: Record<string, unknown>;
    labels?: string[];
    model?: string;
    quality?: "low" | "medium" | "high" | "fast";
    format?: "png" | "svg" | "jpeg" | "webp";
    transparent?: boolean;
    width?: number;
    height?: number;
    // Presets
    aspectRatio?: string;
    stylePreset?: string;
    diagramTemplate?: string;
    // AI context
    projectContext?: string;
    brandColors?: string[];
    stylePreferences?: string;
    referenceAssetId?: string;
    // Cropping
    autoCrop?: boolean;
    autoCropPadding?: number;
    cropX1?: number;
    cropY1?: number;
    cropX2?: number;
    cropY2?: number;
    // Polish
    cornerRadius?: number;
    outputStyle?: "draft" | "standard" | "premium";
    layoutPreservation?: "strict" | "flexible" | "creative";
}

export interface IterateParams {
    assetId: string;
    prompt: string;
    cropX1?: number;
    cropY1?: number;
    cropX2?: number;
    cropY2?: number;
}

// ============================================
// API functions
// ============================================

/**
 * Create a new session
 */
export const createSession = async (name?: string, app_id?: string): Promise<SessionResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await imageFetch(withAppId(`${baseUrl}/sessions`, app_id), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
    });
    
    if (!response.ok) await throwFailed("create session", response);
    
    return readJson<SessionResponse>(SERVICE, response);
};

/**
 * Generate a new image in a session
 */
export const generateImage = async (sessionId: string, params: GenerateParams, app_id?: string): Promise<GenerateResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await imageFetch(withAppId(`${baseUrl}/sessions/${pathSegment(sessionId)}/generate`, app_id), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(params),
    });
    
    if (!response.ok) await throwFailed("generate image", response);
    
    return readJson<GenerateResponse>(SERVICE, response);
};

/**
 * Iterate on an existing image
 */
export const iterateImage = async (sessionId: string, params: IterateParams, app_id?: string): Promise<IterateResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await imageFetch(withAppId(`${baseUrl}/sessions/${pathSegment(sessionId)}/iterate`, app_id), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(params),
    });
    
    if (!response.ok) await throwFailed("iterate image", response);
    
    return readJson<IterateResponse>(SERVICE, response);
};

/**
 * Get session details including all assets
 */
export const getSession = async (sessionId: string, app_id?: string): Promise<SessionDetails> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await imageFetch(withAppId(`${baseUrl}/sessions/${pathSegment(sessionId)}`, app_id), {
        method: "GET",
        headers: getHeaders(),
    });
    
    if (!response.ok) await throwFailed("get session", response);
    
    return readJson<SessionDetails>(SERVICE, response);
};

/**
 * Get asset file as a Buffer
 */
export const getAssetFile = async (assetId: string, app_id?: string): Promise<{ data: Buffer; contentType: string; format: ImageKind["format"] }> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await imageFetch(withAppId(`${baseUrl}/assets/${pathSegment(assetId)}/file`, app_id), {
        method: "GET",
        headers: getHeaders(),
    });
    
    if (!response.ok) await throwFailed("get asset file", response);
    
    const data = await readBytes(SERVICE, response);
    const kind = sniffImage(data);
    if (!kind) throw new Error("Failed to get asset file: not a recognised image.");
    return { data, contentType: kind.mime, format: kind.format };
};

export interface ImageKind {
    mime:   "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
    format: "PNG" | "JPEG" | "WEBP" | "SVG";
}

/**
 * The type comes from the bytes, never the upstream Content-Type: a mislabelled
 * SVG would otherwise reach a client as a raster image it renders.
 */
export function sniffImage(data: Buffer): ImageKind | null {
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return { mime: "image/png", format: "PNG" };
    }
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
        return { mime: "image/jpeg", format: "JPEG" };
    }
    if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") {
        return { mime: "image/webp", format: "WEBP" };
    }
    const head = data.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if ((head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) && head.includes("<svg")) {
        return { mime: "image/svg+xml", format: "SVG" };
    }
    return null;
}

export const SVG_NOT_INLINE =
    "SVG is not returned inline because it can carry script. Use exportImageAsset with a destinationPath (local only), or the asset url.";

/** Every path that hands image bytes to a client goes through here; SVG never does. */
export function inlineImage(file: { data: Buffer; contentType: string; format: ImageKind["format"] }):
    { type: "image"; data: string; mimeType: string } | null {
    if (file.format === "SVG") return null;
    return { type: "image", data: file.data.toString("base64"), mimeType: file.contentType };
}

/**
 * Loads an asset only if the image session lists it, under the caller's key.
 * A bare 200 from the asset endpoint says the asset exists, not that it belongs
 * to the session the caller named; ownership itself is the image agent's to enforce.
 */
export const getSessionAsset = async (
    sessionId: string,
    assetId: string,
    app_id?: string,
): Promise<{ data: Buffer; contentType: string; format: ImageKind["format"] }> => {
    const session = await getSession(sessionId, app_id);
    if (!(session.assets ?? []).some((a) => a.assetId === assetId)) {
        throw new Error(`Asset ${assetId} is not in session ${sessionId}.`);
    }
    return getAssetFile(assetId, app_id);
};

/**
 * Helper: Create session and generate image in one call
 */
export const createAndGenerate = async (params: GenerateParams, sessionName?: string, app_id?: string): Promise<{
    session: SessionResponse;
    result: GenerateResponse;
}> => {
    const session = await createSession(sessionName, app_id);
    const result = await generateImage(session.sessionId, params, app_id);
    return { session, result };
};
