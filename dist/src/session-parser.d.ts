import type { SearchRole } from "./types.js";
export interface ExtractedTextRecord {
    role: Exclude<SearchRole, "session">;
    text: string;
    sequence: number;
    entryId?: string;
    timestamp?: string;
    cwd?: string;
    sessionName?: string;
}
export interface ParsedSession {
    sessionId: string;
    sourcePath: string;
    cwd?: string;
    sessionName?: string;
    records: ExtractedTextRecord[];
}
export declare function parseSessionFile(sessionPath: string): Promise<ParsedSession>;
//# sourceMappingURL=session-parser.d.ts.map