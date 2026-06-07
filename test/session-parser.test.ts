import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSessionFile } from "../src/session-parser.js";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

describe("parseSessionFile", () => {
  it("extracts user and assistant text blocks", async () => {
    const parsed = await parseSessionFile(fixture("v3-basic.jsonl"));

    expect(parsed.sessionId).toBe("sess-basic");
    expect(parsed.cwd).toBe("/work/basic");
    expect(parsed.records.map((r) => [r.role, r.text])).toEqual([
      ["user", "Please help me debug the frobnicator"],
      ["assistant", "Start by checking the parser boundary."],
    ]);
  });

  it("preserves named sessions", async () => {
    const parsed = await parseSessionFile(fixture("v3-named-session.jsonl"));

    expect(parsed.sessionName).toBe("Investigate sync bug");
    expect(parsed.records[0]?.sessionName).toBe("Investigate sync bug");
  });

  it("skips tool and execution noise", async () => {
    const parsed = await parseSessionFile(fixture("v3-tool-noise.jsonl"));
    const text = parsed.records.map((r) => r.text).join(" ");

    expect(text).toContain("Human-visible answer survives");
    expect(text).not.toContain("toolCall should be skipped");
    expect(text).not.toContain("toolResult should be skipped");
    expect(text).not.toContain("bashExecution should be skipped");
    expect(text).not.toContain("thinking should be skipped");
    expect(text).not.toContain("AAAAABBBBBCCCCCDDDDDEEEEEFFFFFGGGGG");
  });

  it("extracts compaction and branch summaries", async () => {
    const parsed = await parseSessionFile(fixture("v3-compaction-branch.jsonl"));

    expect(parsed.records.map((r) => [r.role, r.text])).toEqual([
      ["compaction", "Compaction kept the parser decision."],
      ["branch_summary", "Branch summary mentions records API."],
    ]);
  });

  it("ignores malformed JSON lines", async () => {
    const parsed = await parseSessionFile(fixture("v3-invalid-line.jsonl"));

    expect(parsed.records.map((r) => r.text)).toEqual([
      "Valid user before invalid JSON",
      "Valid assistant after invalid JSON",
    ]);
  });
});
