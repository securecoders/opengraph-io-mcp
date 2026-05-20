import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/*
 * Shared response envelope for MCP tool returns.
 *
 * Wraps every tool response in a consistent shape so agents can parse,
 * branch, and recover without per-tool special cases. Mirrors the agent
 * envelope shape used by the REST API (apifur-shredder-api/Phase 4).
 *
 *   success: true
 *     { content: [{ type: "text", text: '{"success":true,"data":{...},"metadata":{...}}' }] }
 *
 *   success: false
 *     { content: [{ type: "text", text: '{"success":false,"error":{...},"metadata":{...}}' }],
 *       isError: true }
 *
 * Setting `isError: true` on failure is required by the MCP spec but was
 * previously omitted across our tools — the envelope fixes that bug.
 */

export const ErrorCode = {
    INVALID_INPUT: "INVALID_INPUT",
    INVALID_AUTH: "INVALID_AUTH",
    RATE_LIMITED: "RATE_LIMITED",
    QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
    BLOCKED_BY_TARGET: "BLOCKED_BY_TARGET",
    RENDER_REQUIRED: "RENDER_REQUIRED",
    CAPTCHA_DETECTED: "CAPTCHA_DETECTED",
    UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
    UPSTREAM_ERROR: "UPSTREAM_ERROR",
    NOT_FOUND: "NOT_FOUND",
    UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCodeValue = typeof ErrorCode[keyof typeof ErrorCode];

export interface EnvelopeError {
    code: ErrorCodeValue | string;
    message: string;
    recovery_hint?: string;
    details?: Record<string, unknown>;
}

export interface EnvelopeMetadata {
    request_id?: string;
    credits_used?: number;
    credits_remaining?: number;
    cached?: boolean;
    tool?: string;
    [key: string]: unknown;
}

const stringify = (payload: Record<string, unknown>): string => JSON.stringify(payload);

export const successEnvelope = (
    data: unknown,
    metadata?: EnvelopeMetadata,
    extraContent: CallToolResult["content"] = []
): CallToolResult => {
    const text = stringify({
        success: true,
        data,
        ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
    });
    return {
        content: [
            ...extraContent,
            { type: "text", text },
        ],
    };
};

export const errorEnvelope = (
    error: EnvelopeError,
    metadata?: EnvelopeMetadata
): CallToolResult => {
    const text = stringify({
        success: false,
        error,
        ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
    });
    return {
        content: [{ type: "text", text }],
        isError: true,
    };
};

/**
 * Infer a sensible error code from a thrown message so agents get useful
 * recovery hints even when the upstream didn't classify the failure.
 */
const inferCodeFromMessage = (raw: string): { code: ErrorCodeValue; recovery_hint?: string } => {
    const lower = raw.toLowerCase();
    if (lower.includes("app_id") || lower.includes("api key") || lower.includes("unauthorized") || lower.includes("401")) {
        return {
            code: ErrorCode.INVALID_AUTH,
            recovery_hint: "Provide a valid OpenGraph app_id via the OPENGRAPH_APP_ID env var or --app-id flag.",
        };
    }
    if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
        return {
            code: ErrorCode.RATE_LIMITED,
            recovery_hint: "Back off and retry after a short delay, or upgrade your plan.",
        };
    }
    if (lower.includes("quota") || lower.includes("402")) {
        return {
            code: ErrorCode.QUOTA_EXCEEDED,
            recovery_hint: "Buy add-on credits or wait until your plan period resets.",
        };
    }
    if (lower.includes("blocked") || lower.includes("403") || lower.includes("forbidden")) {
        return {
            code: ErrorCode.BLOCKED_BY_TARGET,
            recovery_hint: "Retry with use_premium: true. If that still fails, escalate to use_superior: true.",
        };
    }
    if (lower.includes("captcha")) {
        return {
            code: ErrorCode.CAPTCHA_DETECTED,
            recovery_hint: "Retry with use_superior: true to route through a residential/mobile proxy.",
        };
    }
    if (lower.includes("timeout") || lower.includes("504") || lower.includes("etimedout")) {
        return {
            code: ErrorCode.UPSTREAM_TIMEOUT,
            recovery_hint: "Retry the request. Heavy pages may need full_render: true to settle.",
        };
    }
    if (lower.includes("not found") || lower.includes("404")) {
        return {
            code: ErrorCode.NOT_FOUND,
            recovery_hint: "Verify the URL or resource ID exists.",
        };
    }
    if (lower.includes("invalid") || lower.includes("must be") || lower.includes("required")) {
        return {
            code: ErrorCode.INVALID_INPUT,
            recovery_hint: "Re-check tool input — see the tool's inputSchema for required fields and shapes.",
        };
    }
    return { code: ErrorCode.UNKNOWN };
};

/**
 * Turn a thrown value into an error envelope. Caller provides the tool name
 * (for the metadata trail) and may supply a known error code / recovery hint
 * to override the inferred one.
 */
export const catchToEnvelope = (
    err: unknown,
    opts: {
        tool: string;
        code?: ErrorCodeValue | string;
        recovery_hint?: string;
        metadata?: EnvelopeMetadata;
        prefix?: string;
    }
): CallToolResult => {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = opts.prefix ? `${opts.prefix}: ${rawMessage}` : rawMessage;
    const inferred = inferCodeFromMessage(rawMessage);

    const error: EnvelopeError = {
        code: opts.code ?? inferred.code,
        message,
        recovery_hint: opts.recovery_hint ?? inferred.recovery_hint,
    };

    return errorEnvelope(error, { tool: opts.tool, ...(opts.metadata ?? {}) });
};
