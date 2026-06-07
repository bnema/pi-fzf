export declare const CACHE_VERSION = 1;
export declare const EXTRACTOR_VERSION = 1;
export type SearchRole = "user" | "assistant" | "compaction" | "branch_summary" | "session";
export interface SearchRecord {
    cacheVersion: typeof CACHE_VERSION;
    extractorVersion: typeof EXTRACTOR_VERSION;
    sourceKey: string;
    sessionId: string;
    sessionPath: string;
    entryId?: string;
    role: SearchRole;
    text: string;
    timestamp?: string;
    cwd?: string;
    sessionName?: string;
}
//# sourceMappingURL=types.d.ts.map