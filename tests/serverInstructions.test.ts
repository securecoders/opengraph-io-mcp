import { describe, it, expect } from "vitest";
import { SERVER_INSTRUCTIONS } from "@/mcp";
import { registeredToolNames } from "@/tools/registry";

// SERVER_INSTRUCTIONS is hand-written cross-tool guidance sent to every client on
// connect — it carries advice (tool selection, shared fetch parameters) that no
// single tool description holds, so it is deliberately not generated. This guards
// the one failure mode that matters: a tool being registered and never mentioned.
describe("server instructions", () => {
  it("mentions every registered tool", () => {
    const missing = registeredToolNames.filter((name) => !SERVER_INSTRUCTIONS.includes(name));
    expect(missing, `tools absent from SERVER_INSTRUCTIONS: ${missing.join(", ")}`).toEqual([]);
  });

  it("names no tool that is not registered", () => {
    // Catches a tool that was renamed or removed but left in the prose.
    const mentioned = SERVER_INSTRUCTIONS.match(/\b(?:get|start|discover|preview|generate|iterate|inspect|export)[A-Z]\w+/g) ?? [];
    const stale = [...new Set(mentioned)].filter((n) => !registeredToolNames.includes(n as never));
    expect(stale, `names in SERVER_INSTRUCTIONS with no registered tool: ${stale.join(", ")}`).toEqual([]);
  });
});
