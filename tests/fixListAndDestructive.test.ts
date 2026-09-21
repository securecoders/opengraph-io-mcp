import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ListFixItemsTool from "@/tools/list-fix-items";
import SaveFixItemsTool from "@/tools/save-fix-items";
import DeleteFixItemTool from "@/tools/delete-fix-item";
import ExportFixItemsCsvTool from "@/tools/export-fix-items-csv";
import DeleteSiteAuditTool from "@/tools/delete-site-audit";
import EmailSiteAuditReportTool from "@/tools/email-site-audit-report";

interface Call { url: string; method: string; body: any }
let calls: Call[] = [];

function stubFetch(route: { body?: any; raw?: string; ok?: boolean; status?: number; contentType?: string } = {}) {
  globalThis.fetch = (async (input: unknown, init: any) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    const ok = route.ok !== false;
    const status = route.status ?? (ok ? 200 : 500);
    const raw = route.raw ?? (status === 204 ? "" : JSON.stringify(route.body ?? {}));
    return {
      ok, status, statusText: ok ? "OK" : "Error",
      headers: { get: () => route.contentType ?? "application/json" },
      json: async () => JSON.parse(raw),
      text: async () => raw,
    };
  }) as unknown as typeof fetch;
}

beforeEach(() => { calls = []; });
afterEach(() => { vi.restoreAllMocks(); });

describe("listFixItems", () => {
  it("groups saved items by page", async () => {
    stubFetch({ body: { fixItems: [
      { id: "f1", pageUrl: "https://x.test/a", field: "title", proposedValue: "Better", originalValue: "Old" },
      { id: "f2", pageUrl: "https://x.test/a", field: "description", proposedValue: "Desc" },
      { id: "f3", pageUrl: "https://x.test/b", field: "title", proposedValue: "B" },
    ] } });
    const tool = new ListFixItemsTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    const text = res.content.map((c: any) => c.text).join("\n");

    expect(text).toContain("3 items");
    expect(text).toContain("2 pages");
    expect(text).toContain("was: Old");
    expect(() => tool.outputSchema.parse(res.structuredContent)).not.toThrow();
  });

  it("points at saveFixItems when the list is empty", async () => {
    stubFetch({ body: { fixItems: [] } });
    const tool = new ListFixItemsTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    expect(res.content.map((c: any) => c.text).join("\n")).toMatch(/saveFixItems/);
  });
});

describe("saveFixItems", () => {
  it("is annotated destructive because it overwrites hand-authored entries", () => {
    expect(new SaveFixItemsTool().annotations.destructiveHint).toBe(true);
  });

  it("refuses an unchanged value before calling the gateway", async () => {
    // Upstream treats an unchanged value as a delete, so a read-then-write-back
    // would quietly destroy the entry.
    stubFetch({ body: {} });
    const tool = new SaveFixItemsTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({
      auditId: "a1", pageUrl: "https://x.test/a",
      items: [{ field: "title", proposedValue: "Same", originalValue: "Same" }],
    }));

    expect(JSON.stringify(res)).toMatch(/identical to originalValue/);
    expect(JSON.stringify(res)).toMatch(/deleteFixItem/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an empty proposedValue on an edit, before calling the gateway", async () => {
    stubFetch({ body: {} });
    const tool = new SaveFixItemsTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({
      auditId: "a1", pageUrl: "p", items: [{ field: "title", proposedValue: "" }],
    }));
    expect(JSON.stringify(res)).toMatch(/is empty/);
    expect(calls).toHaveLength(0);
  });

  it("allows a note to carry no proposed value", async () => {
    // The dashboard records notes with an empty proposedValue, and the gateway
    // exempts them — being stricter here would put a capability out of reach.
    stubFetch({ body: { ok: true } });
    const tool = new SaveFixItemsTool("tok");
    await tool.execute(tool.inputSchema.parse({
      auditId: "a1", pageUrl: "https://x.test/a",
      items: [{ field: "title", kind: "note", proposedValue: "", recommendation: "Shorten this." }],
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].body.items[0].kind).toBe("note");
  });

  it("sends the page and items through on a genuine edit", async () => {
    stubFetch({ body: { ok: true } });
    const tool = new SaveFixItemsTool("tok");
    await tool.execute(tool.inputSchema.parse({
      auditId: "a1", pageUrl: "https://x.test/a",
      items: [{ field: "title", proposedValue: "New", originalValue: "Old" }],
    }));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body.pageUrl).toBe("https://x.test/a");
    expect(calls[0].body.items).toHaveLength(1);
  });

  it("surfaces the gateway's own refusal verbatim", async () => {
    stubFetch({ ok: false, status: 400, body: { error: {
      code: "VALIDATION_ERROR",
      message: "proposedValue must be non-empty and different from originalValue; use the delete endpoint to remove a fix item.",
    } } });
    const tool = new SaveFixItemsTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({
      auditId: "a1", pageUrl: "p", items: [{ field: "title", proposedValue: "x" }],
    }));
    expect(JSON.stringify(res)).toContain("use the delete endpoint");
  });
});

