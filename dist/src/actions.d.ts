import type { CandidateRecord } from "./records.js";
export type SelectedAction = "menu" | "print-session-id" | "print-session-path" | "print-snippet" | "json" | "copy" | "resume" | "fork";
export interface ActionOptions {
    exec?: boolean;
    clipboardText?: string;
}
export declare function runSelectedAction(record: CandidateRecord, action: SelectedAction, options?: ActionOptions): Promise<boolean>;
export declare function buildResumeCommand(record: CandidateRecord): string;
export declare function buildForkCommand(record: CandidateRecord): string;
export declare function buildResumeArgv(record: CandidateRecord): [string, string, string];
export declare function buildForkArgv(record: CandidateRecord): [string, string, string];
export declare function copyText(text: string): Promise<boolean>;
//# sourceMappingURL=actions.d.ts.map