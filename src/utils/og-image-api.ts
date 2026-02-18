import { getBaseUrl } from "./og.js";

/**
 * Get the base URL for the og-image-agent API
 * 
 * Priority:
 * 1. OG_IMAGE_AGENT_URL — direct override (e.g. http://localhost:8000 for local dev)
 * 2. OG_BASE_URL + /image-agent — production default (e.g. https://opengraph.io/image-agent)
 */
const getImageAgentBaseUrl = (): string => {
    if (process.env.OG_IMAGE_AGENT_URL) {
        return process.env.OG_IMAGE_AGENT_URL.replace(/\/+$/, '');
    }
    return `${getBaseUrl()}/image-agent`;
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

/**
 * Append app_id as query parameter to URL
 */
const withAppId = (url: string, app_id?: string): string => {
    const appId = getAppId(app_id);
    if (!appId) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}app_id=${appId}`;
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

// Type for API error responses
interface ApiErrorResponse {
    error?: string;
}

/**
 * Create a new session
 */
export const createSession = async (name?: string, app_id?: string): Promise<SessionResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions`, app_id), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText })) as ApiErrorResponse;
        console.error("Image agent API: Failed to create session ", error);
        throw new Error(`Failed to create session: ${error.error || response.statusText}`);
    }
    
    return await response.json() as SessionResponse;
};

/**
 * Generate a new image in a session
 */
export const generateImage = async (sessionId: string, params: GenerateParams, app_id?: string): Promise<GenerateResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions/${sessionId}/generate`, app_id), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(params),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText })) as ApiErrorResponse;
        throw new Error(`Failed to generate image: ${error.error || response.statusText}`);
    }
    
    return await response.json() as GenerateResponse;
};

/**
 * Iterate on an existing image
 */
export const iterateImage = async (sessionId: string, params: IterateParams, app_id?: string): Promise<IterateResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions/${sessionId}/iterate`, app_id), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(params),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText })) as ApiErrorResponse;
        throw new Error(`Failed to iterate image: ${error.error || response.statusText}`);
    }
    
    return await response.json() as IterateResponse;
};

/**
 * Get session details including all assets
 */
export const getSession = async (sessionId: string, app_id?: string): Promise<SessionDetails> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions/${sessionId}`, app_id), {
        method: "GET",
        headers: getHeaders(),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText })) as ApiErrorResponse;
        throw new Error(`Failed to get session: ${error.error || response.statusText}`);
    }
    
    return await response.json() as SessionDetails;
};

/**
 * Get asset file as a Buffer
 */
export const getAssetFile = async (assetId: string, app_id?: string): Promise<{ data: Buffer; contentType: string }> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/assets/${assetId}/file`, app_id), {
        method: "GET",
        headers: getHeaders(),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText })) as ApiErrorResponse;
        throw new Error(`Failed to get asset file: ${error.error || response.statusText}`);
    }
    
    const contentType = response.headers.get("Content-Type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    
    return { data, contentType };
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
