import { copyText } from "../src/actions.js";
import { doctorCache, getCacheStats, syncCache } from "../src/cache.js";
import { detectFzfVersion, runFzf } from "../src/fzf.js";
import { parseRecordKey } from "../src/records.js";
import { findRecordByKey, searchRecords } from "../src/search.js";
const SESSION_LIMIT = 10_000;
const VISIBLE_ROWS = 14;
export default function piFzfExtension(pi) {
    pi.registerCommand("fzf", {
        description: "Search previous Pi sessions.",
        async handler(args, ctx) {
            await ctx.waitForIdle();
            const parsed = parseFzfArgs(args);
            switch (parsed.kind) {
                case "index": return showObject(ctx, "pi-fzf index", await syncCache());
                case "stats": return showObject(ctx, "pi-fzf stats", await getCacheStats());
                case "doctor": return showObject(ctx, "pi-fzf doctor", await doctorCache());
                case "search": return runSearchCommand(pi, ctx, parsed);
            }
        }
    });
}
async function runSearchCommand(pi, ctx, parsed) {
    await syncCache();
    const searchOptions = { limit: SESSION_LIMIT };
    if (parsed.external) {
        const safe = ctx.mode === "print" && process.stdin.isTTY && process.stdout.isTTY;
        if (safe) {
            const selected = await runExternal(parsed.query === undefined ? searchOptions : { ...searchOptions, query: parsed.query });
            if (!selected)
                return;
            return actOnRecord(pi, ctx, selected);
        }
        ctx.ui.notify("/fzf --external cannot safely take over the terminal from this Pi UI; using the native selector instead.", "warning");
    }
    const records = await searchRecords(searchOptions);
    if (records.length === 0) {
        ctx.ui.notify("No pi-fzf sessions indexed yet. Run /fzf index first if needed.", "info");
        return;
    }
    const initialQuery = parsed.query ?? "";
    if (!ctx.hasUI || ctx.mode !== "tui") {
        const first = sessionResults(records, initialQuery)[0];
        if (first)
            showRecord(ctx, first);
        else
            ctx.ui.notify(`No pi-fzf results for ${JSON.stringify(initialQuery)}.`, "info");
        return;
    }
    const selected = await runNativeSearchPicker(ctx, records, initialQuery);
    if (selected)
        await actOnRecord(pi, ctx, selected);
}
async function runExternal(options) {
    const lines = (await searchRecords(options)).map((record) => `${record.sourceKey}:${record.sequence}:${record.chunkIndex}\t${resultLabel(record)}`);
    const fzfOptions = { candidates: lines };
    if (options.query !== undefined)
        fzfOptions.query = options.query;
    const version = await detectFzfVersion();
    if (version !== undefined)
        fzfOptions.version = version;
    const selected = await runFzf(fzfOptions);
    if (!selected)
        return undefined;
    return findRecordByKey(parseRecordKey(selected));
}
async function runNativeSearchPicker(ctx, records, initialQuery) {
    return ctx.ui.custom((tui, theme, keybindings, done) => {
        return new PiFzfPicker(records, initialQuery, keybindings, () => tui.requestRender(), done, theme);
    }, {
        overlay: true,
        overlayOptions: { width: "90%", maxHeight: 22, anchor: "center" },
    });
}
export class PiFzfPicker {
    records;
    keybindings;
    requestRender;
    done;
    theme;
    query;
    selected = 0;
    offset = 0;
    cachedQuery;
    cachedResults = [];
    constructor(records, initialQuery, keybindings, requestRender, done, theme) {
        this.records = records;
        this.keybindings = keybindings;
        this.requestRender = requestRender;
        this.done = done;
        this.theme = theme;
        this.query = initialQuery;
    }
    handleInput(data) {
        const beforeQuery = this.query;
        if (this.keybindings.matches(data, "tui.select.up") || data === "k")
            this.move(-1);
        else if (this.keybindings.matches(data, "tui.select.down") || data === "j")
            this.move(1);
        else if (this.keybindings.matches(data, "tui.select.pageUp"))
            this.move(-VISIBLE_ROWS);
        else if (this.keybindings.matches(data, "tui.select.pageDown"))
            this.move(VISIBLE_ROWS);
        else if (this.keybindings.matches(data, "tui.select.confirm") || data === "\n")
            this.done(this.results()[this.selected]);
        else if (this.keybindings.matches(data, "tui.select.cancel"))
            this.done(undefined);
        else if (data === "\x7f" || data === "\b")
            this.query = this.query.slice(0, -1);
        else if (data === "\x15")
            this.query = "";
        else if (isPrintable(data))
            this.query += data;
        if (this.query !== beforeQuery) {
            this.selected = 0;
            this.offset = 0;
            this.cachedQuery = undefined;
        }
        this.invalidate();
        this.requestRender();
    }
    render(width) {
        const results = this.results();
        this.clampSelection(results.length);
        this.ensureVisible();
        const body = results.slice(this.offset, this.offset + VISIBLE_ROWS);
        const lines = [
            this.line(width, this.accent("pi-fzf session search")),
            this.line(width, `query: ${this.query}${this.dim("▌")}`),
            this.line(width, `${results.length} session${results.length === 1 ? "" : "s"} · type to filter · ↑/↓ move · PgUp/PgDn page · Enter select · Esc cancel · Ctrl-U clear`),
            this.line(width, ""),
        ];
        if (body.length === 0)
            lines.push(this.line(width, this.dim("No matching sessions.")));
        for (let i = 0; i < body.length; i++) {
            const absolute = this.offset + i;
            const record = body[i];
            const prefix = absolute === this.selected ? "› " : "  ";
            const text = `${prefix}${resultLabel(record)}`;
            lines.push(this.line(width, absolute === this.selected ? this.selectedStyle(text) : text));
        }
        return lines;
    }
    invalidate() { }
    results() {
        if (this.cachedQuery === this.query)
            return this.cachedResults;
        this.cachedQuery = this.query;
        this.cachedResults = sessionResults(this.records, this.query);
        return this.cachedResults;
    }
    move(delta) {
        const count = this.results().length;
        if (count === 0)
            return;
        this.selected = Math.max(0, Math.min(count - 1, this.selected + delta));
    }
    clampSelection(count) {
        if (count === 0) {
            this.selected = 0;
            this.offset = 0;
            return;
        }
        this.selected = Math.max(0, Math.min(count - 1, this.selected));
    }
    ensureVisible() {
        if (this.selected < this.offset)
            this.offset = this.selected;
        if (this.selected >= this.offset + VISIBLE_ROWS)
            this.offset = this.selected - VISIBLE_ROWS + 1;
    }
    line(width, text) { return truncate(text, Math.max(10, width)); }
    dim(text) { return this.theme.fg?.("muted", text) ?? text; }
    accent(text) { return this.theme.fg?.("accent", text) ?? text; }
    selectedStyle(text) { return this.theme.bg?.("selectedBg", text) ?? this.accent(text); }
}
async function actOnRecord(pi, ctx, record) {
    const reference = sessionReference(record);
    const actions = [
        "Insert session reference",
        "Send snippet to current session",
        "Switch/resume session",
        "Copy/show path/id",
        "Cancel"
    ];
    const action = ctx.hasUI ? await ctx.ui.select("pi-fzf action", actions) : "Copy/show path/id";
    if (!action || action === "Cancel")
        return;
    if (action === "Insert session reference") {
        const current = ctx.ui.getEditorText();
        ctx.ui.setEditorText(current ? `${current}\n${reference}` : reference);
        ctx.ui.notify("Inserted pi-fzf session reference into the editor.", "info");
        return;
    }
    if (action === "Send snippet to current session") {
        pi.sendUserMessage(`Referenced Pi session snippet:\n\n${reference}\n\n${record.text}`);
        return;
    }
    if (action === "Switch/resume session") {
        await ctx.switchSession(record.sessionPath, { withSession: async (nextCtx) => { nextCtx.ui.notify("Switched to pi-fzf result session.", "info"); } });
        return;
    }
    await copyText(reference);
    ctx.ui.notify(`Session reference copied or printed: ${record.sessionId}`, "info");
}
export function sessionResults(records, query) {
    const groups = new Map();
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const record of records) {
        if (tokens.length > 0) {
            const haystack = `${record.sessionName ?? ""} ${record.cwd ?? ""} ${record.sessionId} ${record.display} ${record.searchText} ${record.text}`.toLowerCase();
            if (!tokens.every((token) => haystack.includes(token)))
                continue;
        }
        const group = groups.get(record.sourceKey) ?? [];
        group.push(record);
        groups.set(record.sourceKey, group);
    }
    return [...groups.values()].map(bestRecord).sort(compareRecordRecencyDesc);
}
export function parseFzfArgs(args) {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const first = parts[0];
    if (first === "index" || first === "stats" || first === "doctor")
        return { kind: first };
    const external = parts.includes("--external");
    const query = parts.filter((part) => part !== "--external").join(" ").trim();
    return query ? { kind: "search", query, external } : { kind: "search", external };
}
function resultLabel(record) {
    return `${record.sessionName ?? record.cwd ?? "unknown project"} · ${record.role} · ${formatDate(record.timestamp)} · ${oneLine(record.display || record.text)}`;
}
function sessionReference(record) {
    return `pi session ${record.sessionId}\nproject: ${record.sessionName ?? projectFromCwd(record.cwd) ?? "unknown"}\nrole: ${record.role}\ndate: ${record.timestamp ?? "unknown"}`;
}
function projectFromCwd(cwd) {
    return cwd?.split(/[\\/]/).filter(Boolean).pop();
}
function showRecord(ctx, record) {
    ctx.ui.notify(sessionReference(record), "info");
}
function showObject(ctx, title, value) {
    ctx.ui.notify(`${title}: ${JSON.stringify(value, null, 2)}`, "info");
}
function formatDate(timestamp) {
    if (!timestamp)
        return "unknown date";
    return timestamp.slice(0, 10);
}
function oneLine(text) {
    return text.replace(/\s+/g, " ").trim().slice(0, 140);
}
function bestRecord(records) {
    return [...records].sort(compareRecordRecencyDesc)[0];
}
function compareRecordRecencyDesc(a, b) {
    const timestampDelta = timestampMs(b.timestamp) - timestampMs(a.timestamp);
    if (timestampDelta !== 0)
        return timestampDelta;
    return b.sequence - a.sequence || b.chunkIndex - a.chunkIndex;
}
function timestampMs(timestamp) {
    if (!timestamp)
        return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
function isPrintable(data) {
    return data.length === 1 && data >= " " && data !== "\x7f";
}
function truncate(text, width) {
    const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
    if (plain.length <= width)
        return text;
    return `${plain.slice(0, Math.max(0, width - 1))}…`;
}
//# sourceMappingURL=index.js.map