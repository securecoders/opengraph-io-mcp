import { AuthContext } from "@/utils/sessionIdToAppId";

/**
 * Stable identity for a credential. A session id alone must never be enough to
 * act: it travels in client logs and through proxies, and the stored context
 * holds the opener's live OAuth token.
 */
export function ownerKey(ctx: AuthContext): string {
  return ctx.subject ? `sub:${ctx.subject}` : `app:${ctx.appId}`;
}
