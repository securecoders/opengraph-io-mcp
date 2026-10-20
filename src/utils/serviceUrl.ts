const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * A base URL from the environment, checked before any request (or bearer
 * token) is sent to it. Unset falls back to the production default; a bad
 * value fails the call rather than being used or quietly replaced.
 */
export function serviceUrl(envName: string, fallback: string): string {
    const raw = process.env[envName];
    if (!raw) return fallback;

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${envName} is not a valid URL.`);
    }
    const local = LOCAL_HOSTS.includes(url.hostname);
    const schemeOk = url.protocol === "https:" || (url.protocol === "http:" && local);
    if (!schemeOk || url.username || url.password || url.search || url.hash) {
        throw new Error(`${envName} must be an https URL with no credentials or query (http is allowed for localhost).`);
    }
    return raw.replace(/\/+$/, "");
}
