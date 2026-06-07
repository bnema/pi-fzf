import { constants } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
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
      await handle.writeFile(JSON.stringify(lockPayload(now())));
      await handle.close();
      const heartbeat = setInterval(() => { void writeFile(lockPath, JSON.stringify(lockPayload(now()))).catch(() => {}); }, Math.max(1000, Math.floor(staleMs / 3)));
      heartbeat.unref?.();
      return { path: lockPath, release: async () => { clearInterval(heartbeat); await rm(lockPath, { force: true }); } };
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
    const payload = JSON.parse(raw);
    const timestamp = Date.parse(payload.timestamp);
    if (!Number.isFinite(timestamp) || now - timestamp < staleMs) return false;
    if (isLiveLock(payload)) return false;
    await rm(lockPath, { force: true });
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return true;
    return false;
  }
}

function lockPayload(now: number) {
  return { pid: process.pid, hostname: hostname(), timestamp: new Date(now).toISOString() };
}

function isLiveLock(payload: any): boolean {
  if (payload?.hostname !== hostname() || !Number.isInteger(payload?.pid) || payload.pid <= 0) return false;
  try {
    process.kill(payload.pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}
