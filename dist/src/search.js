import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { resolveCacheRoot } from "./paths.js";
import { parseRecordKey, recordKey } from "./records.js";
const DEFAULT_LIMIT = 10_000;
const RG_MATCH_OVERFETCH_FACTOR = 20;
const RG_MATCH_MIN_PREFILTER = 200;
const RG_MATCH_MAX_PREFILTER = 20_000;
export async function searchRecords(options = {}) {
    return sortByRecency(await collectMatchingRecords(options)).slice(0, options.limit ?? DEFAULT_LIMIT);
}
export async function candidateLines(options = {}) {
    return toSessionCandidateLines(await collectMatchingRecords(options), options.limit ?? DEFAULT_LIMIT, options);
}
async function collectMatchingRecords(options = {}) {
    const query = options.query?.trim() ?? "";
    const out = [];
    for await (const record of readAllRecords(options)) {
        if (!passesFilters(record, options))
            continue;
        if (query && !matchesQuery(record, query, options))
            continue;
        out.push(record);
    }
    return out;
}
export async function findRecordByKey(key, options = {}) {
    const parsed = parseRecordKey(key);
    const keyParts = parseKeyParts(parsed);
    if (keyParts) {
        const records = await readSourceRecords(keyParts.sourceKey, options);
        for (const record of records)
            if (recordKey(record) === parsed)
                return record;
        return undefined;
    }
    if (isSourceKey(parsed))
        return mostRecentRecord(await readSourceRecords(parsed, options));
    for await (const record of readAllRecords(options))
        if (recordKey(record) === parsed)
            return record;
    return undefined;
}
export async function previewRecord(key, contextLines = 2, options = {}) {
    const parsed = parseRecordKey(key);
    const keyParts = parseKeyParts(parsed);
    const sourceKey = keyParts?.sourceKey ?? (isSourceKey(parsed) ? parsed : undefined);
    const same = sourceKey ? await readSourceRecords(sourceKey, options) : [];
    const found = (keyParts ? same.find((r) => recordKey(r) === parsed) : mostRecentRecord(same)) ?? await findRecordByKey(parsed, options);
    if (!found)
        return undefined;
    const sourceRecords = same.length ? same : await readSourceRecords(found.sourceKey, options);
    const sorted = sourceRecords.sort((a, b) => a.sequence - b.sequence || a.chunkIndex - b.chunkIndex);
    const query = options.query?.trim();
    const previewRecords = query ? recordsWithMatchContext(sorted, query, options, contextLines) : sorted;
    const previewRecord = previewRecords[0] ?? found;
    const neighbors = previewRecords.slice(1);
    const matchCount = query ? sorted.filter((record) => matchesQuery(record, query, options)).length : undefined;
    const metadata = [
        `project: ${found.sessionName ?? projectFromCwd(found.cwd) ?? ""}`,
        `cwd: ${found.cwd ?? ""}`,
        `session id: ${found.sessionId}`,
        `session path: ${found.sessionPath}`,
        `messages: ${sorted.length}`,
        ...(matchCount === undefined ? [] : [`matches: ${matchCount}`]),
    ];
    return { record: previewRecord, metadata, neighbors, records: previewRecords };
}
export async function rgCandidateLines(options = {}) {
    const query = options.query?.trim();
    if (!query || shouldScanForAndQuery(query, options))
        return candidateLines(options);
    const cacheRoot = options.cacheRoot ?? resolveCacheRoot(options);
    const args = rgArgsForQuery(query, options, join(cacheRoot, "records"));
    const matchesByPath = await rgMatchingLines("rg", args, rgPrefilterLimit(options.limit ?? DEFAULT_LIMIT));
    if (!matchesByPath)
        return candidateLines(options);
    const out = [];
    const seen = new Set();
    for (const [path, lineNumbers] of [...matchesByPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        for (const record of await readRecordsAtLines(path, lineNumbers)) {
            const key = recordKey(record);
            if (seen.has(key) || !passesFilters(record, options) || !matchesQuery(record, query, options))
                continue;
            seen.add(key);
            out.push(record);
        }
    }
    return toSessionCandidateLines(out, options.limit ?? DEFAULT_LIMIT, options);
}
function shouldScanForAndQuery(query, options) {
    return options.matchMode !== "regex" && (options.tokenMode ?? "and") === "and" && tokenize(query).length > 1;
}
function rgArgsForQuery(query, options, recordsDir) {
    const args = ["--json", "--ignore-case", "--glob=*.jsonl"];
    if (options.matchMode !== "regex")
        args.push("--fixed-strings");
    const patterns = options.matchMode === "regex" ? [query] : tokenize(query);
    for (const pattern of patterns)
        args.push("-e", pattern);
    args.push(recordsDir);
    return args;
}
async function rgMatchingLines(command, args, maxMatches) {
    return new Promise((resolve) => {
        const matches = new Map();
        const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "ignore"] });
        let buffer = "";
        let settled = false;
        let stoppingAfterLimit = false;
        let matchCount = 0;
        const finish = (value) => { if (!settled) {
            settled = true;
            resolve(value);
        } };
        const stopIfFull = () => {
            if (matchCount < maxMatches || stoppingAfterLimit)
                return false;
            stoppingAfterLimit = true;
            child.kill();
            return true;
        };
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            if (stoppingAfterLimit)
                return;
            buffer += chunk;
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (line) {
                    const result = collectRgMatch(line, matches);
                    if (result === undefined) {
                        child.kill();
                        finish(undefined);
                        return;
                    }
                    matchCount += result;
                    if (stopIfFull())
                        return;
                }
                newline = buffer.indexOf("\n");
            }
        });
        child.on("error", () => finish(undefined));
        child.on("close", (code) => {
            if (settled)
                return;
            if (!stoppingAfterLimit && code !== 0 && code !== 1) {
                finish(undefined);
                return;
            }
            if (!stoppingAfterLimit && buffer) {
                const result = collectRgMatch(buffer, matches);
                if (result === undefined) {
                    finish(undefined);
                    return;
                }
            }
            finish(matches);
        });
    });
}
function collectRgMatch(line, matches) {
    try {
        const event = JSON.parse(line);
        if (event.type !== "match")
            return 0;
        const path = event.data?.path?.text;
        const lineNumber = event.data?.line_number;
        if (typeof path === "string" && Number.isInteger(lineNumber)) {
            const lines = matches.get(path) ?? new Set();
            const before = lines.size;
            lines.add(lineNumber);
            matches.set(path, lines);
            return lines.size > before ? 1 : 0;
        }
        return 0;
    }
    catch {
        return undefined;
    }
}
function rgPrefilterLimit(limit) {
    return Math.min(RG_MATCH_MAX_PREFILTER, Math.max(RG_MATCH_MIN_PREFILTER, limit * RG_MATCH_OVERFETCH_FACTOR));
}
async function readRecordsAtLines(path, lineNumbers) {
    const out = [];
    const wanted = new Set([...lineNumbers].sort((a, b) => a - b));
    let lineNumber = 0;
    try {
        for await (const line of readJsonlLines(path)) {
            lineNumber++;
            if (!wanted.has(lineNumber))
                continue;
            try {
                out.push(JSON.parse(line));
            }
            catch { }
            if (out.length >= lineNumbers.size)
                break;
        }
    }
    catch {
        return [];
    }
    return out;
}
async function readSourceRecords(sourceKey, options) {
    const path = join(options.cacheRoot ?? resolveCacheRoot(options), "records", `${sourceKey}.jsonl`);
    const records = [];
    try {
        for await (const line of readJsonlLines(path)) {
            try {
                records.push(JSON.parse(line));
            }
            catch { }
        }
    }
    catch {
        return [];
    }
    return records;
}
async function* readAllRecords(options) {
    const dir = join(options.cacheRoot ?? resolveCacheRoot(options), "records");
    let files = [];
    try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();
    }
    catch {
        return;
    }
    for (const file of files) {
        for await (const line of readJsonlLines(join(dir, file))) {
            try {
                yield JSON.parse(line);
            }
            catch { }
        }
    }
}
async function* readJsonlLines(path) {
    const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl)
        if (line.trim())
            yield line;
}
function parseKeyParts(key) {
    const [sourceKey, sequence, chunkIndex] = key.split(":");
    if (!sourceKey || sequence === undefined || chunkIndex === undefined)
        return undefined;
    const sequenceNumber = Number(sequence);
    const chunkIndexNumber = Number(chunkIndex);
    if (!Number.isInteger(sequenceNumber) || !Number.isInteger(chunkIndexNumber))
        return undefined;
    return { sourceKey, sequence: sequenceNumber, chunkIndex: chunkIndexNumber };
}
function passesFilters(r, o) {
    if (o.role && r.role !== o.role)
        return false;
    if (o.project && !(r.sessionName ?? "").includes(o.project))
        return false;
    if (o.cwd && r.cwd !== o.cwd)
        return false;
    if (o.namedOnly && !r.sessionName)
        return false;
    if (o.since && (!r.timestamp || r.timestamp < o.since))
        return false;
    if (o.before && (!r.timestamp || r.timestamp > o.before))
        return false;
    return true;
}
function matchesQuery(r, query, o) {
    const hay = `${r.display} ${r.searchText}`;
    if (o.matchMode === "regex") {
        try {
            return new RegExp(query, smartCaseFlags(query)).test(hay);
        }
        catch {
            return false;
        }
    }
    const tokens = tokenize(query);
    const checks = tokens.map((t) => contains(hay, t, false));
    return (o.tokenMode ?? "and") === "or" ? checks.some(Boolean) : checks.every(Boolean);
}
function toSessionCandidateLines(records, limit, options) {
    const sessions = new Map();
    for (const record of records) {
        const group = sessions.get(record.sourceKey) ?? [];
        group.push(record);
        sessions.set(record.sourceKey, group);
    }
    return [...sessions.values()]
        .map((records) => toSessionCandidateLine(records, options))
        .sort((a, b) => compareRecordRecency(b.bestRecord, a.bestRecord))
        .slice(0, limit)
        .map((candidate) => `${candidate.key}\t${candidate.display}`);
}
function toSessionCandidateLine(records, options) {
    const sorted = sortByRecency(records);
    const bestRecord = sorted[0];
    const label = bestRecord.sessionName ?? projectFromCwd(bestRecord.cwd) ?? bestRecord.sessionId.slice(0, 8);
    const date = dateLabel(bestRecord.timestamp);
    const matchLabel = records.length === 1 ? "1 match" : `${records.length} matches`;
    const snippet = highlightForQuery(visibleExcerpt(bestRecord.text, options.query, options), options.query, options);
    return {
        key: recordKey(bestRecord),
        display: [label, date, matchLabel, snippet].filter(Boolean).join(" — "),
        searchText: [bestRecord.cwd, bestRecord.sessionName, bestRecord.sessionId, ...records.slice(0, 20).map((record) => record.text)].filter(Boolean).join(" "),
        bestRecord,
    };
}
function visibleExcerpt(text, query, options) {
    const terms = highlightTerms(query, options);
    if (terms.length === 0)
        return truncateText(text, 260);
    const lower = text.toLowerCase();
    const matchIndex = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0).sort((a, b) => a - b)[0];
    if (matchIndex === undefined)
        return truncateText(text, 260);
    const start = Math.max(0, matchIndex - 100);
    const end = Math.min(text.length, matchIndex + 220);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
