/**
 * Per-session authentication context.
 *
 * Stores credentials extracted from either:
 *   - A bearer JWT (OAuth 2.1 flow): appId + organizationId + scope
 *   - An x-app-id header (legacy fallback): appId only
 *
 * The sessionId is the Streamable-HTTP session identifier managed by the
 * MCP SDK (one per client connection).
 */

export interface AuthContext {
  /** ApiKey.key — forwarded to OpenGraph API as app_id for billing */
  appId: string;
  /** Organization UUID — available for marketing-tool billing (site audit) */
  organizationId?: string;
  /** OAuth scope string, e.g. "mcp" */
  scope?: string;
  /**
   * Raw Bearer JWT — forwarded as Authorization header when calling
   * apifur-api endpoints that require session-or-bearer auth (e.g. site audit).
   * Only present for OAuth-authenticated sessions, not x-app-id fallback.
   */
  accessToken?: string;
}

const store = new Map<string, AuthContext>();

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Store a full AuthContext for a session (OAuth path).
 */
export function setAuthContext(sessionId: string, ctx: AuthContext): void {
  if (!sessionId) return;
  store.set(sessionId, ctx);
}

/**
 * Store just an appId for a session (legacy x-app-id path).
 * Preserves existing organizationId / scope if already set.
 */
export function setAppId(sessionId: string, appId: string): void {
  if (!sessionId) return;
  const existing = store.get(sessionId);
  store.set(sessionId, { ...existing, appId });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export function getAuthContext(sessionId: string): AuthContext | undefined {
  if (!sessionId) return undefined;
  return store.get(sessionId);
}

/**
 * Convenience accessor — backward-compatible with previous callers that only
 * needed the appId.
 */
export function getAppId(sessionId: string): string | undefined {
  return store.get(sessionId)?.appId;
}

// ---------------------------------------------------------------------------
// Delete / clear (connection teardown, tests)
// ---------------------------------------------------------------------------

export function deleteAppId(sessionId: string): void {
  store.delete(sessionId);
}

export function clearAllAppIds(): void {
  store.clear();
}

export function getAppIdMapSize(): number {
  return store.size;
}
