import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

import { acquireLock } from "./locks.js";
import { resolveCacheRoot, resolveSessionRoot, type PathResolutionOptions } from "./paths.js";
import { recordsFromParsedSession, sourceKeyForPath } from "./records.js";
import { parseSessionFile } from "./session-parser.js";
import { CACHE_VERSION, EXTRACTOR_VERSION } from "./types.js";

export interface CacheSourceEntry {
  sourceKey: string;
  sessionId: string;
  paths: { source: string; records: string; session: string };
  mtime: number;
  size: number;
  recordCount: number;
  indexedAt: string;
}

export interface CacheManifest {
  version: number;
  extractorVersion: number;
  configHash: string;
  sessionRoot: string;
  updatedAt: string;
  sources: Record<string, CacheSourceEntry>;
}

export interface CacheOptions extends PathResolutionOptions {
  cacheRoot?: string;
  sessionRoot?: string;
  configHash?: string;
}

export interface SyncResult { indexed: number; removed: number; parsed: number }
export interface CacheStats { sourceCount: number; recordCount: number; shardCount: number; sessionMetaCount: number; totalBytes: number }
export interface DoctorReport extends CacheStats { issues: string[] }

const DEFAULT_CONFIG_HASH = "default";
const CACHE_SENTINEL = ".pi-fzf-cache";

export async function syncCache(options: CacheOptions = {}): Promise<SyncResult> {
  return withLock(options, async (ctx) => {
    let manifest = await readManifest(ctx);
    if (invalidManifest(manifest, ctx)) manifest = freshManifest(ctx);
    const files = await findJsonl(ctx.sessionRoot);
    const seen = new Set(files);
    let indexed = 0, parsed = 0, removed = 0;

    for (const sourcePath of files) {
      const st = await stat(sourcePath);
      const previous = manifest.sources[sourcePath];
      if (previous && previous.mtime === st.mtimeMs && previous.size === st.size) continue;
      const parsedSession = await parseSessionFile(sourcePath);
      const records = recordsFromParsedSession(parsedSession);
      const sourceKey = sourceKeyForPath(sourcePath);
      const recordsPath = join(ctx.cacheRoot, "records", `${sourceKey}.jsonl`);
      const sessionPath = join(ctx.cacheRoot, "sessions", `${sourceKey}.json`);
      await atomicWrite(recordsPath, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
      await atomicWrite(sessionPath, JSON.stringify({ sourcePath, sessionId: parsedSession.sessionId, cwd: parsedSession.cwd, sessionName: parsedSession.sessionName }, null, 2));
      manifest.sources[sourcePath] = {
        sourceKey,
        sessionId: parsedSession.sessionId,
        paths: { source: sourcePath, records: recordsPath, session: sessionPath },
        mtime: st.mtimeMs,
        size: st.size,
        recordCount: records.length,
        indexedAt: new Date().toISOString(),
      };
      indexed++; parsed++;
    }

    for (const sourcePath of Object.keys(manifest.sources)) {
      if (seen.has(sourcePath)) continue;
      await removeSourceShards(manifest.sources[sourcePath]!);
      delete manifest.sources[sourcePath];
      removed++;
    }

    manifest.updatedAt = new Date().toISOString();
    await writeManifest(ctx, manifest);
    return { indexed, removed, parsed };
  });
}

export async function rebuildCache(options: CacheOptions = {}): Promise<SyncResult> {
  const ctx = context(options);
  await validateCacheRootForDestructiveOperation(ctx);
  await removeCacheOwnedContents(ctx.cacheRoot);
  return syncCache(options);
}

export async function cleanCache(options: CacheOptions = {}): Promise<{ removed: number }> {
  return withLock(options, async (ctx) => {
    const manifest = validManifestOrFresh(await readManifest(ctx), ctx);
    const live = new Set(Object.values(manifest.sources).flatMap((s) => [s.paths.records, s.paths.session]));
    let removed = 0;
    for (const dir of [join(ctx.cacheRoot, "records"), join(ctx.cacheRoot, "sessions")]) {
      for (const file of await listFiles(dir)) if (!live.has(file)) { await rm(file, { force: true }); removed++; }
    }
    return { removed };
  });
}

export async function doctorCache(options: CacheOptions = {}): Promise<DoctorReport> {
  const ctx = context(options);
  const manifest = await readManifest(ctx);
  const stats = await getCacheStats(options);
  const issues: string[] = [];
  const manifestInvalid = invalidManifest(manifest, ctx);
  if (manifestInvalid) issues.push("manifest metadata does not match current cache configuration");
  for (const [sourcePath, source] of Object.entries(manifestInvalid ? {} : manifest.sources)) {
    if (!(await exists(sourcePath))) issues.push(`missing source: ${sourcePath}`);
    if (!(await exists(source.paths.records))) issues.push(`missing records shard: ${source.paths.records}`);
    if (!(await exists(source.paths.session))) issues.push(`missing session metadata: ${source.paths.session}`);
  }
  return { ...stats, issues };
}

export async function getCacheStats(options: CacheOptions = {}): Promise<CacheStats> {
  const ctx = context(options);
  const manifest = validManifestOrFresh(await readManifest(ctx), ctx);
  const recordFiles = await listFiles(join(ctx.cacheRoot, "records"));
  const sessionFiles = await listFiles(join(ctx.cacheRoot, "sessions"));
  const allFiles = [join(ctx.cacheRoot, "manifest.json"), ...recordFiles, ...sessionFiles].filter((p) => p);
  let totalBytes = 0;
  for (const file of allFiles) try { totalBytes += (await stat(file)).size; } catch {}
  return { sourceCount: Object.keys(manifest.sources).length, recordCount: Object.values(manifest.sources).reduce((n, s) => n + s.recordCount, 0), shardCount: recordFiles.length, sessionMetaCount: sessionFiles.length, totalBytes };
}

async function withLock<T>(options: CacheOptions, fn: (ctx: ReturnType<typeof context>) => Promise<T>): Promise<T> {
  const ctx = context(options);
  await ensureLayout(ctx.cacheRoot);
  const lock = await acquireLock(join(ctx.cacheRoot, "lock"));
  try { return await fn(ctx); } finally { await lock.release(); }
}

function context(options: CacheOptions) {
  return { cacheRoot: options.cacheRoot ?? resolveCacheRoot(options), sessionRoot: options.sessionRoot ?? resolveSessionRoot(options), configHash: options.configHash ?? DEFAULT_CONFIG_HASH };
}

function freshManifest(ctx: ReturnType<typeof context>): CacheManifest {
  return { version: CACHE_VERSION, extractorVersion: EXTRACTOR_VERSION, configHash: ctx.configHash, sessionRoot: ctx.sessionRoot, updatedAt: new Date().toISOString(), sources: {} };
}

function invalidManifest(manifest: CacheManifest, ctx: ReturnType<typeof context>) {
  return !isManifestShape(manifest) || manifest.version !== CACHE_VERSION || manifest.extractorVersion !== EXTRACTOR_VERSION || manifest.configHash !== ctx.configHash || manifest.sessionRoot !== ctx.sessionRoot;
}

function validManifestOrFresh(manifest: CacheManifest, ctx: ReturnType<typeof context>): CacheManifest {
  return invalidManifest(manifest, ctx) ? freshManifest(ctx) : manifest;
}

function isManifestShape(manifest: CacheManifest): boolean {
  return !!manifest && typeof manifest === "object" && typeof manifest.sources === "object" && manifest.sources !== null && !Array.isArray(manifest.sources);
}

async function readManifest(ctx: ReturnType<typeof context>): Promise<CacheManifest> {
  try { return JSON.parse(await readFile(join(ctx.cacheRoot, "manifest.json"), "utf8")); } catch { return freshManifest(ctx); }
}
async function writeManifest(ctx: ReturnType<typeof context>, manifest: CacheManifest) { await atomicWrite(join(ctx.cacheRoot, "manifest.json"), JSON.stringify(manifest, null, 2)); }
async function ensureLayout(cacheRoot: string) { await mkdir(join(cacheRoot, "records"), { recursive: true, mode: 0o700 }); await mkdir(join(cacheRoot, "sessions"), { recursive: true, mode: 0o700 }); await writeFile(join(cacheRoot, CACHE_SENTINEL), "pi-fzf cache\n", { mode: 0o600 }); }
async function atomicWrite(path: string, content: string) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const tmp = `${path}.tmp-${process.pid}-${Date.now()}`; await writeFile(tmp, content, { mode: 0o600 }); await rename(tmp, path); }
async function removeSourceShards(source: CacheSourceEntry) { await rm(source.paths.records, { force: true }); await rm(source.paths.session, { force: true }); }
async function exists(path: string) { try { await access(path, constants.F_OK); return true; } catch { return false; } }

