import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";

const temps: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true }); });

async function roots() {
  const dir = await mkdtemp(join(tmpdir(), "pi-fzf-cli-test-")); temps.push(dir);
  const sessionRoot = join(dir, "sessions"), cacheRoot = join(dir, "cache");
  await mkdir(sessionRoot, { recursive: true });
  await writeFile(join(sessionRoot, "one.jsonl"), JSON.stringify({ sessionId: "cli-session", role: "user", content: "find me", cwd: "/work", name: "cli-proj" }) + "\n");
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
    delete process.env.PI_FZF_CACHE_DIR; delete process.env.PI_FZF_SESSION_ROOT;
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
    delete process.env.PI_FZF_CACHE_DIR; delete process.env.PI_FZF_SESSION_ROOT;
  });
});