describe("deleteFixItem", () => {
  it("handles the 204 and reports removal", async () => {
    stubFetch({ status: 204 });
    const tool = new DeleteFixItemTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1", fixItemId: "f1" }));
    expect(calls[0].method).toBe("DELETE");
    expect(res.structuredContent.deleted).toBe(true);
  });

  it("is annotated destructive", () => {
    expect(new DeleteFixItemTool().annotations.destructiveHint).toBe(true);
  });
});

describe("exportFixItemsCsv", () => {
  it("returns CSV without trying to parse it as JSON", async () => {
    // The body is text/csv — an unguarded JSON.parse throws on the first comma.
    const csv = "page,field,proposed\nhttps://x.test/a,title,Better\nhttps://x.test/b,title,B\n";
    stubFetch({ raw: csv, contentType: "text/csv; charset=utf-8" });
    const tool = new ExportFixItemsCsvTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));

    expect(res.structuredContent.csv).toBe(csv);
    const text = res.content.map((c: any) => c.text).join("\n");
    expect(text).toContain("2 rows");
    expect(text).toContain("```csv");
  });
});

describe("deleteSiteAudit", () => {
  it("reports success on a 204", async () => {
    stubFetch({ status: 204 });
    const tool = new DeleteSiteAuditTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    expect(calls[0].method).toBe("DELETE");
    expect(res.structuredContent.deleted).toBe(true);
    expect(res.structuredContent.alreadyGone).toBe(false);
  });

  it("treats an already-deleted audit as the requested end state", async () => {
    stubFetch({ ok: false, status: 404, body: { error: { message: "Not found" } } });
    const tool = new DeleteSiteAuditTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "gone" }));
    expect(res.structuredContent.alreadyGone).toBe(true);
    expect(res.content.map((c: any) => c.text).join("\n")).toMatch(/may already have been deleted/);
  });

  it("does NOT swallow a permission denial as success", async () => {
    // 403 means another org's audit. Reporting that as deleted would hide the
    // denial and invite a retry loop against something the caller cannot touch.
    stubFetch({ ok: false, status: 403, body: { error: { code: "FORBIDDEN_ORG", message: "User is not a member of this organization" } } });
    const tool = new DeleteSiteAuditTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "other-org" }));

    expect(res.isError).toBe(true);
    expect(res.structuredContent?.deleted).toBeUndefined();
    expect(JSON.stringify(res)).toMatch(/not a member/);
  });

  it("is annotated destructive", () => {
    expect(new DeleteSiteAuditTool().annotations.destructiveHint).toBe(true);
  });
});

describe("emailSiteAuditReport", () => {
  it("offers no way to choose a recipient", () => {
    // The gateway pins the address on a bearer connection; the schema must not
    // imply otherwise.
    const props = Object.keys((new EmailSiteAuditReportTool().toToolType().inputSchema as any).properties ?? {});
    expect(props).toEqual(["auditId"]);
  });

  it("is marked non-idempotent so retries are not assumed safe", () => {
    expect(new EmailSiteAuditReportTool().annotations.idempotentHint).toBe(false);
  });

  it("reports the address the server actually used", async () => {
    stubFetch({ body: { ok: true, recipient: "owner@example.com", filenames: ["summary.pdf", "pages.pdf"] } });
    const tool = new EmailSiteAuditReportTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));

    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({});
    expect(res.structuredContent.recipient).toBe("owner@example.com");
    expect(res.content.map((c: any) => c.text).join("\n")).toMatch(/only be emailed to the account owner/);
  });

  it("surfaces a rate-limit refusal rather than looking successful", async () => {
    stubFetch({ ok: false, status: 429, body: { message: "Too many report emails — please wait before sending another." } });
    const tool = new EmailSiteAuditReportTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    expect(JSON.stringify(res)).toMatch(/Too many report emails/);
  });

  it("surfaces a plan-entitlement refusal", async () => {
    stubFetch({ ok: false, status: 403, body: { error: { code: "PDF_NOT_ENABLED", message: "Your plan does not include emailing site audit reports." } } });
    const tool = new EmailSiteAuditReportTool("tok");
    const res: any = await tool.execute(tool.inputSchema.parse({ auditId: "a1" }));
    expect(JSON.stringify(res)).toContain("does not include emailing site audit reports");
  });
});