async function validateCacheRootForDestructiveOperation(ctx: ReturnType<typeof context>) {
  const cacheRoot = resolve(ctx.cacheRoot);
  const sessionRoot = resolve(ctx.sessionRoot);
  const forbidden = new Set([parse(cacheRoot).root, resolve(homedir()), resolve(process.cwd()), resolve(tmpdir()), sessionRoot]);
  if (forbidden.has(cacheRoot)) throw new Error(`refusing to rebuild unsafe cache root: ${ctx.cacheRoot}`);
  if (sessionRoot.startsWith(cacheRoot + "/") || cacheRoot.startsWith(sessionRoot + "/")) throw new Error(`refusing to rebuild cache root overlapping session root: ${ctx.cacheRoot}`);

  const parent = dirname(cacheRoot);
  if (await exists(cacheRoot)) {
    const [realCacheRoot, realParent] = await Promise.all([realpath(cacheRoot), realpath(parent).catch(() => parent)]);
    if (realCacheRoot === realParent || forbidden.has(realCacheRoot)) throw new Error(`refusing to rebuild unsafe cache root: ${ctx.cacheRoot}`);
    if (!(await exists(join(cacheRoot, CACHE_SENTINEL))) && !(await exists(join(cacheRoot, "manifest.json")))) {
      throw new Error(`refusing to rebuild cache root without pi-fzf sentinel or manifest: ${ctx.cacheRoot}`);
    }
  }
}

async function removeCacheOwnedContents(cacheRoot: string) {
  for (const name of ["records", "sessions", "manifest.json", "lock", CACHE_SENTINEL]) {
    await rm(join(cacheRoot, name), { recursive: true, force: true });
  }
}

async function findJsonl(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
    }
  }
  await walk(root);
  return out.sort();
}

async function listFiles(dir: string): Promise<string[]> {
  try { return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(dir, e.name)); } catch { return []; }
}
