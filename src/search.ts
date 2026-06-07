import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";

import { resolveCacheRoot, type PathResolutionOptions } from "./paths.js";
import { parseRecordKey, recordKey, toCandidateLine, type CandidateRecord } from "./records.js";
import type { SearchRole } from "./types.js";

export type TokenMode = "and" | "or";
export type MatchMode = "smart" | "fixed" | "regex";

export interface SearchOptions extends PathResolutionOptions {
  cacheRoot?: string;
  query?: string;
  tokenMode?: TokenMode;
  matchMode?: MatchMode;
  role?: SearchRole;
  project?: string;
  cwd?: string;
  since?: string;
  before?: string;
  namedOnly?: boolean;
  limit?: number;
}

export interface Preview { record: CandidateRecord; metadata: string[]; neighbors: CandidateRecord[] }

const DEFAULT_LIMIT = 5000;

export async function searchRecords(options: SearchOptions = {}): Promise<CandidateRecord[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const query = options.query?.trim() ?? "";
  const out: CandidateRecord[] = [];
  for await (const record of readAllRecords(options)) {
    if (!passesFilters(record, options)) continue;
    if (query && !matchesQuery(record, query, options)) continue;
    out.push(record);
    if (out.length >= limit) break;
  }
  return out;
}

export async function candidateLines(options: SearchOptions = {}): Promise<string[]> {
  return (await searchRecords(options)).map(toCandidateLine);
}

export async function findRecordByKey(key: string, options: SearchOptions = {}): Promise<CandidateRecord | undefined> {
  for await (const record of readAllRecords(options)) if (recordKey(record) === key) return record;
  return undefined;
}

export async function previewRecord(key: string, contextLines = 2, options: SearchOptions = {}): Promise<Preview | undefined> {
  const parsed = parseRecordKey(key);
  const found = await findRecordByKey(parsed, options);
  if (!found) return undefined;
  const searchOptions: SearchOptions = { ...options, limit: Number.MAX_SAFE_INTEGER };
  delete searchOptions.query;
  const same = (await searchRecords(searchOptions))
    .filter((r) => r.sourceKey === found.sourceKey)
    .sort((a, b) => a.sequence - b.sequence || a.chunkIndex - b.chunkIndex);
  const idx = same.findIndex((r) => recordKey(r) === recordKey(found));
  const neighbors = idx < 0 ? [] : same.slice(Math.max(0, idx - contextLines), idx).concat(same.slice(idx + 1, idx + 1 + contextLines));
  const metadata = [
    `project: ${found.sessionName ?? ""}`,
    `cwd: ${found.cwd ?? ""}`,
    `session id: ${found.sessionId}`,
    `session path: ${found.sessionPath}`,
    `role: ${found.role}`,
    `timestamp: ${found.timestamp ?? ""}`,
  ];
  return { record: found, metadata, neighbors };
}

export async function rgCandidateLines(options: SearchOptions = {}): Promise<string[]> {
  const query = options.query?.trim();
  if (!query) return candidateLines(options);
  const cacheRoot = options.cacheRoot ?? resolveCacheRoot(options);
  const token = tokenize(query)[0] ?? query;
  const args = ["--json", "--smart-case", "--glob=*.jsonl"];
  if (options.matchMode !== "regex") args.push("--fixed-strings");
  args.push(token, join(cacheRoot, "records"));
  const matches = await rgMatchingLines("rg", args);
  if (!matches) return candidateLines(options);
  const out: CandidateRecord[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    if (out.length >= (options.limit ?? DEFAULT_LIMIT)) break;
    const record = await readRecordAtLine(match.path, match.lineNumber);
    if (!record) continue;
    const key = recordKey(record);
    if (seen.has(key) || !passesFilters(record, options) || !matchesQuery(record, query, options)) continue;
    seen.add(key);
    out.push(record);
  }
  return out.map(toCandidateLine);
}

async function rgMatchingLines(command: string, args: string[]): Promise<Array<{ path: string; lineNumber: number }> | undefined> {
  return new Promise((resolve) => {
    const matches: Array<{ path: string; lineNumber: number }> = [];
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) { resolve(undefined); return; }
      for (const line of stdout.split("\n")) {
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type !== "match") continue;
          const path = event.data?.path?.text;
          const lineNumber = event.data?.line_number;
          if (typeof path === "string" && Number.isInteger(lineNumber)) matches.push({ path, lineNumber });
        } catch { resolve(undefined); return; }
      }
      resolve(matches);
    });
  });
}

async function readRecordAtLine(path: string, lineNumber: number): Promise<CandidateRecord | undefined> {
  try {
    const line = (await readFile(path, "utf8")).split("\n")[lineNumber - 1];
    return line ? JSON.parse(line) as CandidateRecord : undefined;
  } catch { return undefined; }
}

async function* readAllRecords(options: SearchOptions): AsyncGenerator<CandidateRecord> {
  const dir = join(options.cacheRoot ?? resolveCacheRoot(options), "records");
  let files: string[] = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort(); } catch { return; }
  for (const file of files) {
    const rl = createInterface({ input: createReadStream(join(dir, file), { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line) as CandidateRecord; } catch {}
    }
  }
}

function passesFilters(r: CandidateRecord, o: SearchOptions): boolean {
  if (o.role && r.role !== o.role) return false;
  if (o.project && !(r.sessionName ?? "").includes(o.project)) return false;
  if (o.cwd && r.cwd !== o.cwd) return false;
  if (o.namedOnly && !r.sessionName) return false;
  if (o.since && (!r.timestamp || r.timestamp < o.since)) return false;
  if (o.before && (!r.timestamp || r.timestamp > o.before)) return false;
  return true;
}

function matchesQuery(r: CandidateRecord, query: string, o: SearchOptions): boolean {
  const hay = `${r.display} ${r.searchText}`;
  if (o.matchMode === "regex") {
    try { return new RegExp(query, smartCaseFlags(query)).test(hay); } catch { return false; }
  }
  const tokens = tokenize(query);
  const checks = tokens.map((t) => contains(hay, t, o.matchMode === "fixed" ? false : /[A-Z]/.test(t)));
  return (o.tokenMode ?? "and") === "or" ? checks.some(Boolean) : checks.every(Boolean);
}

function contains(hay: string, needle: string, caseSensitive: boolean): boolean {
  return caseSensitive ? hay.includes(needle) : hay.toLowerCase().includes(needle.toLowerCase());
}
function tokenize(q: string): string[] { return q.split(/\s+/).filter(Boolean); }
function smartCaseFlags(q: string): string { return /[A-Z]/.test(q) ? "" : "i"; }
