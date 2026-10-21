/** Most sessions one principal may hold; opening another evicts their least recently used. */
export const MAX_SESSIONS_PER_OWNER = 50;
/** Process-wide ceiling. Past it, new sessions are refused until the sweep frees some. */
export const MAX_SESSIONS = 10_000;
/** Owners are free to mint, so the rate limit alone would let one address fill the ceiling over a day or two. */
export const MAX_SESSIONS_PER_IP = 100;

/** New sessions per client IP per window. Reconnects are cheap for a real client; this is far above them. */
export const SESSION_CREATE_WINDOW_MS = 15 * 60 * 1000;
export const SESSION_CREATE_LIMIT = 60;

/** Tool calls and resource reads per session: a generous burst, then two a second. */
export const CALL_BURST = 120;
export const CALL_REFILL_PER_SEC = 2;

/** Each subscription drives a notification every 10 seconds. */
export const MAX_SUBSCRIPTIONS = 100;
export const MAX_SUBSCRIPTION_URI_CHARS = 2048;

/** Behind a reverse proxy, trusting none would key every client on the proxy's IP and make the limiter global. */
export function resolveTrustProxy(): number | boolean {
    const raw = process.env.MCP_TRUST_PROXY;
    if (raw === undefined || raw === "") return 1;
    if (raw === "false") return false;
    const hops = Number(raw);
    return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

export class TokenBucket {
    private tokens: number;
    private last: number;

    constructor(
        private readonly capacity: number,
        private readonly refillPerSec: number,
        private readonly now: () => number = Date.now,
    ) {
        this.tokens = capacity;
        this.last = now();
    }

    take(): boolean {
        const t = this.now();
        this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
        this.last = t;
        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
    }
}
