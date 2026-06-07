import { describe, expect, it } from "vitest";

import { buildForkArgv, buildForkCommand, buildResumeArgv, buildResumeCommand } from "../src/actions.js";
import type { CandidateRecord } from "../src/records.js";

const record = { sessionId: "sess 'quoted' id", sessionPath: "/tmp/session 'quoted'.jsonl", cwd: "/tmp/work dir" } as CandidateRecord;

describe("actions", () => {
  it("keeps shell display commands quoted while exec argv remains unsplit", () => {
    expect(buildResumeCommand(record)).toBe("cd '/tmp/work dir' && pi --session '/tmp/session '\\''quoted'\\''.jsonl'");
    expect(buildForkCommand(record)).toBe("cd '/tmp/work dir' && pi --fork '/tmp/session '\\''quoted'\\''.jsonl'");
    expect(buildResumeArgv(record)).toEqual(["pi", "--session", "/tmp/session 'quoted'.jsonl"]);
    expect(buildForkArgv(record)).toEqual(["pi", "--fork", "/tmp/session 'quoted'.jsonl"]);
  });
});
