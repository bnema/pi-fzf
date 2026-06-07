import { constants } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";

export interface LockOptions {
  staleMs?: number;
  now?: () => number;
}

export interface CacheLock {
  path: string;
  release(): Promise<void>;
}

const DEFAULT_STALE_MS = 10 * 60 * 1000;

export async function acquireLock(lockPath: string, options: LockOptions = {}): Promise<CacheLock> {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now ?? Date.now;
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, hostname: hostname(), timestamp: new Date(now()).toISOString() }));
      await handle.close();
      return { path: lockPath, release: async () => void (await rm(lockPath, { force: true })) };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      if (!(await removeIfStale(lockPath, staleMs, now()))) throw new Error(`cache lock already held: ${lockPath}`);
    }
  }
  throw new Error(`cache lock already held: ${lockPath}`);
}

async function removeIfStale(lockPath: string, staleMs: number, now: number): Promise<boolean> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const timestamp = Date.parse(JSON.parse(raw).timestamp);
    if (!Number.isFinite(timestamp) || now - timestamp < staleMs) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
}
