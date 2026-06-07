import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
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
const RG_MATCH_OVERFETCH_FACTOR = 20;
const RG_MATCH_MIN_PREFILTER = 200;
const RG_MATCH_MAX_PREFILTER = 20_000;

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
  const parsed = parseRecordKey(key);
  const keyParts = parseKeyParts(parsed);
  if (keyParts) {
    const records = await readSourceRecords(keyParts.sourceKey, options);
    for (const record of records) if (recordKey(record) === parsed) return record;
    return undefined;
  }
  for await (const record of readAllRecords(options)) if (recordKey(record) === parsed) return record;
  return undefined;
}

export async function previewRecord(key: string, contextLines = 2, options: SearchOptions = {}): Promise<Preview | undefined> {
  const parsed = parseRecordKey(key);
  const keyParts = parseKeyParts(parsed);
  const same = keyParts ? await readSourceRecords(keyParts.sourceKey, options) : [];
  const found = same.find((r) => recordKey(r) === parsed) ?? await findRecordByKey(parsed, options);
  if (!found) return undefined;
  const sourceRecords = same.length ? same : await readSourceRecords(found.sourceKey, options);
  const sorted = sourceRecords.sort((a, b) => a.sequence - b.sequence || a.chunkIndex - b.chunkIndex);
  const idx = sorted.findIndex((r) => recordKey(r) === recordKey(found));
  const neighbors = idx < 0 ? [] : sorted.slice(Math.max(0, idx - contextLines), idx).concat(sorted.slice(idx + 1, idx + 1 + contextLines));
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
  const args = rgArgsForQuery(query, options, join(cacheRoot, "records"));
  const matchesByPath = await rgMatchingLines("rg", args, rgPrefilterLimit(options.limit ?? DEFAULT_LIMIT));
  if (!matchesByPath) return candidateLines(options);
  const out: CandidateRecord[] = [];
  const seen = new Set<string>();
  for (const [path, lineNumbers] of [...matchesByPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (out.length >= (options.limit ?? DEFAULT_LIMIT)) break;
    for (const record of await readRecordsAtLines(path, lineNumbers)) {
      if (out.length >= (options.limit ?? DEFAULT_LIMIT)) break;
      const key = recordKey(record);
      if (seen.has(key) || !passesFilters(record, options) || !matchesQuery(record, query, options)) continue;
      seen.add(key);
      out.push(record);
    }
  }
  return out.map(toCandidateLine);
}

function rgArgsForQuery(query: string, options: SearchOptions, recordsDir: string): string[] {
  const args = ["--json", "--ignore-case", "--glob=*.jsonl"];
  if (options.matchMode !== "regex") args.push("--fixed-strings");
  const patterns = options.matchMode === "regex" || (options.tokenMode ?? "and") === "and" ? [query] : tokenize(query);
  for (const pattern of patterns) args.push("-e", pattern);
  args.push(recordsDir);
  return args;
}

async function rgMatchingLines(command: string, args: string[], maxMatches: number): Promise<Map<string, Set<number>> | undefined> {
  return new Promise((resolve) => {
    const matches = new Map<string, Set<number>>();
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let buffer = "";
    let settled = false;
    let stoppingAfterLimit = false;
    let matchCount = 0;
    const finish = (value: Map<string, Set<number>> | undefined) => { if (!settled) { settled = true; resolve(value); } };
    const stopIfFull = () => {
      if (matchCount < maxMatches || stoppingAfterLimit) return false;
      stoppingAfterLimit = true;
      child.kill();
      return true;
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stoppingAfterLimit) return;
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line) {
          const result = collectRgMatch(line, matches);
          if (result === undefined) { child.kill(); finish(undefined); return; }
          matchCount += result;
          if (stopIfFull()) return;
        }
        newline = buffer.indexOf("\n");
      }
    });
    child.on("error", () => finish(undefined));
    child.on("close", (code) => {
      if (settled) return;
      if (!stoppingAfterLimit && code !== 0 && code !== 1) { finish(undefined); return; }
      if (!stoppingAfterLimit && buffer) {
        const result = collectRgMatch(buffer, matches);
        if (result === undefined) { finish(undefined); return; }
      }
      finish(matches);
    });
  });
}

function collectRgMatch(line: string, matches: Map<string, Set<number>>): number | undefined {
  try {
    const event = JSON.parse(line);
    if (event.type !== "match") return 0;
    const path = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    if (typeof path === "string" && Number.isInteger(lineNumber)) {
      const lines = matches.get(path) ?? new Set<number>();
      const before = lines.size;
      lines.add(lineNumber);
      matches.set(path, lines);
      return lines.size > before ? 1 : 0;
    }
    return 0;
  } catch { return undefined; }
}

function rgPrefilterLimit(limit: number): number {
  return Math.min(RG_MATCH_MAX_PREFILTER, Math.max(RG_MATCH_MIN_PREFILTER, limit * RG_MATCH_OVERFETCH_FACTOR));
}

async function readRecordsAtLines(path: string, lineNumbers: Set<number>): Promise<CandidateRecord[]> {
  const out: CandidateRecord[] = [];
  const wanted = new Set([...lineNumbers].sort((a, b) => a - b));
  let lineNumber = 0;
  try {
    for await (const line of readJsonlLines(path)) {
      lineNumber++;
      if (!wanted.has(lineNumber)) continue;
      try { out.push(JSON.parse(line) as CandidateRecord); } catch {}
      if (out.length >= lineNumbers.size) break;
    }
  } catch { return []; }
  return out;
}

async function readSourceRecords(sourceKey: string, options: SearchOptions): Promise<CandidateRecord[]> {
  const path = join(options.cacheRoot ?? resolveCacheRoot(options), "records", `${sourceKey}.jsonl`);
  const records: CandidateRecord[] = [];
  try {
    for await (const line of readJsonlLines(path)) {
      try { records.push(JSON.parse(line) as CandidateRecord); } catch {}
    }
  } catch { return []; }
  return records;
}

async function* readAllRecords(options: SearchOptions): AsyncGenerator<CandidateRecord> {
  const dir = join(options.cacheRoot ?? resolveCacheRoot(options), "records");
  let files: string[] = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort(); } catch { return; }
  for (const file of files) {
    for await (const line of readJsonlLines(join(dir, file))) {
      try { yield JSON.parse(line) as CandidateRecord; } catch {}
    }
  }
}

async function* readJsonlLines(path: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield line;
}

function parseKeyParts(key: string): { sourceKey: string; sequence: number; chunkIndex: number } | undefined {
  const [sourceKey, sequence, chunkIndex] = key.split(":");
  if (!sourceKey || sequence === undefined || chunkIndex === undefined) return undefined;
  const sequenceNumber = Number(sequence);
  const chunkIndexNumber = Number(chunkIndex);
  if (!Number.isInteger(sequenceNumber) || !Number.isInteger(chunkIndexNumber)) return undefined;
  return { sourceKey, sequence: sequenceNumber, chunkIndex: chunkIndexNumber };
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
  const checks = tokens.map((t) => contains(hay, t, false));
  return (o.tokenMode ?? "and") === "or" ? checks.some(Boolean) : checks.every(Boolean);
}

function contains(hay: string, needle: string, caseSensitive: boolean): boolean {
  return caseSensitive ? hay.includes(needle) : hay.toLowerCase().includes(needle.toLowerCase());
}
function tokenize(q: string): string[] { return q.split(/\s+/).filter(Boolean); }
function smartCaseFlags(q: string): string { return /[A-Z]/.test(q) ? "" : "i"; }
