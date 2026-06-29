/**
 * OAuth 2.1 token verification for the OpenGraph MCP protected resource.
 *
 * Uses `jose` to verify RS256 JWTs issued by apifur-api against the remote
 * JWKS endpoint.  Key material is cached by jose's createRemoteJWKSet.
 *
 * Environment variables:
 *   OAUTH_JWKS_URL   — e.g. https://dashboard-api.opengraph.io/oauth/jwks.json
 *   OAUTH_ISSUER     — e.g. https://dashboard-api.opengraph.io
 *   OAUTH_AUDIENCE   — e.g. https://mcp.opengraph.io/mcp  (default)
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface OAuthClaims {
  /** ApiKey.key — used for standard API billing (og_app_id) */
  appId:          string;
  /** Organization UUID — used for marketing-tool billing (og_org_id) */
  organizationId: string;
  /** Space-separated scope string */
  scope:          string;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getJwksUrl(): string {
  const url = process.env.OAUTH_JWKS_URL;
  if (!url) {
    throw new Error(
      'OAUTH_JWKS_URL is not set. ' +
      'Set it to the /oauth/jwks.json URL of your apifur-api instance.',
    );
  }
  return url;
}

function getIssuer(): string | undefined {
  return process.env.OAUTH_ISSUER || undefined;
}

function getAudience(): string {
  return process.env.OAUTH_AUDIENCE || 'https://mcp.opengraph.io/mcp';
}

// ---------------------------------------------------------------------------
// Lazy-initialized remote JWKS
// ---------------------------------------------------------------------------

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(getJwksUrl()));
  }
  return _jwks;
}

// Call after rotating OAUTH_JWKS_URL at runtime (rare).
export function resetJwksCache(): void {
  _jwks = null;
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verify an RS256 JWT access token issued by apifur-api.
 *
 * @throws if the token is invalid, expired, or missing required claims.
 */
export async function verifyAccessToken(jwt: string): Promise<OAuthClaims> {
  const issuer   = getIssuer();
  const audience = getAudience();

  const { payload } = await jwtVerify(jwt, getJwks(), {
    algorithms:    ['RS256'],
    audience,
    ...(issuer ? { issuer } : {}),
  });

  const appId          = typeof payload.og_app_id === 'string' ? payload.og_app_id : '';
  const organizationId = typeof payload.og_org_id === 'string' ? payload.og_org_id : '';
  const scope          = typeof payload.scope     === 'string' ? payload.scope     : 'mcp';

  if (!appId) {
    throw new Error('Access token missing og_app_id claim');
  }
  if (!organizationId) {
    throw new Error('Access token missing og_org_id claim');
  }

  return { appId, organizationId, scope };
}
