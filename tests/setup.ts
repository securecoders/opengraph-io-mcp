// dotenv.config() runs at import time in src/utils/og.ts, site-audit-api.ts and
// og-image-api.ts, and this repo has a .env — without these sentinels a forgotten
// stub would reach production. dotenv does not override already-set vars, so
// these win.
process.env.OG_BASE_URL = "http://unmocked.invalid";
process.env.SITE_AUDIT_API_URL = "http://unmocked.invalid";
process.env.OG_IMAGE_AGENT_URL = "http://unmocked.invalid";
delete process.env.APP_ID;
delete process.env.OPENGRAPH_APP_ID;

globalThis.fetch = (async (input: unknown) => {
  throw new Error(`Unmocked network call to ${String(input)}`);
}) as unknown as typeof fetch;
