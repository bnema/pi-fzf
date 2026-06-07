import { type PathResolutionOptions } from "./paths.js";
export interface CacheSourceEntry {
    sourceKey: string;
    sessionId: string;
    paths: {
        source: string;
        records: string;
        session: string;
    };
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
export interface SyncResult {
    indexed: number;
    removed: number;
    parsed: number;
}
export interface CacheStats {
    sourceCount: number;
    recordCount: number;
    shardCount: number;
    sessionMetaCount: number;
    totalBytes: number;
}
export interface DoctorReport extends CacheStats {
    issues: string[];
}
export declare function syncCache(options?: CacheOptions): Promise<SyncResult>;
export declare function rebuildCache(options?: CacheOptions): Promise<SyncResult>;
export declare function cleanCache(options?: CacheOptions): Promise<{
    removed: number;
}>;
export declare function doctorCache(options?: CacheOptions): Promise<DoctorReport>;
export declare function getCacheStats(options?: CacheOptions): Promise<CacheStats>;
//# sourceMappingURL=cache.d.ts.map