import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { acquireLock } from "../src/locks.js";
import { resolveCacheRoot, resolveSessionRoot } from "../src/paths.js";
import { cleanCache, doctorCache, getCacheStats, rebuildCache, syncCache } from "../src/cache.js";
import { sourceKeyForPath } from "../src/records.js";

const temps: string[] = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), "pi-fzf-cache-test-"));
  temps.push(dir);
  return { dir, cacheRoot: join(dir, "cache"), sessionRoot: join(dir, "sessions") };
}

async function sessionFile(root: string, name = "one.jsonl", text = "hello cache") {
  await mkdir(root, { recursive: true });
  const path = join(root, name);
  await writeFile(path, JSON.stringify({ sessionId: "same-session", role: "user", content: text, cwd: "/work" }) + "\n");
  return path;
}

async function manifest(cacheRoot: string) {
  return JSON.parse(await readFile(join(cacheRoot, "manifest.json"), "utf8"));
}

describe("cache paths", () => {
  it("resolves cache root from env, xdg, then home", () => {
    expect(resolveCacheRoot({ env: { PI_FZF_CACHE_DIR: "/cache/env" } as any, homeDir: "/home/x" })).toBe("/cache/env");
    expect(resolveCacheRoot({ env: { XDG_CACHE_HOME: "/xdg" } as any, homeDir: "/home/x" })).toBe("/xdg/pi-fzf");
    expect(resolveCacheRoot({ env: {} as any, homeDir: "/home/x" })).toBe("/home/x/.cache/pi-fzf");
  });

  it("resolves session root from env then home", () => {
    expect(resolveSessionRoot({ env: { PI_FZF_SESSION_ROOT: "/sessions/env" } as any, homeDir: "/home/x" })).toBe("/sessions/env");
    expect(resolveSessionRoot({ env: {} as any, homeDir: "/home/x" })).toBe("/home/x/.pi/agent/sessions");
  });
});

describe("cache locks", () => {
  it("uses exclusive creation and removes stale locks", async () => {
    const { cacheRoot } = await tempRoot();
    const lockPath = join(cacheRoot, "lock");
    const lock = await acquireLock(lockPath, { now: () => 1000 });
    await expect(acquireLock(lockPath, { now: () => 1001, staleMs: 10_000 })).rejects.toThrow(/already held/);
    await lock.release();

    await writeFile(lockPath, JSON.stringify({ pid: 1, hostname: "old", timestamp: new Date(0).toISOString() }));
    const stale = await acquireLock(lockPath, { now: () => 20_000, staleMs: 10 });
    await stale.release();
  });

  it("does not remove stale-looking locks for a live pid on this host", async () => {
    const { cacheRoot } = await tempRoot();
    const lockPath = join(cacheRoot, "lock");
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, hostname: (await import("node:os")).hostname(), timestamp: new Date(0).toISOString() }));

    await expect(acquireLock(lockPath, { now: () => 20_000, staleMs: 10 })).rejects.toThrow(/already held/);
  });
});

