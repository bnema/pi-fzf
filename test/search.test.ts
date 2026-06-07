import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { syncCache } from "../src/cache.js";
import { candidateLines, findRecordByKey, previewRecord, searchRecords } from "../src/search.js";
import { recordKey } from "../src/records.js";

const temps: string[] = [];
afterEach(async () => { for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pi-fzf-search-test-")); temps.push(dir);
  const sessionRoot = join(dir, "sessions"), cacheRoot = join(dir, "cache");
  await mkdir(sessionRoot, { recursive: true });
  await writeFile(join(sessionRoot, "a.jsonl"), [
    { sessionId: "s1", role: "user", content: "alpha beta", cwd: "/work/a", name: "proj-a", timestamp: "2024-01-01T00:00:00Z" },
    { sessionId: "s1", role: "assistant", content: "gamma delta", cwd: "/work/a", name: "proj-a", timestamp: "2024-01-02T00:00:00Z" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  await writeFile(join(sessionRoot, "b.jsonl"), JSON.stringify({ sessionId: "s2", role: "user", content: "omega", cwd: "/work/b" }) + "\n");
  await syncCache({ cacheRoot, sessionRoot });
  return { cacheRoot, sessionRoot };
}

describe("search", () => {
  it("returns empty-query records and candidate lines", async () => {
    const { cacheRoot } = await fixture();
    const records = await searchRecords({ cacheRoot });
    expect(records).toHaveLength(3);
    expect(await candidateLines({ cacheRoot, query: "alpha" })).toHaveLength(1);
  });

  it("supports AND, OR, regex and filters", async () => {
    const { cacheRoot } = await fixture();
    expect(await searchRecords({ cacheRoot, query: "alpha beta" })).toHaveLength(1);
    expect(await searchRecords({ cacheRoot, query: "alpha omega", tokenMode: "or" })).toHaveLength(2);
    expect(await searchRecords({ cacheRoot, query: "g.mm.", matchMode: "regex" })).toHaveLength(1);
    expect(await searchRecords({ cacheRoot, role: "assistant", project: "proj-a", since: "2024-01-02" })).toHaveLength(1);
    expect(await searchRecords({ cacheRoot, namedOnly: true })).toHaveLength(2);
  });

  it("finds records by key and builds preview neighbors", async () => {
    const { cacheRoot } = await fixture();
    const record = (await searchRecords({ cacheRoot, query: "gamma" }))[0]!;
    expect((await findRecordByKey(recordKey(record), { cacheRoot }))?.text).toContain("gamma");
    const preview = await previewRecord(recordKey(record), 1, { cacheRoot });
    expect(preview?.metadata.join("\n")).toContain("session id: s1");
    expect(preview?.neighbors[0]?.text).toContain("alpha");
  });
});
