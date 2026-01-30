import { getBaseUrl } from "./og.js";

/**
 * Get the base URL for the og-image-agent API
 * Uses the shared OG_BASE_URL with /image-agent/ path
 */
const getImageAgentBaseUrl = (): string => {
    return `${getBaseUrl()}/image-agent`;
};

/**
 * Get app_id from environment variable
 */
const getAppId = (): string => {
    return process.env.APP_ID || process.env.OPENGRAPH_APP_ID || '';
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
const withAppId = (url: string): string => {
    const appId = getAppId();
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
    prompt: string;
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
export const createSession = async (name?: string): Promise<SessionResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions`), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ name }),
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText })) as ApiErrorResponse;
        throw new Error(`Failed to create session: ${error.error || response.statusText}`);
    }
    
    return await response.json() as SessionResponse;
};

/**
 * Generate a new image in a session
 */
export const generateImage = async (sessionId: string, params: GenerateParams): Promise<GenerateResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions/${sessionId}/generate`), {
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
export const iterateImage = async (sessionId: string, params: IterateParams): Promise<IterateResponse> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions/${sessionId}/iterate`), {
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
export const getSession = async (sessionId: string): Promise<SessionDetails> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/sessions/${sessionId}`), {
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
export const getAssetFile = async (assetId: string): Promise<{ data: Buffer; contentType: string }> => {
    const baseUrl = getImageAgentBaseUrl();
    
    const response = await fetch(withAppId(`${baseUrl}/assets/${assetId}/file`), {
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
export const createAndGenerate = async (params: GenerateParams, sessionName?: string): Promise<{
    session: SessionResponse;
    result: GenerateResponse;
}> => {
    const session = await createSession(sessionName);
    const result = await generateImage(session.sessionId, params);
    return { session, result };
};
