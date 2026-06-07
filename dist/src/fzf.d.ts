export interface FzfVersion {
    major: number;
    minor: number;
    patch: number;
    raw: string;
}
export interface FzfRunOptions {
    candidates?: string | readonly string[];
    version?: FzfVersion;
    query?: string;
    dynamicRg?: boolean;
    fzfCommand?: string;
    searchArgs?: readonly string[];
}
export declare function parseFzfVersion(raw: string): FzfVersion | undefined;
export declare function detectFzfVersion(): Promise<FzfVersion | undefined>;
export declare function supportsAcceptNth(version: FzfVersion | undefined): boolean;
export declare function supportsIdNth(version: FzfVersion | undefined): boolean;
export declare function buildFzfArgs(options: FzfRunOptions): string[];
export declare function runFzf(options: FzfRunOptions): Promise<string | undefined>;
//# sourceMappingURL=fzf.d.ts.map