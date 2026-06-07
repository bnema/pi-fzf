export const CACHE_VERSION = 1;
export const EXTRACTOR_VERSION = 1;

export type SearchRole = "user" | "assistant" | "summary" | "session";

export interface SearchRecord {
  cacheVersion: typeof CACHE_VERSION;
  extractorVersion: typeof EXTRACTOR_VERSION;
  sessionId: string;
  sessionPath: string;
  entryId?: string;
  role: SearchRole;
  text: string;
  timestamp?: string;
  cwd?: string;
  sessionName?: string;
}
