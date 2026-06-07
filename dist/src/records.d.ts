import { type SearchRecord } from "./types.js";
import type { ParsedSession } from "./session-parser.js";
export interface RecordsOptions {
    chunkSize?: number;
}
export interface CandidateRecord extends SearchRecord {
    sequence: number;
    chunkIndex: number;
    display: string;
    searchText: string;
}
export declare function sourceKeyForPath(sourcePath: string): string;
export declare function normalizeText(text: string): string;
export declare function recordsFromParsedSession(parsed: ParsedSession, options?: RecordsOptions): CandidateRecord[];
export declare function recordKey(record: Pick<CandidateRecord, "sourceKey" | "sequence" | "chunkIndex">): string;
export declare function toCandidateLine(record: CandidateRecord): string;
export declare function parseRecordKey(selection: string): string;
//# sourceMappingURL=records.d.ts.map