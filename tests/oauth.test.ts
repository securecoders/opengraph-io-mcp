import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createServer, type Server } from "node:http";
// CryptoKey is a DOM global; this project's lib is ES2020, so take the type
// from node's own WebCrypto surface instead of widening lib.
import type { webcrypto } from "node:crypto";
import type { AddressInfo } from "node:net";
import { verifyAccessToken, resetJwksCache } from "@/utils/oauth";

// src/utils/oauth.ts had no test of any kind, and it is the one place in this
// repo whose behaviour is genuinely sensitive to the Node major: jose verifies
// RS256 through WebCrypto. Everything here runs against a locally generated
// keypair and a JWKS served over loopback, so it needs no credentials, no
// network and no fixture to go stale.

const KID = "test-key-1";
const PS_KID = "test-key-ps";
const ISSUER = "https://issuer.test";
const AUDIENCE = "https://mcp.test/mcp";

let privateKey: webcrypto.CryptoKey;
let psPrivateKey: webcrypto.CryptoKey;
let jwksServer: Server;
let jwksUrl: string;

const env = { ...process.env };

beforeAll(async () => {
  // extractable so exportJWK can publish the public half.
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey as webcrypto.CryptoKey;
  const jwk = await exportJWK(pair.publicKey);

  // A second, RSA-PSS key published in the same JWKS. Real issuers do rotate
  // and republish key types, and it is what makes the RS256 allowlist testable:
  // without it, jose would happily verify a PS256 token against this key.
  const psPair = await generateKeyPair("PS256", { extractable: true });
  psPrivateKey = psPair.privateKey as webcrypto.CryptoKey;
  const psJwk = await exportJWK(psPair.publicKey);

  jwksServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [
      { ...jwk, kid: KID, alg: "RS256", use: "sig" },
      { ...psJwk, kid: PS_KID, alg: "PS256", use: "sig" },
    ] }));
  });
  await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", r));
  jwksUrl = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/jwks.json`;
});

afterAll(async () => {
  await new Promise<void>((res, rej) => jwksServer.close((e) => (e ? rej(e) : res())));
});

beforeEach(() => {
  // createRemoteJWKSet fetches, and setup.ts replaces fetch with a throw-guard.
  globalThis.fetch = (globalThis as any).__realFetch;
  process.env.OAUTH_JWKS_URL = jwksUrl;
  process.env.OAUTH_ISSUER = ISSUER;
  process.env.OAUTH_AUDIENCE = AUDIENCE;
  resetJwksCache();
});

afterEach(() => {
  process.env = { ...env };
  resetJwksCache();
});

interface Claims { [k: string]: unknown }

async function sign(claims: Claims = {}, opts: { aud?: string; iss?: string; exp?: string | number; sub?: string | null; alg?: string; kid?: string } = {}) {
  let jwt = new SignJWT({
    og_app_id: "key-a",
    og_org_id: "org-1",
    scope: "mcp",
    ...claims,
  })
    .setProtectedHeader({ alg: opts.alg ?? "RS256", kid: opts.kid ?? KID })
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuer(opts.iss ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h");
  if (opts.sub !== null) jwt = jwt.setSubject(opts.sub ?? "user-1");
  return jwt.sign(privateKey);
}

describe("verifyAccessToken — the happy path", () => {
  it("verifies an RS256 token against the remote JWKS and returns the claims", async () => {
    const claims = await verifyAccessToken(await sign());
    expect(claims).toEqual({
      subject: "user-1",
      appId: "key-a",
      organizationId: "org-1",
      scope: "mcp",
      expiresAt: expect.any(Number),
    });
  });

  it("caches the key material across calls", async () => {
    let fetches = 0;
    const real = (globalThis as any).__realFetch;
    globalThis.fetch = ((...args: any[]) => { fetches += 1; return real(...args); }) as any;
    await verifyAccessToken(await sign());
    await verifyAccessToken(await sign());
    expect(fetches).toBe(1);
  });
});

describe("verifyAccessToken — signature and algorithm", () => {
  it("rejects a token signed by a different key", async () => {
    const other = await generateKeyPair("RS256", { extractable: true });
    const forged = await new SignJWT({ og_app_id: "key-a", og_org_id: "org-1" })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setSubject("user-1").setAudience(AUDIENCE).setIssuer(ISSUER)
      .setIssuedAt().setExpirationTime("1h")
      .sign(other.privateKey as webcrypto.CryptoKey);
    await expect(verifyAccessToken(forged)).rejects.toThrow();
  });

  // The algorithm list is pinned to RS256, so a token asking to be verified as
  // an HMAC cannot trick the verifier into treating the public key as a secret.
  it("rejects an HS256 token", async () => {
    const secret = new TextEncoder().encode("a".repeat(32));
    const hs = await new SignJWT({ og_app_id: "key-a", og_org_id: "org-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1").setAudience(AUDIENCE).setIssuer(ISSUER)
      .setIssuedAt().setExpirationTime("1h")
      .sign(secret);
    await expect(verifyAccessToken(hs)).rejects.toThrow();
  });

  // Catches removal of `algorithms: ['RS256']`. The HS256 case above does not:
  // jose refuses an HMAC token against an RSA key regardless of the allowlist,
  // so it passes for the wrong reason. PS256 uses a key the JWKS really serves.
  it("rejects a PS256 token even though the JWKS publishes that key", async () => {
    const ps = await new SignJWT({ og_app_id: "key-a", og_org_id: "org-1", scope: "mcp" })
      .setProtectedHeader({ alg: "PS256", kid: PS_KID })
      .setSubject("user-1").setAudience(AUDIENCE).setIssuer(ISSUER)
      .setIssuedAt().setExpirationTime("1h")
      .sign(psPrivateKey);
    await expect(verifyAccessToken(ps)).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(verifyAccessToken("not.a.jwt")).rejects.toThrow();
  });
});

describe("verifyAccessToken — time and addressing", () => {
  it("rejects an expired token", async () => {
    await expect(verifyAccessToken(await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 })))
      .rejects.toThrow();
  });

  it("rejects a token addressed to another audience", async () => {
    await expect(verifyAccessToken(await sign({}, { aud: "https://elsewhere.test/mcp" })))
      .rejects.toThrow();
  });

  it("rejects a token from another issuer when OAUTH_ISSUER is set", async () => {
    await expect(verifyAccessToken(await sign({}, { iss: "https://evil.test" })))
      .rejects.toThrow();
  });

  // An unset OAUTH_ISSUER used to drop the iss check entirely, so any
  // issuer whose key the JWKS served was accepted. It now refuses the token.
  it("refuses every token when OAUTH_ISSUER is unset, rather than skipping the check", async () => {
    delete process.env.OAUTH_ISSUER;
    resetJwksCache();
    await expect(verifyAccessToken(await sign({}, { iss: "https://anyone.test" })))
      .rejects.toThrow(/OAUTH_ISSUER/);
    await expect(verifyAccessToken(await sign())).rejects.toThrow(/OAUTH_ISSUER/);
  });

  it("matches the issuer exactly, so a trailing slash is a different issuer", async () => {
    await expect(verifyAccessToken(await sign({}, { iss: `${ISSUER}/` }))).rejects.toThrow();
  });

  it("uses the production audience by default when OAUTH_AUDIENCE is unset", async () => {
    delete process.env.OAUTH_AUDIENCE;
    resetJwksCache();
    await expect(verifyAccessToken(await sign())).rejects.toThrow();
    const prod = await sign({}, { aud: "https://mcp.opengraph.io/mcp" });
    await expect(verifyAccessToken(prod)).resolves.toMatchObject({ subject: "user-1" });
  });
});

describe("verifyAccessToken — required claims", () => {
  it("rejects a token with no sub", async () => {
    await expect(verifyAccessToken(await sign({}, { sub: null })))
      .rejects.toThrow(/sub/);
  });

  it("rejects a token with no og_app_id", async () => {
    await expect(verifyAccessToken(await sign({ og_app_id: undefined })))
      .rejects.toThrow(/og_app_id/);
  });

  it("rejects a token with no og_org_id", async () => {
    await expect(verifyAccessToken(await sign({ og_org_id: undefined })))
      .rejects.toThrow(/og_org_id/);
  });

  // A token with no scope used to be read as mcp-scoped. The API refuses
  // such a token for MCP, so this server must too.
  it("refuses a token with no scope", async () => {
    await expect(verifyAccessToken(await sign({ scope: undefined }))).rejects.toThrow(/mcp scope/);
  });

  it("refuses a token whose scope does not include mcp", async () => {
    await expect(verifyAccessToken(await sign({ scope: "openid profile" }))).rejects.toThrow(/mcp scope/);
  });

  it("accepts mcp alongside other scopes", async () => {
    await expect(verifyAccessToken(await sign({ scope: "offline_access mcp" })))
      .resolves.toMatchObject({ scope: "offline_access mcp" });
  });

  it("refuses a token with no exp, which would otherwise never expire", async () => {
    const jwt = await new SignJWT({ og_app_id: "key-a", og_org_id: "org-1", scope: "mcp" })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setAudience(AUDIENCE)
      .setIssuer(ISSUER)
      .setSubject("user-1")
      .sign(privateKey);
    await expect(verifyAccessToken(jwt)).rejects.toThrow();
  });

  it("reports when the token expires", async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const claims = await verifyAccessToken(await sign({}, { exp }));
    expect(claims.expiresAt).toBe(exp * 1000);
  });
});

describe("verifyAccessToken — configuration", () => {
  it("refuses an http JWKS URL, which would let the path swap signing keys", async () => {
    process.env.OAUTH_JWKS_URL = "http://keys.example.test/jwks.json";
    resetJwksCache();
    await expect(verifyAccessToken(await sign())).rejects.toThrow(/OAUTH_JWKS_URL/);
  });

  it("throws a named error when OAUTH_JWKS_URL is unset", async () => {
    delete process.env.OAUTH_JWKS_URL;
    resetJwksCache();
    await expect(verifyAccessToken(await sign())).rejects.toThrow(/OAUTH_JWKS_URL/);
  });

  it("surfaces an unreachable JWKS as a failure, not a pass", async () => {
    process.env.OAUTH_JWKS_URL = "http://127.0.0.1:1/jwks.json";
    resetJwksCache();
    await expect(verifyAccessToken(await sign())).rejects.toThrow();
  });
});
