import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { syncCache } from "../src/cache.js";
import { candidateLines, findRecordByKey, previewRecord, rgCandidateLines, searchRecords } from "../src/search.js";
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
  await writeFile(join(sessionRoot, "b.jsonl"), JSON.stringify({ sessionId: "s2", role: "user", content: "omega", cwd: "/work/b", timestamp: "2024-01-03T00:00:00Z" }) + "\n");
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

  it("orders matches by most recent timestamp before applying limit", async () => {
    const { cacheRoot } = await fixture();
    const records = await searchRecords({ cacheRoot, tokenMode: "or", query: "alpha gamma omega", limit: 2 });

    expect(records.map((record) => record.text)).toEqual(["omega", "gamma delta"]);
  });

  it("finds records by key and builds preview neighbors", async () => {
    const { cacheRoot } = await fixture();
    const record = (await searchRecords({ cacheRoot, query: "gamma" }))[0]!;
    expect((await findRecordByKey(recordKey(record), { cacheRoot }))?.text).toContain("gamma");
    const preview = await previewRecord(recordKey(record), 1, { cacheRoot });
    expect(preview?.metadata.join("\n")).toContain("session id: s1");
    expect(preview?.records.map((previewRecord) => previewRecord.text)).toEqual(["alpha beta", "gamma delta"]);
  });

  it("uses rg candidate prefilter for non-empty searches while preserving filters", async () => {
    const { cacheRoot } = await fixture();
    const lines = await rgCandidateLines({ cacheRoot, query: "alpha beta", role: "user" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("alpha beta");
    expect(await rgCandidateLines({ cacheRoot, query: "alpha beta", role: "assistant" })).toHaveLength(0);
  });

  it("matches plain queries case-insensitively before fzf", async () => {
    const { cacheRoot } = await fixture();

    expect(await searchRecords({ cacheRoot, query: "ALPHA" })).toHaveLength(1);
    expect(await rgCandidateLines({ cacheRoot, query: "ALPHA" })).toHaveLength(1);
  });

  it("keeps rg OR searches equivalent to full candidate scanning", async () => {
    const { cacheRoot } = await fixture();
    const options = { cacheRoot, query: "alpha omega", tokenMode: "or" as const };
    const scannedKeys = (await candidateLines(options)).map((line) => line.split("\t", 1)[0]);
    const rgKeys = (await rgCandidateLines(options)).map((line) => line.split("\t", 1)[0]);
    expect(rgKeys).toEqual(scannedKeys);
  });

  it("groups many rg matches from one shard into one session candidate", async () => {
    const { cacheRoot } = await fixture();
    const recordsDir = join(cacheRoot, "records");
    const many = Array.from({ length: 200 }, (_, i) => ({
      cacheVersion: 1,
      extractorVersion: 1,
      sourceKey: "aaaaaaaaaaaaaaaa",
      sessionId: "large",
      sessionPath: "/tmp/large.jsonl",
      role: "user",
      text: `needle ${i}`,
      sequence: i,
      chunkIndex: 0,
      display: `large — user — needle ${i}`,
      searchText: `needle ${i}`,
    }));
    await writeFile(join(recordsDir, "aaaaaaaaaaaaaaaa.jsonl"), many.map((record) => JSON.stringify(record)).join("\n") + "\n");

    const lines = await rgCandidateLines({ cacheRoot, query: "needle", limit: 3 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.split("\t")[0]).toBe("aaaaaaaaaaaaaaaa");
    expect(lines[0]).toContain("200 matches");
  });

  it("builds preview from the selected record source shard", async () => {
    const { cacheRoot } = await fixture();
    const selected = (await searchRecords({ cacheRoot, query: "omega" }))[0]!;
    const preview = await previewRecord(recordKey(selected), 1, { cacheRoot, query: "alpha" });
    expect(preview?.record.text).toBe("omega");
    expect(preview?.neighbors).toHaveLength(0);
  });
});
