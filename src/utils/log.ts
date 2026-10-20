import { createHash } from "node:crypto";

/**
 * One JSON line per security-relevant event, on stderr: stdout is the protocol
 * channel under stdio. Callers pass identifiers only; a key or token must never
 * be a field value, so keys go through keyFingerprint first.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

const SAMPLE_WINDOW_MS = 60_000;
const SAMPLE_LIMIT = 5;
const sampled = new Map<string, { start: number; count: number; suppressed: number }>();

/**
 * For events anyone can trigger without a credential: the first few per key
 * per minute, then silence, with the dropped count carried on the next line.
 */
export function logSampled(key: string, event: string, fields: Record<string, unknown> = {}, now = Date.now()): void {
    if (sampled.size > 10_000) sampled.clear();
    let slot = sampled.get(`${event}|${key}`);
    if (!slot || now - slot.start >= SAMPLE_WINDOW_MS) {
        const suppressed = slot?.suppressed ?? 0;
        slot = { start: now, count: 0, suppressed: 0 };
        sampled.set(`${event}|${key}`, slot);
        if (suppressed > 0) fields = { ...fields, suppressed };
    }
    slot.count += 1;
    if (slot.count > SAMPLE_LIMIT) {
        slot.suppressed += 1;
        return;
    }
    logEvent(event, fields);
}

/** A short fingerprint, never the key: enough to count distinct callers. */
export function keyFingerprint(appId: string): string {
    return createHash("sha256").update(appId).digest("hex").slice(0, 12);
}

/** Who a credential belongs to, safe to log: the OAuth subject, or a key fingerprint. */
export function principalForLog(ctx: { subject?: string; appId: string }): string {
    return ctx.subject ? `sub:${ctx.subject}` : `app:${keyFingerprint(ctx.appId)}`;
}
