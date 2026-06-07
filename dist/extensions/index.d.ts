import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CandidateRecord } from "../src/records.js";
type ParsedCommand = {
    kind: "search";
    query?: string;
    external: boolean;
} | {
    kind: "index" | "stats" | "doctor";
};
export default function piFzfExtension(pi: ExtensionAPI): void;
export declare class PiFzfPicker {
    private readonly records;
    private readonly keybindings;
    private readonly requestRender;
    private readonly done;
    private readonly theme;
    private query;
    private selected;
    private offset;
    private cachedQuery;
    private cachedResults;
    constructor(records: CandidateRecord[], initialQuery: string, keybindings: {
        matches(data: string, id: string): boolean;
    }, requestRender: () => void, done: (record: CandidateRecord | undefined) => void, theme: {
        fg?(color: string, text: string): string;
        bg?(color: string, text: string): string;
    });
    handleInput(data: string): void;
    render(width: number): string[];
    invalidate(): void;
    private results;
    private move;
    private clampSelection;
    private ensureVisible;
    private line;
    private dim;
    private accent;
    private selectedStyle;
}
export declare function sessionResults(records: CandidateRecord[], query: string): CandidateRecord[];
export declare function parseFzfArgs(args: string): ParsedCommand;
export {};
//# sourceMappingURL=index.d.ts.map