import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getSiteMarkdown } from "@/utils/og";
import { formatMarkdown } from "@/utils/format";
import GetOgMarkdownTool from "@/tools/get-og-markdown";

let calls: string[] = [];

function stubFetch(body: string, contentType = "application/json", ok = true, status = 200) {
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return {
      ok, status, statusText: ok ? "OK" : "Error",
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? contentType : null) },
      text: async () => body,
    };
  }) as unknown as typeof fetch;
}

const ENVELOPE = JSON.stringify({
  markdown: "# Title\n\nBody prose.",
  metadata: { title: "Title", description: "d", language: "en", final_url: "https://x.test/" },
  usage: { character_count: 21, estimated_token_count: 6, truncated: false },
  debug: { full_render_used: false, proxy_used: null, retry_attempts: 1 },
  request_id: "req-1",
});

beforeEach(() => { calls = []; });
afterEach(() => { vi.restoreAllMocks(); });

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.split("?")[1] ?? "");
}

describe("markdown request building", () => {
  it("always requests the JSON envelope, even if a caller passes format", async () => {
    stubFetch(ENVELOPE);
    await getSiteMarkdown("https://x.test/", "key", { format: "markdown" } as any);
    expect(paramsOf(calls[0]).get("format")).toBe("json");
  });

  it("comma-joins selector arrays into a single parameter", async () => {
    stubFetch(ENVELOPE);
    await getSiteMarkdown("https://x.test/", "key", { include_tags: ["article", "main"] });
    const p = paramsOf(calls[0]);
    expect(p.getAll("include_tags")).toEqual(["article,main"]);
  });

  it("serialises an explicit false rather than dropping it", async () => {
    // `include_markdown: false` is meaningful — omitting it would silently flip
    // the server back to its default of including the body.
    stubFetch(ENVELOPE);
    await getSiteMarkdown("https://x.test/", "key", { include_markdown: false, only_main_content: false });
    const p = paramsOf(calls[0]);
    expect(p.get("include_markdown")).toBe("false");
    expect(p.get("only_main_content")).toBe("false");
  });

  it("defaults accept_lang to auto but honours an explicit value", async () => {
    stubFetch(ENVELOPE);
    await getSiteMarkdown("https://x.test/", "key", {});
    expect(paramsOf(calls[0]).get("accept_lang")).toBe("auto");

    calls = [];
    await getSiteMarkdown("https://x.test/", "key", { accept_lang: "de-DE" });
    expect(paramsOf(calls[0]).get("accept_lang")).toBe("de-DE");
  });

  it("omits chunking parameters that were never set", async () => {
    stubFetch(ENVELOPE);
    await getSiteMarkdown("https://x.test/", "key", {});
    const p = paramsOf(calls[0]);
    expect(p.has("query")).toBe(false);
    expect(p.has("query_top_k")).toBe(false);
    expect(p.has("chunking")).toBe(false);
  });

  it("turns a question into a chunked request", async () => {
    stubFetch(ENVELOPE);
    const tool = new GetOgMarkdownTool("key");
    await tool.execute(tool.inputSchema.parse({ url: "https://x.test/", query: "what is it" }));
    const p = paramsOf(calls[0]);
    // Ranking is only meaningful over chunks, so asking implies chunking.
    expect(p.get("query")).toBe("what is it");
    expect(p.get("chunking")).toBe("true");
  });
});

describe("response handling", () => {
  it("falls back to prose when the API answers text/markdown", async () => {
    // An og-api deployment predating the JSON envelope. Parsing must not throw.
    stubFetch("# Just markdown\n\ntext", "text/markdown");
    const out = await getSiteMarkdown("https://x.test/", "key", {});
    expect(out.markdown).toContain("Just markdown");
  });

  it("falls back when the body is not valid JSON despite the header", async () => {
    stubFetch("not json at all", "application/json");
    const out = await getSiteMarkdown("https://x.test/", "key", {});
    expect(out.markdown).toBe("not json at all");
  });

  it("surfaces the server's message on a 422 block", async () => {
    stubFetch(JSON.stringify({ error: { message: "blocked" } }), "application/json", false, 422);
    await expect(getSiteMarkdown("https://x.test/", "key", { ai_sanitize: true, ai_sanitize_mode: "block" }))
      .rejects.toThrow(/422/);
  });
});

describe("markdown formatting", () => {
  it("reports counts from usage, not a re-measured string", async () => {
    const out = formatMarkdown("https://x.test/page", {
      markdown: "short",
      usage: { output_character_count: 12345, output_estimated_token_count: 3100 },
    });
    expect(out.markdown).toContain("12,345 chars");
    expect(out.markdown).toContain("~3,100 tokens");
    expect(out.structured.length).toBe(12345);
  });

  it("never renders a literal undefined when the body was omitted", async () => {
    const out = formatMarkdown("https://x.test/page", { usage: { character_count: 0 } });
    expect(out.markdown).not.toContain("undefined");
    expect(out.structured.markdown).toBe("");
  });

  it("leads with a prompt-injection warning when risk is high", () => {
    const out = formatMarkdown("https://x.test/page", {
      markdown: "body",
      ai_safety: { risk_level: "high", risk_score: 0.9, content_sanitized: false },
    });
    expect(out.markdown).toMatch(/prompt-injection risk/i);
    expect(out.markdown).toMatch(/NOT modified/);
  });

  it("stays quiet about safety when risk is low", () => {
    const out = formatMarkdown("https://x.test/page", {
      markdown: "body", ai_safety: { risk_level: "low", risk_score: 0.01 },
    });
    expect(out.markdown).not.toMatch(/prompt-injection risk/i);
  });

  it("shows ranked chunks instead of prose when a query was asked", () => {
    const out = formatMarkdown("https://x.test/page", {
      markdown: "the whole page body",
      chunks: [
        { position: 0, text: "relevant passage", relevance_score: 0.87, heading_path: ["A", "B"] },
      ],
    });
    expect(out.markdown).toContain("relevant passage");
    expect(out.markdown).toContain("relevance 0.87");
    expect(out.markdown).toContain("A › B");
    // The full body is still available to the caller in structured output.
    expect(out.structured.markdown).toBe("the whole page body");
  });
});

describe("tool contract", () => {
  it("produces structured output matching its own schema", async () => {
    stubFetch(ENVELOPE);
    const tool = new GetOgMarkdownTool("key");
    const res: any = await tool.execute(tool.inputSchema.parse({ url: "https://x.test/" }));
    expect(() => tool.outputSchema.parse(res.structuredContent)).not.toThrow();
  });

  it("no longer carries the stale auto_render warning", () => {
    // auto_render has applied to the markdown route since og-api 30cce97; the old
    // text pushed agents into paying for full_render they did not need.
    expect(new GetOgMarkdownTool().description).not.toMatch(/auto_render does not apply/i);
  });

  it("rejects a query longer than the server accepts", () => {
    const tool = new GetOgMarkdownTool();
    expect(() => tool.inputSchema.parse({ url: "https://x.test/", query: "x".repeat(513) })).toThrow();
  });
});
