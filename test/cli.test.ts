import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";

const temps: string[] = [];
let previousCacheDir: string | undefined;
let previousSessionRoot: string | undefined;

beforeEach(() => {
  previousCacheDir = process.env.PI_FZF_CACHE_DIR;
  previousSessionRoot = process.env.PI_FZF_SESSION_ROOT;
});

function restoreEnv(name: "PI_FZF_CACHE_DIR" | "PI_FZF_SESSION_ROOT", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(async () => {
  vi.restoreAllMocks();
  restoreEnv("PI_FZF_CACHE_DIR", previousCacheDir);
  restoreEnv("PI_FZF_SESSION_ROOT", previousSessionRoot);
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function roots() {
  const dir = await mkdtemp(join(tmpdir(), "pi-fzf-cli-test-")); temps.push(dir);
  const sessionRoot = join(dir, "sessions"), cacheRoot = join(dir, "cache");
  await mkdir(sessionRoot, { recursive: true });
  await writeFile(join(sessionRoot, "one.jsonl"), JSON.stringify({ sessionId: "cli-session", role: "user", content: "find me --help", cwd: "/work", name: "cli-proj" }) + "\n");
  return { cacheRoot, sessionRoot };
}

async function capture(fn: () => Promise<void>) {
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((s = "") => { logs.push(String(s)); });
  await fn();
  return logs.join("\n");
}

describe("cli", () => {
  it("prints help", async () => {
    const out = await capture(() => main(["--help"]));
    expect(out).toContain("pi-fzf search");
  });

  it("indexes and searches noninteractively", async () => {
    const { cacheRoot, sessionRoot } = await roots();
    process.env.PI_FZF_CACHE_DIR = cacheRoot;
    process.env.PI_FZF_SESSION_ROOT = sessionRoot;
    await capture(() => main(["index"]));
    const out = await capture(() => main(["search", "find", "--no-fzf", "--print-session-id"]));
    expect(out).toContain("cli-session");
  });

  it("supports query values that start with dashes", async () => {
    const { cacheRoot, sessionRoot } = await roots();
    process.env.PI_FZF_CACHE_DIR = cacheRoot;
    process.env.PI_FZF_SESSION_ROOT = sessionRoot;
    await capture(() => main(["index"]));

    const out = await capture(() => main(["search", "--query=--help", "--no-fzf", "--print-session-id"]));

    expect(out).toContain("cli-session");
  });

  it("rejects invalid limits", async () => {
    await expect(main(["search", "find", "--no-fzf", "--limit"])).rejects.toThrow(/--limit requires a positive integer/);
    await expect(main(["search", "find", "--no-fzf", "--limit", "0"])).rejects.toThrow(/--limit requires a positive integer/);
    await expect(main(["search", "find", "--no-fzf", "--limit", "nope"])).rejects.toThrow(/--limit requires a positive integer/);
  });

  it("prints preview for a selected key", async () => {
    const { cacheRoot, sessionRoot } = await roots();
    process.env.PI_FZF_CACHE_DIR = cacheRoot;
    process.env.PI_FZF_SESSION_ROOT = sessionRoot;
    await capture(() => main(["index"]));
    const candidates = await capture(() => main(["candidates", "--query", "find"]));
    const key = candidates.split("\t")[0]!;
    const preview = await capture(() => main(["preview", "--key", key]));
    expect(preview).toContain("session id: cli-session");
  });

  it("prints the matched snippet instead of the newest session message", async () => {
    const { cacheRoot, sessionRoot } = await roots();
    process.env.PI_FZF_CACHE_DIR = cacheRoot;
    process.env.PI_FZF_SESSION_ROOT = sessionRoot;
    await writeFile(join(sessionRoot, "two.jsonl"), [
      { sessionId: "snippet-session", role: "user", content: "matched old needle", cwd: "/work", timestamp: "2024-01-01T00:00:00Z" },
      { sessionId: "snippet-session", role: "assistant", content: "new unrelated message", cwd: "/work", timestamp: "2024-01-02T00:00:00Z" },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    await capture(() => main(["index"]));

    const out = await capture(() => main(["search", "needle", "--no-fzf", "--print-snippet"]));

    expect(out).toContain("matched old needle");
    expect(out).not.toContain("new unrelated message");
  });

  it("ignores preview calls with an empty fzf key", async () => {
    const out = await capture(() => main(["preview", "--key", "--query", "find"]));

    expect(out).toBe("");
  });
});
