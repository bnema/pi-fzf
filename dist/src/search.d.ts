import { type PathResolutionOptions } from "./paths.js";
import { type CandidateRecord } from "./records.js";
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
export interface Preview {
    record: CandidateRecord;
    metadata: string[];
    neighbors: CandidateRecord[];
    records: CandidateRecord[];
}
export declare function searchRecords(options?: SearchOptions): Promise<CandidateRecord[]>;
export declare function candidateLines(options?: SearchOptions): Promise<string[]>;
export declare function findRecordByKey(key: string, options?: SearchOptions): Promise<CandidateRecord | undefined>;
export declare function previewRecord(key: string, contextLines?: number, options?: SearchOptions): Promise<Preview | undefined>;
export declare function rgCandidateLines(options?: SearchOptions): Promise<string[]>;
export declare function highlightForQuery(text: string, query: string | undefined, options?: Pick<SearchOptions, "matchMode" | "tokenMode">): string;
//# sourceMappingURL=search.d.ts.map