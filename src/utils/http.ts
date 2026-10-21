
/** The OpenGraph API renders pages in a browser, with optional proxy retries. */
export const OG_API_TIMEOUT_MS = 120_000;
/** The Open Graph Audit API; discover crawls the site synchronously before answering. */
export const SITE_AUDIT_TIMEOUT_MS = 120_000;
/** Image generation runs a model and can legitimately take minutes. */
export const IMAGE_AGENT_TIMEOUT_MS = 300_000;

export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

const MAX_ERROR_CHARS = 300;

/**
 * Encoding alone is not enough: "." and ".." pass through encodeURIComponent and
 * the URL parser resolves them, so "fix-items/.." would address the audit itself.
 */
export function pathSegment(id: string): string {
    if (id === "" || id === "." || id === "..") throw new Error("Invalid ID.");
    return encodeURIComponent(id);
}

export class UpstreamTimeoutError extends Error {
    constructor(service: string, timeoutMs: number) {
        super(`${service} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
        this.name = "UpstreamTimeoutError";
    }
}

export class ResponseTooLargeError extends Error {
    constructor(service: string) {
        super(`${service} returned a response larger than ${MAX_RESPONSE_BYTES / (1024 * 1024)} MB.`);
        this.name = "ResponseTooLargeError";
    }
}

export async function fetchWithTimeout(
    service: string,
    url: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
            throw new UpstreamTimeoutError(service, timeoutMs);
        }
        throw err;
    }
}

/** Streams when it can, so an oversized body is abandoned rather than buffered whole. */
export async function readBytes(service: string, response: Response): Promise<Buffer> {
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw new ResponseTooLargeError(service);
    }

    if (!response.body) {
        const fallback = typeof response.arrayBuffer === "function"
            ? Buffer.from(await response.arrayBuffer())
            : Buffer.from(await response.text(), "utf8");
        if (fallback.length > MAX_RESPONSE_BYTES) throw new ResponseTooLargeError(service);
        return fallback;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => {});
            throw new ResponseTooLargeError(service);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}

export async function readText(service: string, response: Response): Promise<string> {
    return (await readBytes(service, response)).toString("utf8");
}

export async function readJson<T = any>(service: string, response: Response): Promise<T> {
    const text = await readText(service, response);
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new Error(`${service} returned a response that is not valid JSON.`);
    }
}

// Stack frames, filesystem paths and socket errors describe our infrastructure,
// never the request, so they are dropped at any status.
const INTERNAL_DETAIL =
    /\n\s*at\s|\bat\s+\S*[\\/]\S*:\d+:\d+|node_modules|(?:^|[\s'"(])\/(?:app|usr|home|srv|var|opt|root|tmp)\/|\bE(?:CONNREFUSED|NOTFOUND|TIMEDOUT|CONNRESET|AI_AGAIN|NOENT|ACCES)\b|\bSequelize\w*Error\b|\bSQLSTATE\b/;
// Addresses and internal hostnames are only dropped from 5xx: a 4xx refusal may
// legitimately name the address the caller asked for (an SSRF block, say).
const INTERNAL_ADDRESS =
    /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b|\.(?:internal|local|cluster\.local|svc)\b/i;

/** Only a structured message is written for callers; a raw body (HTML error page, proxy text) never is. */
export function upstreamDetail(body: unknown, status: number): string | undefined {
    const b = body as any;
    const candidate =
        (typeof b?.error?.message === "string" && b.error.message) ||
        (typeof b?.message === "string" && b.message) ||
        (typeof b?.error === "string" && b.error) ||
        "";
    if (!candidate || INTERNAL_DETAIL.test(candidate)) return undefined;
    if (status >= 500 && INTERNAL_ADDRESS.test(candidate)) return undefined;

    const flat = candidate.replace(/\s+/g, " ").trim();
    if (!flat) return undefined;
    return flat.length > MAX_ERROR_CHARS ? `${flat.slice(0, MAX_ERROR_CHARS)}…` : flat;
}

export function safeUpstreamMessage(status: number, body: unknown): string {
    return upstreamDetail(body, status) ?? `Request failed with status ${status}.`;
}

/** Parse an error body for {@link safeUpstreamMessage} without trusting it to be JSON. */
export async function readErrorBody(service: string, response: Response): Promise<unknown> {
    try {
        return JSON.parse(await readText(service, response));
    } catch {
        return undefined;
    }
}
