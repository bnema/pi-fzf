import { describe, expect, it } from "vitest";

import { buildForkArgv, buildForkCommand, buildResumeArgv, buildResumeCommand } from "../src/actions.js";
import type { CandidateRecord } from "../src/records.js";

const record = { sessionId: "sess 'quoted' id" } as CandidateRecord;

describe("actions", () => {
  it("keeps shell display commands quoted while exec argv remains unsplit", () => {
    expect(buildResumeCommand(record)).toBe("pi --resume 'sess '\\''quoted'\\'' id'");
    expect(buildForkCommand(record)).toBe("pi --fork 'sess '\\''quoted'\\'' id'");
    expect(buildResumeArgv(record)).toEqual(["pi", "--resume", "sess 'quoted' id"]);
    expect(buildForkArgv(record)).toEqual(["pi", "--fork", "sess 'quoted' id"]);
  });
});
