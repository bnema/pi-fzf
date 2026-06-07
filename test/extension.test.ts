import { describe, expect, it } from "vitest";

import { PiFzfPicker, parseFzfArgs, sessionResults } from "../extensions/index.js";
import type { CandidateRecord } from "../src/records.js";

function record(overrides: Partial<CandidateRecord>): CandidateRecord {
  return {
    cacheVersion: 1,
    extractorVersion: 1,
    sourceKey: "source-a",
    sessionId: "session-a",
    sessionPath: "/tmp/session-a.jsonl",
    role: "user",
    text: "",
    sequence: 0,
    chunkIndex: 0,
    display: "",
    searchText: "",
    timestamp: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("pi extension /fzf", () => {
  it("parses slash command query strings", () => {
    expect(parseFzfArgs("worktree bug")).toEqual({ kind: "search", query: "worktree bug", external: false });
    expect(parseFzfArgs("worktree bug --external")).toEqual({ kind: "search", query: "worktree bug", external: true });
    expect(parseFzfArgs("index")).toEqual({ kind: "index" });
  });

  it("filters records by query and returns one best record per session", () => {
    const results = sessionResults([
      record({ sourceKey: "source-a", sessionId: "a", text: "old needle", searchText: "old needle", timestamp: "2024-01-01T00:00:00Z", sequence: 0 }),
      record({ sourceKey: "source-a", sessionId: "a", text: "new unrelated", searchText: "new unrelated", timestamp: "2024-01-02T00:00:00Z", sequence: 1 }),
      record({ sourceKey: "source-b", sessionId: "b", text: "needle other", searchText: "needle other", timestamp: "2024-01-03T00:00:00Z", sequence: 0 }),
    ], "needle");

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.sessionId)).toEqual(["b", "a"]);
    expect(results[1]?.text).toBe("old needle");
  });

  it("supports multi-token AND filtering across session text", () => {
    const results = sessionResults([
      record({ sourceKey: "source-a", sessionId: "a", text: "alpha separated beta", searchText: "alpha separated beta" }),
      record({ sourceKey: "source-b", sessionId: "b", text: "alpha only", searchText: "alpha only" }),
    ], "alpha beta");

    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("a");
  });

  it("renders the custom picker with a frame and preview", () => {
    const picker = new PiFzfPicker([
      record({ sourceKey: "source-a", sessionId: "a", sessionName: "alpha", text: "first preview text", searchText: "first preview text", timestamp: "2024-01-01T00:00:00Z" }),
    ], "", { matches: () => false }, () => {}, () => {}, { fg: (_color, text) => text, bg: (_color, text) => text });

    const lines = picker.render(80);

    expect(lines[0]).toMatch(/^╭─ \/fzf/);
    expect(lines).toContainEqual(expect.stringMatching(/^│ preview\s+│$/));
    expect(lines.some((line) => line.includes("first preview text"))).toBe(true);
    expect(lines.at(-1)).toMatch(/^╰/);
  });

  it("lets printable j and k characters update the query", () => {
    const picker = new PiFzfPicker([
      record({ sourceKey: "source-a", sessionId: "a", text: "json keyword", searchText: "json keyword" }),
    ], "", { matches: () => false }, () => {}, () => {}, { fg: (_color, text) => text, bg: (_color, text) => text });

    picker.handleInput("j");
    picker.handleInput("k");

    expect(picker.render(80).some((line) => line.includes("query: jk"))).toBe(true);
  });
});
