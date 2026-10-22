/**
 * OAuth 2.1 token verification for the OpenGraph MCP protected resource.
 *
 * Uses `jose` to verify RS256 JWTs issued by the OpenGraph.io authorization server against the remote
 * JWKS endpoint.  Key material is cached by jose's createRemoteJWKSet.
 *
 * Environment variables:
 *   OAUTH_JWKS_URL   — e.g. https://dashboard-api.opengraph.io/oauth/jwks.json
 *   OAUTH_ISSUER     — e.g. https://dashboard-api.opengraph.io
 *   OAUTH_AUDIENCE   — e.g. https://mcp.opengraph.io/mcp  (default)
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { serviceUrl } from '@/utils/serviceUrl';

export interface OAuthClaims {
  /** Token subject (sub) — the user the session belongs to */
  subject:        string;
  /** ApiKey.id (og_app_id) — not the key; resolveAppKey trades it for one */
  apiKeyId:       string;
  /** Organization UUID — used for marketing-tool billing (og_org_id) */
  organizationId: string;
  /** Space-separated scope string */
  scope:          string;
  /** Epoch ms after which the token must no longer be held */
  expiresAt?:     number;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

// An http JWKS URL would let anyone on the path swap the signing keys and mint tokens.
function getJwksUrl(): string {
  const url = serviceUrl('OAUTH_JWKS_URL', '');
  if (!url) {
    throw new Error(
      'OAUTH_JWKS_URL is not set. ' +
      'Set it to the /oauth/jwks.json URL of the authorization server.',
    );
  }
  return url;
}

// Required, but only checked when a token is verified: stdio never touches OAuth,
// so a missing value must not stop it starting. Unset used to skip the iss check.
function getIssuer(): string {
  const issuer = process.env.OAUTH_ISSUER;
  if (!issuer) {
    throw new Error(
      'OAUTH_ISSUER is not set. Set it to the exact issuer the authorization server signs with ' +
      '(its /.well-known/oauth-authorization-server "issuer").',
    );
  }
  return issuer;
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
 * Verify an RS256 JWT access token issued by the authorization server.
 *
 * @throws if the token is invalid, expired, or missing required claims.
 */
export async function verifyAccessToken(jwt: string): Promise<OAuthClaims> {
  const issuer   = getIssuer();
  const audience = getAudience();

  const { payload } = await jwtVerify(jwt, getJwks(), {
    algorithms:    ['RS256'],
    audience,
    issuer,
    // jose only checks exp when present; a token without one would never expire.
    requiredClaims: ['exp'],
  });

  const subject        = typeof payload.sub       === 'string' ? payload.sub       : '';
  const apiKeyId       = typeof payload.og_app_id === 'string' ? payload.og_app_id : '';
  const organizationId = typeof payload.og_org_id === 'string' ? payload.og_org_id : '';
  const scope          = typeof payload.scope     === 'string' ? payload.scope     : '';

  if (!subject) {
    throw new Error('Access token missing sub claim');
  }
  if (!apiKeyId) {
    throw new Error('Access token missing og_app_id claim');
  }
  if (!organizationId) {
    throw new Error('Access token missing og_org_id claim');
  }
  // The OpenGraph.io API refuses a token without the mcp scope; a missing scope must not
  // be read here as full access.
  if (!scope.split(/\s+/).includes('mcp')) {
    throw new Error('Access token lacks the mcp scope');
  }

  const expiresAt = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  return { subject, apiKeyId, organizationId, scope, expiresAt };
}