describe("session cache", () => {
  it("indexes a first sync with source-path keyed layout and private modes", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    const source = await sessionFile(sessionRoot);
    const result = await syncCache({ cacheRoot, sessionRoot });

    expect(result).toEqual({ indexed: 1, removed: 0, parsed: 1 });
    const key = sourceKeyForPath(source);
    const m = await manifest(cacheRoot);
    expect(Object.keys(m.sources)).toEqual([source]);
    expect(m.sources[source].sourceKey).toBe(key);
    expect(m.sources[source].paths.records).toBe(join(cacheRoot, "records", `${key}.jsonl`));
    expect((await stat(cacheRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(join(cacheRoot, "records", `${key}.jsonl`))).mode & 0o777).toBe(0o600);
  });

  it("skips parsing unchanged files when observable", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    await sessionFile(sessionRoot);
    await syncCache({ cacheRoot, sessionRoot });

    await expect(syncCache({ cacheRoot, sessionRoot })).resolves.toMatchObject({ indexed: 0, removed: 0, parsed: 0 });
  });

  it("re-extracts changed files", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    const source = await sessionFile(sessionRoot, "one.jsonl", "first");
    await syncCache({ cacheRoot, sessionRoot });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(source, JSON.stringify({ sessionId: "same-session", role: "assistant", content: "second" }) + "\n");

    expect(await syncCache({ cacheRoot, sessionRoot })).toMatchObject({ indexed: 1, parsed: 1 });
    const records = await readFile(join(cacheRoot, "records", `${sourceKeyForPath(source)}.jsonl`), "utf8");
    expect(records).toContain("second");
    expect(records).not.toContain("first");
  });

  it("repairs missing shards for unchanged sources", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    const source = await sessionFile(sessionRoot, "one.jsonl", "repair needle");
    await syncCache({ cacheRoot, sessionRoot });
    await rm(join(cacheRoot, "records", `${sourceKeyForPath(source)}.jsonl`));

    expect(await syncCache({ cacheRoot, sessionRoot })).toMatchObject({ indexed: 1, parsed: 1 });
    const records = await readFile(join(cacheRoot, "records", `${sourceKeyForPath(source)}.jsonl`), "utf8");
    expect(records).toContain("repair needle");
  });

  it("reports and repairs corrupt shards for unchanged sources", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    const source = await sessionFile(sessionRoot, "one.jsonl", "repair corrupt needle");
    const recordsPath = join(cacheRoot, "records", `${sourceKeyForPath(source)}.jsonl`);
    await syncCache({ cacheRoot, sessionRoot });
    await writeFile(recordsPath, "{not json}\n");

    expect((await doctorCache({ cacheRoot, sessionRoot })).issues.some((issue) => issue.includes("corrupt records shard"))).toBe(true);
    expect(await syncCache({ cacheRoot, sessionRoot })).toMatchObject({ indexed: 1, parsed: 1 });
    expect(await readFile(recordsPath, "utf8")).toContain("repair corrupt needle");
    expect((await doctorCache({ cacheRoot, sessionRoot })).issues).toEqual([]);
  });

  it("removes shards for deleted sources", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    const source = await sessionFile(sessionRoot);
    await syncCache({ cacheRoot, sessionRoot });
    await rm(source);

    expect(await syncCache({ cacheRoot, sessionRoot })).toMatchObject({ removed: 1 });
    expect((await manifest(cacheRoot)).sources).toEqual({});
    await expect(stat(join(cacheRoot, "records", `${sourceKeyForPath(source)}.jsonl`))).rejects.toThrow();
  });

  it("invalidates for extractor/config metadata changes", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    await sessionFile(sessionRoot);
    await syncCache({ cacheRoot, sessionRoot, configHash: "a" });

    expect(await syncCache({ cacheRoot, sessionRoot, configHash: "b" })).toMatchObject({ indexed: 1, parsed: 1 });
    expect((await manifest(cacheRoot)).configHash).toBe("b");
  });

  it("rebuilds from scratch by removing only cache-owned contents", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    await sessionFile(sessionRoot);
    await syncCache({ cacheRoot, sessionRoot });
    await writeFile(join(cacheRoot, "records", "orphan.jsonl"), "{}");
    await writeFile(join(cacheRoot, "unowned.txt"), "keep");

    expect(await rebuildCache({ cacheRoot, sessionRoot })).toMatchObject({ indexed: 1, parsed: 1 });
    await expect(stat(join(cacheRoot, "records", "orphan.jsonl"))).rejects.toThrow();
    await expect(stat(join(cacheRoot, "unowned.txt"))).resolves.toBeTruthy();
  });

  it("refuses to rebuild unsafe cache roots", async () => {
    const { dir, sessionRoot } = await tempRoot();
    await mkdir(join(dir, "unsafe"), { recursive: true });

    await expect(rebuildCache({ cacheRoot: dir, sessionRoot })).rejects.toThrow(/sentinel|unsafe|overlapping/);
    await expect(rebuildCache({ cacheRoot: sessionRoot, sessionRoot })).rejects.toThrow(/unsafe|overlapping/);
  });

  it("cleans orphan shards", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    await sessionFile(sessionRoot);
    await syncCache({ cacheRoot, sessionRoot });
    await writeFile(join(cacheRoot, "records", "orphan.jsonl"), "{}");
    await writeFile(join(cacheRoot, "sessions", "orphan.json"), "{}");

    expect(await cleanCache({ cacheRoot, sessionRoot })).toEqual({ removed: 2 });
  });

  it("reports doctor issues and stats without mutating", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    const source = await sessionFile(sessionRoot);
    await syncCache({ cacheRoot, sessionRoot });
    await rm(source);

    const report = await doctorCache({ cacheRoot, sessionRoot });
    expect(report.sourceCount).toBe(1);
    expect(report.recordCount).toBeGreaterThan(0);
    expect(report.totalBytes).toBeGreaterThan(0);
    expect(report.issues.some((issue) => issue.includes("missing source"))).toBe(true);
    expect((await manifest(cacheRoot)).sources[source]).toBeTruthy();
  });

  it("handles malformed manifest objects without throwing", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(join(cacheRoot, "manifest.json"), JSON.stringify({ sources: null }));
    await mkdir(join(cacheRoot, "records"), { recursive: true });
    await mkdir(join(cacheRoot, "sessions"), { recursive: true });
    await writeFile(join(cacheRoot, "records", "orphan.jsonl"), "{}\n");

    await expect(cleanCache({ cacheRoot, sessionRoot })).resolves.toEqual({ removed: 1 });
    await expect(getCacheStats({ cacheRoot, sessionRoot })).resolves.toMatchObject({ sourceCount: 0, recordCount: 0 });
    const report = await doctorCache({ cacheRoot, sessionRoot });
    expect(report.issues).toContain("manifest metadata does not match current cache configuration");
  });

  it("handles malformed manifest source entries without throwing", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    await mkdir(join(cacheRoot, "records"), { recursive: true });
    await mkdir(join(cacheRoot, "sessions"), { recursive: true });
    await writeFile(join(cacheRoot, "records", "orphan.jsonl"), "{}\n");
    await writeFile(join(cacheRoot, "manifest.json"), JSON.stringify({
      version: 1,
      extractorVersion: 1,
      configHash: "default",
      sessionRoot,
      updatedAt: "2026-06-07T00:00:00.000Z",
      sources: {
        [join(sessionRoot, "bad.jsonl")]: {
          sourceKey: "bad",
          sessionId: "bad-session",
          mtime: 1,
          size: 1,
          recordCount: 1,
          indexedAt: "2026-06-07T00:00:00.000Z"
        }
      }
    }));

    await expect(cleanCache({ cacheRoot, sessionRoot })).resolves.toEqual({ removed: 1 });
    await expect(getCacheStats({ cacheRoot, sessionRoot })).resolves.toMatchObject({ sourceCount: 0, recordCount: 0 });
    const report = await doctorCache({ cacheRoot, sessionRoot });
    expect(report.issues).toContain("manifest metadata does not match current cache configuration");
  });

  it("returns useful cache stats", async () => {
    const { cacheRoot, sessionRoot } = await tempRoot();
    await sessionFile(sessionRoot);
    await syncCache({ cacheRoot, sessionRoot });

    expect(await getCacheStats({ cacheRoot, sessionRoot })).toMatchObject({ sourceCount: 1, recordCount: 1, shardCount: 1, sessionMetaCount: 1 });
  });
});
