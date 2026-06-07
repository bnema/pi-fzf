import { describe, expect, it } from "vitest";

import {
  normalizeText,
  parseRecordKey,
  recordKey,
  recordsFromParsedSession,
  sourceKeyForPath,
  toCandidateLine,
} from "../src/records.js";
import type { ParsedSession } from "../src/session-parser.js";

const parsed = (overrides: Partial<ParsedSession> = {}): ParsedSession => ({
  sessionId: "duplicate-session",
  sourcePath: "/tmp/a/session.jsonl",
  records: [],
  ...overrides,
});

describe("records", () => {
  it("creates stable source keys from absolute paths", () => {
    expect(sourceKeyForPath("/tmp/a/session.jsonl")).toBe(sourceKeyForPath("/tmp/a/session.jsonl"));
    expect(sourceKeyForPath("/tmp/a/session.jsonl")).toMatch(/^[0-9a-f]{16,24}$/);
  });

  it("distinguishes duplicate session ids from different source paths", () => {
    const a = recordsFromParsedSession(parsed({ sourcePath: "/tmp/a/session.jsonl", records: [{ role: "user", text: "one", sequence: 0 }] }));
    const b = recordsFromParsedSession(parsed({ sourcePath: "/tmp/b/session.jsonl", records: [{ role: "user", text: "two", sequence: 0 }] }));

    expect(a[0]?.sessionId).toBe(b[0]?.sessionId);
    expect(a[0]?.sourceKey).not.toBe(b[0]?.sourceKey);
  });

  it("normalizes tabs, newlines, ANSI sequences, and control characters", () => {
    expect(normalizeText("hello\t\u001b[31mred\u001b[0m\nworld\u0007done")).toBe("hello red world done");
  });

  it("chunks large text into bounded records", () => {
    const records = recordsFromParsedSession(parsed({ records: [{ role: "assistant", text: "x".repeat(5000), sequence: 7 }] }), { chunkSize: 2000 });

    expect(records).toHaveLength(3);
    expect(records.map((r) => r.chunkIndex)).toEqual([0, 1, 2]);
    expect(records.every((r) => r.searchText.length <= 2000)).toBe(true);
  });

  it("formats fzf candidate lines as key, display, and search text", () => {
    const [record] = recordsFromParsedSession(parsed({ records: [{ role: "user", text: "Find me", sequence: 2 }] }));
    const line = toCandidateLine(record!);

    expect(line).toBe(`${recordKey(record!)}\t${record!.display}\t${record!.searchText}`);
    expect(line.split("\t")).toHaveLength(3);
  });

  it("parses selected record keys from full candidate lines or bare keys", () => {
    const [record] = recordsFromParsedSession(parsed({ records: [{ role: "user", text: "Find me", sequence: 2 }] }));
    const key = recordKey(record!);

    expect(parseRecordKey(`${key}\tDisplay\tSearch`)).toBe(key);
    expect(parseRecordKey(key)).toBe(key);
  });
});
