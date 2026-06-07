import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CACHE_VERSION, EXTRACTOR_VERSION } from "./types.js";
const DEFAULT_CHUNK_SIZE = 3000;
const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
export function sourceKeyForPath(sourcePath) {
    return createHash("sha256").update(resolve(sourcePath)).digest("hex").slice(0, 16);
}
export function normalizeText(text) {
    return text
        .replace(ANSI_PATTERN, "")
        .replace(/[\t\r\n]+/g, " ")
        .replace(CONTROL_PATTERN, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export function recordsFromParsedSession(parsed, options = {}) {
    const sourceKey = sourceKeyForPath(parsed.sourcePath);
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const records = [];
    for (const extracted of parsed.records) {
        const normalized = normalizeText(extracted.text);
        if (!normalized)
            continue;
        const prefix = [extracted.cwd ?? parsed.cwd, extracted.sessionName ?? parsed.sessionName, extracted.role].filter(Boolean).join(" ");
        const effectiveChunkSize = Math.max(100, chunkSize - prefix.length - 1);
        const chunks = chunkText(normalized, effectiveChunkSize);
        chunks.forEach((chunk, chunkIndex) => {
            const cwd = extracted.cwd ?? parsed.cwd;
            const sessionName = extracted.sessionName ?? parsed.sessionName;
            const base = {
                cacheVersion: CACHE_VERSION,
                extractorVersion: EXTRACTOR_VERSION,
                sourceKey,
                sessionId: parsed.sessionId,
                sessionPath: parsed.sourcePath,
                role: extracted.role,
                text: chunk,
                sequence: extracted.sequence,
                chunkIndex,
            };
            if (extracted.entryId !== undefined)
                base.entryId = extracted.entryId;
            if (extracted.timestamp !== undefined)
                base.timestamp = extracted.timestamp;
            if (cwd !== undefined)
                base.cwd = cwd;
            if (sessionName !== undefined)
                base.sessionName = sessionName;
            const label = sessionLabel({ cwd, sessionName, sessionId: parsed.sessionId, sourcePath: parsed.sourcePath });
            const date = dateLabel(extracted.timestamp);
            const searchText = sanitizeField([cwd, sessionName, parsed.sessionId, extracted.role, chunk].filter(Boolean).join(" ")).slice(0, chunkSize);
            const display = sanitizeField([label, date, extracted.role, chunk].filter(Boolean).join(" — "));
            records.push({ ...base, display, searchText });
        });
    }
    return records;
}
export function recordKey(record) {
    return `${record.sourceKey}:${record.sequence}:${record.chunkIndex}`;
}
export function toCandidateLine(record) {
    return `${recordKey(record)}\t${sanitizeField(record.display)}\t${sanitizeField(record.searchText)}`;
}
export function parseRecordKey(selection) {
    return selection.split("\t", 1)[0] ?? selection;
}
function sanitizeField(value) {
    return normalizeText(value).replace(/\t/g, " ");
}
function chunkText(text, chunkSize) {
    if (text.length <= chunkSize)
        return [text];
    const chunks = [];
    for (let offset = 0; offset < text.length; offset += chunkSize) {
        chunks.push(text.slice(offset, offset + chunkSize).trim());
    }
    return chunks.filter(Boolean);
}
function sessionLabel(input) {
    return input.sessionName ?? projectFromCwd(input.cwd) ?? shortId(input.sessionId) ?? shortPath(input.sourcePath);
}
function projectFromCwd(cwd) {
    if (!cwd)
        return undefined;
    return cwd.split(/[\\/]/).filter(Boolean).pop();
}
function dateLabel(timestamp) {
    return timestamp?.slice(0, 10);
}
function shortId(sessionId) {
    return sessionId ? sessionId.slice(0, 8) : undefined;
}
function shortPath(path) {
    return path.split(/[\\/]/).pop() ?? path;
}
//# sourceMappingURL=records.js.map