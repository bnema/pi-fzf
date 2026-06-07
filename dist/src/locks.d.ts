export interface LockOptions {
    staleMs?: number;
    now?: () => number;
}
export interface CacheLock {
    path: string;
    release(): Promise<void>;
}
export declare function acquireLock(lockPath: string, options?: LockOptions): Promise<CacheLock>;
//# sourceMappingURL=locks.d.ts.map