function truncateText(text, maxLength) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength).trim()}…`;
}
export function highlightForQuery(text, query, options = {}) {
    const terms = highlightTerms(query, options);
    if (terms.length === 0)
        return text;
    const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
    return text.replace(pattern, "\u001b[33;1m$1\u001b[0m");
}
function highlightTerms(query, options) {
    const trimmed = query?.trim();
    if (!trimmed || options.matchMode === "regex")
        return [];
    const terms = (options.tokenMode ?? "and") === "and" ? [trimmed, ...tokenize(trimmed)] : tokenize(trimmed);
    return [...new Set(terms.filter((term) => term.length > 0).sort((a, b) => b.length - a.length))];
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function recordsWithMatchContext(records, query, options, contextLines) {
    const included = new Set();
    const context = Math.min(contextLines, 3);
    records.forEach((record, index) => {
        if (!matchesQuery(record, query, options))
            return;
        for (let i = Math.max(0, index - context); i <= Math.min(records.length - 1, index + context); i++)
            included.add(i);
    });
    return [...included].sort((a, b) => a - b).map((index) => records[index]);
}
function sortByRecency(records) {
    return [...records].sort((a, b) => compareRecordRecency(b, a));
}
function mostRecentRecord(records) {
    return sortByRecency(records)[0];
}
function isSourceKey(key) {
    return /^[0-9a-f]{16,24}$/.test(key);
}
function compareRecordRecency(a, b) {
    const timestampDelta = timestampMs(a.timestamp) - timestampMs(b.timestamp);
    if (timestampDelta !== 0)
        return timestampDelta;
    const pathDelta = a.sessionPath.localeCompare(b.sessionPath);
    if (pathDelta !== 0)
        return pathDelta;
    return a.sequence - b.sequence || a.chunkIndex - b.chunkIndex;
}
function timestampMs(timestamp) {
    if (!timestamp)
        return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
function dateLabel(timestamp) {
    const relative = relativeDateLabel(timestamp);
    const absolute = absoluteDateLabel(timestamp);
    if (relative && absolute)
        return `${relative} (${absolute})`;
    return relative ?? absolute;
}
function absoluteDateLabel(timestamp) {
    if (!timestamp)
        return undefined;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime()))
        return timestamp.slice(0, 19);
    return date.toISOString().replace("T", " ").slice(0, 19);
}
function relativeDateLabel(timestamp) {
    const ms = timestampMs(timestamp);
    if (!Number.isFinite(ms))
        return timestamp?.slice(0, 10);
    const diffMs = ms - Date.now();
    const absMs = Math.abs(diffMs);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const month = 30 * day;
    const year = 365 * day;
    const format = (value, unit) => {
        const rounded = Math.round(value);
        const suffix = Math.abs(rounded) === 1 ? unit : `${unit}s`;
        return rounded < 0 ? `${Math.abs(rounded)} ${suffix} ago` : `in ${rounded} ${suffix}`;
    };
    if (absMs < minute)
        return "just now";
    if (absMs < hour)
        return format(diffMs / minute, "minute");
    if (absMs < day)
        return format(diffMs / hour, "hour");
    if (absMs < month)
        return format(diffMs / day, "day");
    if (absMs < year)
        return format(diffMs / month, "month");
    return format(diffMs / year, "year");
}
function contains(hay, needle, caseSensitive) {
    return caseSensitive ? hay.includes(needle) : hay.toLowerCase().includes(needle.toLowerCase());
}
function projectFromCwd(cwd) { return cwd?.split(/[\\/]/).filter(Boolean).pop(); }
function tokenize(q) { return q.split(/\s+/).filter(Boolean); }
function smartCaseFlags(q) { return /[A-Z]/.test(q) ? "" : "i"; }
//# sourceMappingURL=search.js.map